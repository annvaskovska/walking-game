import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fix } from '../core/types';
import type { LocationError } from './location';
import { createNativeLocation, SILENCE_MS, type RawFix, type WalkTrackerPlugin } from './nativeLocation';

/**
 * Stands in for the native WalkTracker: it keeps the walk's fixes as the Swift side does, and the
 * test decides whether the web view hears each one live (screen on) or not (screen locked).
 */
class FakeTracker {
  journal: RawFix[] = [];
  walk: string | null = null;
  /** Does the web view hear fixes as they come? False while "the screen is locked". */
  live = true;
  stops = 0;
  starts: string[] = [];
  failStart = false;
  private fixListeners = new Set<(e: { seq: number; fix: RawFix }) => void>();
  private errorListeners = new Set<(e: { kind: 'denied' | 'unavailable' | 'timeout'; message: string }) => void>();

  /** A fix taken at second `s`. */
  record(s: number): RawFix {
    const raw: RawFix = [4.88 + s * 1e-5, 52.37, 5, s * 1000, 1.3, 90];
    this.journal.push(raw);
    if (this.live) for (const l of this.fixListeners) l({ seq: this.journal.length - 1, fix: raw });
    return raw;
  }

  fail(kind: 'denied' | 'unavailable' | 'timeout') {
    for (const l of this.errorListeners) l({ kind, message: kind });
  }

  get listeners() {
    return this.fixListeners.size + this.errorListeners.size;
  }

  plugin(): WalkTrackerPlugin {
    const self = this;
    return {
      async start({ walk }) {
        self.starts.push(walk);
        if (self.failStart) throw new Error('bridge down');
        const resumed = self.walk === walk;
        if (!resumed) self.journal = [];
        self.walk = walk;
        return { resumed };
      },
      async stop() {
        self.stops++;
        self.walk = null;
        self.journal = [];
      },
      async fixes({ from, after }) {
        await Promise.resolve();
        const fixes = self.journal.slice(from).filter((f) => after === undefined || f[3] > after);
        return { next: self.journal.length, fixes };
      },
      async lastFixTime({ walk }) {
        return { t: self.walk === walk ? (self.journal.at(-1)?.[3] ?? null) : null };
      },
      async current() {
        return { fix: self.journal.at(-1)! };
      },
      async permission() {
        return { location: 'granted' as const };
      },
      addListener(event: 'fix' | 'error', fn: (e: never) => void) {
        const set = (event === 'fix' ? self.fixListeners : self.errorListeners) as Set<unknown>;
        set.add(fn);
        return Promise.resolve({ remove: async () => void set.delete(fn) });
      },
    } as WalkTrackerPlugin;
  }
}

/** Lets every pending promise (bridge calls) settle. */
const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0));
};

function setup(opts: { walk?: string; since?: number; tracker?: FakeTracker } = {}) {
  const tracker = opts.tracker ?? new FakeTracker();
  let resume: (() => void) | null = null;
  const provider = createNativeLocation(tracker.plugin(), (fn) => {
    resume = fn;
    return () => (resume = null);
  });
  const got: Fix[] = [];
  const errors: LocationError[] = [];
  const catchUps: number[] = [];
  const stop = provider.watch(
    (f) => got.push(f),
    (e) => errors.push(e),
    { walk: opts.walk ?? 'w1', since: opts.since, onCatchUp: (n) => catchUps.push(n) },
  );
  return { tracker, provider, got, errors, catchUps, stop, seconds: () => got.map((f) => f.t / 1000), resume: () => resume?.() };
}

