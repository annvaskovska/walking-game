import { describe, expect, it } from 'vitest';
import { COMPASS_FRESH_MS, HeadingFusion, wrap180, wrap360, type CompassReading, type FusedHeading } from './heading';

const FRAME = 1000 / 60;
const gps = (heading: number | null, cone = heading === null ? 0 : 1) => ({ heading, cone, moving: false });
const compass = (heading: number, t: number, accuracy: number | null = 10): CompassReading => ({ heading, accuracy, t });
/** Angular distance, degrees. */
const apart = (a: number, b: number) => Math.abs(wrap180(a - b));

/** Run `fusion` from `t0` for `ms` at 60 fps; returns the frames (copies) and the time reached. */
function run(
  f: HeadingFusion,
  t0: number,
  ms: number,
  input: (now: number) => { gps: ReturnType<typeof gps>; compass: CompassReading | null },
): { frames: (FusedHeading & { now: number })[]; now: number } {
  const frames: (FusedHeading & { now: number })[] = [];
  let now = t0;
  for (; now <= t0 + ms; now += FRAME) {
    const i = input(now);
    frames.push({ ...f.update(now, i.gps, i.compass), now });
  }
  return { frames, now };
}

describe('wrap helpers', () => {
  it('wrap into [0, 360) and [-180, 180)', () => {
    expect(wrap360(-10)).toBe(350);
    expect(wrap360(370)).toBe(10);
    expect(wrap360(360)).toBe(0);
    expect(wrap180(190)).toBe(-170);
    expect(wrap180(-190)).toBe(170);
    expect(wrap180(10 - 350)).toBe(20);
  });
});

describe('HeadingFusion: source', () => {
  it('without a compass follows GPS exactly, as before', () => {
    const f = new HeadingFusion();
    let cone = 0;
    let now = 1000;
    for (let i = 0; i < 60; i++, now += FRAME) {
      // Motion's cone fades in over 0.35 s.
      cone = Math.min(1, cone + (i ? FRAME / 1000 / 0.35 : 0));
      const h = (40 + i * 0.5) % 360;
      const out = f.update(now, { heading: h, cone, moving: true }, null);
      expect(out.source).toBe('gps');
      expect(out.heading).toBeCloseTo(h, 9);
      expect(out.cone).toBeCloseTo(cone, 9);
    }
  });

  it('nothing to go by: no heading, no cone', () => {
    const f = new HeadingFusion();
    const out = f.update(1000, gps(null), null);
    expect(out).toMatchObject({ heading: null, cone: 0, source: null });
  });

  it('a fresh, accurate compass wins and turns the cone fully on while standing still', () => {
    const f = new HeadingFusion();
    const { frames } = run(f, 1000, 600, (now) => ({ gps: gps(null), compass: compass(120, now - 20) }));
    const last = frames[frames.length - 1];
    expect(last.source).toBe('compass');
    expect(last.heading).toBeCloseTo(120, 9);
    expect(last.cone).toBe(1);
    // Faded in, not popped.
    expect(frames[1].cone).toBeLessThan(0.1);
  });

  it('beats the GPS course while walking', () => {
    const f = new HeadingFusion();
    const { frames } = run(f, 1000, 600, (now) => ({ gps: gps(0), compass: compass(90, now) }));
    expect(frames[frames.length - 1]).toMatchObject({ source: 'compass', heading: 90 });
  });

  it('trusts accuracy up to 35°, and an unknown accuracy', () => {
    const at = (accuracy: number | null) => {
      const f = new HeadingFusion();
      return f.update(1000, gps(200), compass(10, 990, accuracy)).source;
    };
    expect(at(5)).toBe('compass');
    expect(at(35)).toBe('compass');
    expect(at(null)).toBe('compass');
    expect(at(36)).toBe('gps');
    expect(at(-1)).toBe('gps');
  });

  it('stale readings (1 s and older) fall back to GPS', () => {
    const f = new HeadingFusion();
    expect(f.update(5000, gps(200), compass(10, 5000 - COMPASS_FRESH_MS + 1)).source).toBe('compass');
    expect(f.update(5001, gps(200), compass(10, 5000 - COMPASS_FRESH_MS)).source).toBe('gps');
    expect(new HeadingFusion().update(5000, gps(200), compass(10, 3000)).source).toBe('gps');
  });

  it('adds the declination to compass headings only', () => {
    const f = new HeadingFusion();
    f.declination = 7;
    expect(f.update(1000, gps(null), compass(355, 1000)).heading).toBeCloseTo(2, 9);
    const g = new HeadingFusion();
    g.declination = 7;
    expect(g.update(1000, gps(100), null).heading).toBe(100);
  });
});