describe('native location (iPhone app)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes fixes on as they come while the screen is on', async () => {
    const t = setup();
    await settle();
    expect(t.tracker.starts).toEqual(['w1']);
    t.tracker.record(1);
    t.tracker.record(2);
    t.tracker.record(3);
    expect(t.seconds()).toEqual([1, 2, 3]);
    expect(t.got[0]).toMatchObject({ acc: 5, speed: 1.3, heading: 90 });
    expect(t.catchUps).toEqual([]);
  });

  it('catches up, in order, on what was walked with the screen locked', async () => {
    const t = setup();
    await settle();
    t.tracker.record(1);
    t.tracker.live = false;
    for (let s = 2; s <= 300; s++) t.tracker.record(s);
    expect(t.seconds()).toEqual([1]);
    // Unlocked: the app comes back to the screen.
    t.tracker.live = true;
    t.resume();
    await settle();
    expect(t.seconds()).toEqual(Array.from({ length: 300 }, (_, i) => i + 1));
    expect(t.catchUps).toEqual([299]);
    // And then carries on live.
    t.tracker.record(301);
    expect(t.seconds().at(-1)).toBe(301);
    expect(t.got).toHaveLength(301);
  });

  it('notices a gap from the next live fix even without a resume', async () => {
    const t = setup();
    await settle();
    t.tracker.record(1);
    t.tracker.live = false;
    t.tracker.record(2);
    t.tracker.record(3);
    t.tracker.live = true;
    t.tracker.record(4);
    await settle();
    expect(t.seconds()).toEqual([1, 2, 3, 4]);
  });

  it('never hands on a fix twice, even when events and reads overlap', async () => {
    const t = setup();
    await settle();
    t.tracker.live = false;
    t.tracker.record(1);
    t.tracker.record(2);
    t.tracker.live = true;
    t.resume();
    // Live fixes arrive while the read-back is still on its way.
    t.tracker.record(3);
    t.tracker.record(4);
    t.resume();
    await settle();
    t.tracker.record(5);
    await settle();
    expect(t.seconds()).toEqual([1, 2, 3, 4, 5]);
  });

  it('after a reload mid-walk, carries on after the last fix the page had saved', async () => {
    const tracker = new FakeTracker();
    tracker.walk = 'w1';
    for (let s = 1; s <= 20; s++) tracker.journal.push([4.88, 52.37, 5, s * 1000, null, null]);
    const t = setup({ tracker, walk: 'w1', since: 12_000 });
    await settle();
    expect(t.seconds()).toEqual([13, 14, 15, 16, 17, 18, 19, 20]);
    expect(t.catchUps).toEqual([8]);
    expect(await t.provider.lastFixTime!('w1')).toBe(20_000);
    expect(await t.provider.lastFixTime!('w0')).toBeNull();
  });

  it('a new walk starts from nothing', async () => {
    const tracker = new FakeTracker();
    tracker.walk = 'old';
    tracker.journal.push([4.88, 52.37, 5, 1000, null, null]);
    const t = setup({ tracker, walk: 'new' });
    await settle();
    expect(t.got).toEqual([]);
    t.tracker.record(2);
    expect(t.seconds()).toEqual([2]);
  });

  it('stopping ends the walk on the native side and hears nothing more', async () => {
    const t = setup();
    await settle();
    t.tracker.record(1);
    t.stop();
    await settle();
    expect(t.tracker.stops).toBe(1);
    expect(t.tracker.listeners).toBe(0);
    t.tracker.record(2);
    t.resume();
    await settle();
    expect(t.seconds()).toEqual([1]);
  });

  it('passes errors on, and a failed start as unavailable', async () => {
    const t = setup();
    await settle();
    t.tracker.fail('denied');
    expect(t.errors).toEqual([{ kind: 'denied', message: 'denied' }]);

    const tracker = new FakeTracker();
    tracker.failStart = true;
    const u = setup({ tracker });
    await settle();
    expect(u.errors.map((e) => e.kind)).toEqual(['unavailable']);
  });

  it('says so when the GPS stays silent, once per silence', async () => {
    vi.useFakeTimers();
    const t = setup();
    await vi.advanceTimersByTimeAsync(0);
    t.tracker.record(1);
    await vi.advanceTimersByTimeAsync(SILENCE_MS + 5000);
    expect(t.errors.map((e) => e.kind)).toEqual(['timeout']);
    await vi.advanceTimersByTimeAsync(SILENCE_MS * 2);
    expect(t.errors).toHaveLength(1);
    t.tracker.record(100);
    await vi.advanceTimersByTimeAsync(SILENCE_MS + 5000);
    expect(t.errors).toHaveLength(2);
    t.stop();
  });
});