describe('HeadingFusion: switching', () => {
  /** Walk with GPS at `from` for a while, then the compass says `to`; returns the frames after the switch. */
  function switchOver(from: number, to: number) {
    const f = new HeadingFusion();
    const a = run(f, 1000, 1000, () => ({ gps: gps(from), compass: null }));
    expect(a.frames[a.frames.length - 1].heading).toBeCloseTo(from, 9);
    const b = run(f, a.now, 500, (now) => ({ gps: gps(from), compass: compass(to, now) }));
    return { before: a.frames[a.frames.length - 1], after: b.frames };
  }

  it('eases from GPS to the compass over about 0.3 s, without a jump', () => {
    const { before, after } = switchOver(0, 90);
    let prev = before.heading!;
    for (const fr of after) {
      // No frame turns by more than ~1.5x the average speed of a 90° ease in 0.3 s.
      expect(apart(fr.heading!, prev)).toBeLessThan(8);
      expect(fr.heading!).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = fr.heading!;
    }
    expect(apart(after[0].heading!, 0)).toBeLessThan(1);
    const t0 = after[0].now;
    const mid = after.find((fr) => fr.now - t0 >= 150)!;
    expect(mid.heading!).toBeGreaterThan(30);
    expect(mid.heading!).toBeLessThan(60);
    expect(mid.settling).toBe(true);
    const done = after.find((fr) => fr.now - t0 >= 301)!;
    expect(done.heading).toBeCloseTo(90, 9);
    expect(after[after.length - 1].settling).toBe(false);
  });

  it('turns the short way round across north, and stays in [0, 360)', () => {
    const { after } = switchOver(350, 10);
    for (const fr of after) {
      expect(fr.heading!).toBeGreaterThanOrEqual(0);
      expect(fr.heading!).toBeLessThan(360);
      // Never via the south.
      expect(apart(fr.heading!, 0)).toBeLessThanOrEqual(10 + 1e-9);
    }
    expect(after[after.length - 1].heading).toBeCloseTo(10, 9);
    const back = switchOver(10, 350).after;
    for (const fr of back) expect(apart(fr.heading!, 0)).toBeLessThanOrEqual(10 + 1e-9);
    expect(back[back.length - 1].heading).toBeCloseTo(350, 9);
  });

  it('follows a compass that keeps turning during the switch', () => {
    const f = new HeadingFusion();
    const a = run(f, 1000, 500, () => ({ gps: gps(300), compass: null }));
    // Turning the phone at 120°/s from 330°, through north.
    const t0 = a.now;
    const look = (now: number) => wrap360(330 + ((now - t0) / 1000) * 120);
    const b = run(f, t0, 800, (now) => ({ gps: gps(300), compass: compass(look(now), now) }));
    let prev = a.frames[a.frames.length - 1].heading!;
    for (const fr of b.frames) {
      expect(apart(fr.heading!, prev)).toBeLessThan(6);
      prev = fr.heading!;
    }
    const last = b.frames[b.frames.length - 1];
    expect(last.heading).toBeCloseTo(look(last.now), 6);
  });

  it('back to GPS when the compass goes stale, easing the other way', () => {
    const f = new HeadingFusion();
    const a = run(f, 1000, 600, (now) => ({ gps: gps(180), compass: compass(270, now) }));
    expect(a.frames[a.frames.length - 1].heading).toBeCloseTo(270, 9);
    const lastT = a.now - FRAME;
    // The compass stops reporting; its last reading goes stale after a second.
    const b = run(f, a.now, 1800, () => ({ gps: gps(180), compass: compass(270, lastT) }));
    let prev = a.frames[a.frames.length - 1].heading!;
    for (const fr of b.frames) {
      expect(apart(fr.heading!, prev)).toBeLessThan(8);
      prev = fr.heading!;
    }
    const staleAt = b.frames.findIndex((fr) => fr.source === 'gps');
    expect(b.frames[staleAt].now - lastT).toBeGreaterThanOrEqual(COMPASS_FRESH_MS);
    expect(b.frames[b.frames.length - 1].heading).toBeCloseTo(180, 9);
  });

  it('a switch in the middle of a switch carries on from where the beam is', () => {
    const f = new HeadingFusion();
    let now = run(f, 1000, 500, () => ({ gps: gps(0), compass: null })).now;
    now = run(f, now, 100, (t) => ({ gps: gps(0), compass: compass(90, t) })).now;
    const mid = f.update(now, gps(0), compass(90, now)).heading!;
    expect(mid).toBeGreaterThan(5);
    expect(mid).toBeLessThan(85);
    // The compass is gone again at once.
    const next = f.update(now + FRAME, gps(0), null);
    expect(apart(next.heading!, mid)).toBeLessThan(3);
    const end = run(f, now + 2 * FRAME, 400, () => ({ gps: gps(0), compass: null })).frames;
    expect(end[end.length - 1].heading).toBeCloseTo(0, 9);
  });

  it('standing still, losing the compass fades the cone out and keeps its direction', () => {
    const f = new HeadingFusion();
    const a = run(f, 1000, 600, (now) => ({ gps: gps(null), compass: compass(45, now) }));
    expect(a.frames[a.frames.length - 1].cone).toBe(1);
    const b = run(f, a.now, 600, () => ({ gps: gps(null), compass: null }));
    let prev = 1;
    for (const fr of b.frames) {
      expect(fr.heading).toBeCloseTo(45, 9);
      expect(fr.cone).toBeLessThanOrEqual(prev);
      expect(prev - fr.cone).toBeLessThan(0.07);
      prev = fr.cone;
    }
    expect(b.frames[b.frames.length - 1]).toMatchObject({ cone: 0, source: null, heading: 45 });
  });

  it('with the beam off, turns at once instead of sweeping', () => {
    const f = new HeadingFusion();
    run(f, 1000, 600, () => ({ gps: gps(10, 0), compass: null }));
    const out = f.update(1700, gps(10, 0), compass(200, 1700));
    expect(out.heading).toBe(200);
    expect(out.source).toBe('compass');
  });

  it('reset forgets the beam', () => {
    const f = new HeadingFusion();
    run(f, 1000, 600, (now) => ({ gps: gps(null), compass: compass(45, now) }));
    f.reset();
    expect(f.update(2000, gps(null), null)).toMatchObject({ heading: null, cone: 0, source: null });
  });
});
