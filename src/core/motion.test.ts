import { describe, expect, it } from 'vitest';
import { metresPerDegree } from '../geo/geo';
import { Motion, type MotionFrame } from './motion';
import type { Fix } from './types';

const LON0 = 4.88, LAT0 = 52.37;
const M = metresPerDegree(LAT0);
const toLL = (x: number, y: number) => ({ lon: LON0 + x / M.lon, lat: LAT0 + y / M.lat });
const toXY = (f: { lon: number; lat: number }) => ({ x: (f.lon - LON0) * M.lon, y: (f.lat - LAT0) * M.lat });

/** Deterministic Gaussian noise. */
function gauss(seed: number): () => number {
  let s = seed >>> 0;
  const u = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return () => Math.sqrt(-2 * Math.log(u() + 1e-12)) * Math.cos(2 * Math.PI * u());
}

interface Walk {
  frames: { t: number; x: number; y: number; f: MotionFrame }[];
}

/**
 * Feed fixes of a walker at `speed` m/s heading north along x = 0, one per `everyMs` of frame
 * time (fix timestamps always one second apart, like the 10x simulator), drawing at 60 fps.
 */
function walkNorth(opts: {
  n: number; speed?: number; noise?: number; everyMs?: number; holdM?: number; extra?: (i: number, fix: Fix) => Fix;
}): Walk {
  const { n, speed = 1.4, noise = 3, everyMs = 1000, holdM = 0 } = opts;
  const rnd = gauss(7);
  const m = new Motion();
  const frames: Walk['frames'] = [];
  let now = 1000;
  for (let i = 0; i < n; i++) {
    let fix: Fix = { ...toLL(rnd() * noise, i * speed + rnd() * noise), acc: 8, t: 1_000_000 + i * 1000, speed, heading: 0 };
    if (opts.extra) fix = opts.extra(i, fix);
    m.push(fix, now);
    for (let k = 0; k < Math.round(everyMs / 16.667); k++) {
      now += 16.667;
      const f = m.frame(now, holdM)!;
      const p = toXY(f);
      frames.push({ t: now, x: p.x, y: p.y, f });
    }
  }
  return { frames };
}

describe('Motion', () => {
  it('places the walker on the first fix at once', () => {
    const m = new Motion();
    expect(m.frame(0)).toBeNull();
    m.push({ ...toLL(10, 20), acc: 5, t: 1000 }, 100);
    const p = toXY(m.frame(116)!);
    expect(p.x).toBeCloseTo(10, 6);
    expect(p.y).toBeCloseTo(20, 6);
  });

  it('smooths GPS noise into a steady walk', () => {
    const { frames } = walkNorth({ n: 60, noise: 3 });
    const steady = frames.slice(frames.length / 3);
    // Raw fixes wander ±3 m sideways; the drawn walker stays close to the street.
    const lateral = Math.sqrt(steady.reduce((s, p) => s + p.x * p.x, 0) / steady.length);
    expect(lateral).toBeLessThan(1.6);
    // It keeps moving forward between fixes (no stop-and-go).
    let backwards = 0, stalls = 0;
    for (let i = 1; i < steady.length; i++) {
      const dy = steady[i].y - steady[i - 1].y;
      if (dy < 0) backwards++;
      if (dy < 0.002) stalls++;
    }
    expect(backwards).toBe(0);
    expect(stalls / steady.length).toBeLessThan(0.05);
    // Frame-to-frame speed varies little: no hopping.
    const speeds = steady.slice(1).map((p, i) => (p.y - steady[i].y) / 0.016667);
    const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
    expect(mean).toBeGreaterThan(1.2);
    expect(mean).toBeLessThan(1.6);
    expect(Math.max(...speeds)).toBeLessThan(mean * 2.2);
  });

  it('ignores a single glitch far off the street', () => {
    const { frames } = walkNorth({
      n: 40,
      extra: (i, fix) => (i === 25 ? { ...fix, lat: fix.lat + 260 / M.lat } : fix),
    });
    let maxStep = 0;
    for (let i = 1; i < frames.length; i++) {
      maxStep = Math.max(maxStep, Math.hypot(frames[i].x - frames[i - 1].x, frames[i].y - frames[i - 1].y));
    }
    expect(maxStep).toBeLessThan(0.2);
  });

  it('trusts a new place after a few consistent fixes there', () => {
    const m = new Motion();
    let now = 0;
    for (let i = 0; i < 10; i++) m.push({ ...toLL(0, i * 1.4), acc: 5, t: i * 1000 }, (now += 1000));
    // Three fixes 2 km away (a train ride the filter did not see).
    for (let i = 10; i < 13; i++) m.push({ ...toLL(2000, 0), acc: 5, t: i * 1000 }, (now += 1000));
    const p = toXY(m.frame(now + 16)!);
    expect(Math.hypot(p.x - 2000, p.y)).toBeLessThan(1);
  });

  it('keeps up with the 10x simulator', () => {
    const { frames } = walkNorth({ n: 120, noise: 2, everyMs: 100 });
    const last = frames[frames.length - 1];
    // 119 fixes 1.4 m apart: the walker should be near 166 m, not lagging a long way behind.
    expect(last.y).toBeGreaterThan(155);
    expect(last.y).toBeLessThan(172);
  });

  it('heads where you walk, then lets the cone fade when you stop', () => {
    const m = new Motion();
    let now = 0;
    // East at walking speed, without a device course: heading comes from the filter.
    for (let i = 0; i < 12; i++) {
      m.push({ ...toLL(i * 1.4, 0), acc: 5, t: i * 1000 }, (now += 1000));
      for (let k = 0; k < 60; k++) m.frame((now += 16.667));
    }
    let f = m.frame((now += 16.667))!;
    expect(f.heading).not.toBeNull();
    expect(Math.abs(f.heading! - 90)).toBeLessThan(8);
    expect(f.cone).toBeCloseTo(1, 5);
    // Standing still for 8 s: the heading is held, then the cone fades out and the walker settles.
    for (let i = 12; i < 20; i++) {
      m.push({ ...toLL(11 * 1.4, 0), acc: 5, t: i * 1000, speed: 0 }, (now += 1000));
      for (let k = 0; k < 60; k++) f = m.frame((now += 16.667))!;
    }
    expect(f.cone).toBe(0);
    expect(f.moving).toBe(false);
  });

  it('turns the short way round', () => {
    const m = new Motion();
    let now = 0;
    let t = 0;
    const push = (x: number, y: number, heading: number) => m.push({ ...toLL(x, y), acc: 5, t: (t += 1000), speed: 1.4, heading }, (now += 1000));
    push(0, 0, 350);
    push(0, 1.4, 350);
    m.frame((now += 16));
    m.frame((now += 16));
    push(0, 2.8, 10);
    const seen: number[] = [];
    for (let k = 0; k < 90; k++) seen.push(m.frame((now += 16.667))!.heading!);
    // From 350 to 10 through north: never anywhere near south.
    for (const h of seen) expect(h > 340 || h < 20).toBe(true);
    expect(seen[seen.length - 1]).toBeGreaterThan(5);
    expect(seen[seen.length - 1]).toBeLessThan(15);
  });

  it('snaps after a long jump instead of sliding across town', () => {
    const m = new Motion();
    m.push({ ...toLL(0, 0), acc: 5, t: 0 }, 0);
    m.frame(16);
    // 20 s later, 600 m away: a fresh start, not a slide.
    m.push({ ...toLL(600, 0), acc: 5, t: 20_000 }, 20_000);
    const p = toXY(m.frame(20_016)!);
    expect(p.x).toBeCloseTo(600, 3);
  });

  describe('standing still', () => {
    /** A map pixel at zoom 17 in Amsterdam (m). */
    const PX = 0.36;

    /**
     * Stand at the origin for `seconds`, one fix a second 1.5 m off at random (speed 0, like a
     * phone at rest), drawing at 60 fps.
     */
    function stand(m: Motion, seconds: number, holdM: number, start = { now: 1000, i: 0 }) {
      const rnd = gauss(11);
      const out: { x: number; y: number; moving: boolean }[] = [];
      for (let s = 0; s < seconds; s++, start.i++) {
        m.push({ ...toLL(rnd() * 1.5, rnd() * 1.5), acc: 8, t: 1_000_000 + start.i * 1000, speed: 0 }, start.now);
        for (let k = 0; k < 60; k++) {
          const f = m.frame((start.now += 16.667), holdM)!;
          out.push({ ...toXY(f), moving: f.moving });
        }
      }
      return out;
    }

    const changed = (fr: { x: number; y: number }[]) =>
      fr.slice(1).filter((p, i) => p.x !== fr[i].x || p.y !== fr[i].y).length / (fr.length - 1);

    it('holds the walker in GPS noise instead of sliding it a fraction of a pixel every frame', () => {
      const free = stand(new Motion(), 40, 0).slice(600);
      const held = stand(new Motion(), 40, PX).slice(600);
      // Without the hold the walker creeps on almost every frame, and counts as moving.
      expect(changed(free)).toBeGreaterThan(0.9);
      // Held, it moves on a few frames only, when its target is more than a pixel away...
      expect(changed(held)).toBeLessThan(0.25);
      expect(held.filter((p) => p.moving).length / held.length).toBeLessThan(0.25);
      // ...and then by hundredths of a pixel a frame, never a hop.
      const steps = held.slice(1).map((p, i) => Math.hypot(p.x - held[i].x, p.y - held[i].y));
      expect(Math.max(...steps)).toBeLessThan(PX * 0.1);
      // And it stays where the free walker is, within a pixel or so.
      const off = held.map((p, i) => Math.hypot(p.x - free[i].x, p.y - free[i].y));
      expect(Math.max(...off)).toBeLessThan(PX * 2.5);
    });

    it('never holds a walker who walks', () => {
      const { frames } = walkNorth({ n: 60, noise: 3, holdM: PX * 4 });
      const steady = frames.slice(frames.length / 3);
      let stalls = 0;
      for (let i = 1; i < steady.length; i++) if (steady[i].y - steady[i - 1].y < 0.002) stalls++;
      expect(stalls / steady.length).toBeLessThan(0.05);
      expect(steady.every((p) => p.f.moving)).toBe(true);
    });

    it('lets go from rest, without a jump, when you set off', () => {
      const m = new Motion();
      const clock = { now: 1000, i: 0 };
      stand(m, 20, PX, clock);
      const rest = toXY(m.frame((clock.now += 16.667), PX)!);
      const path: { x: number; y: number }[] = [rest];
      for (let s = 1; s <= 8; s++, clock.i++) {
        m.push({ ...toLL(0, s * 1.4), acc: 8, t: 1_000_000 + clock.i * 1000, speed: 1.4, heading: 0 }, clock.now);
        for (let k = 0; k < 60; k++) path.push(toXY(m.frame((clock.now += 16.667), PX)!));
      }
      let maxStep = 0;
      for (let i = 1; i < path.length; i++) {
        maxStep = Math.max(maxStep, Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y));
      }
      // At 60 fps a walk is ~2.3 cm a frame: catching up may take a few times that, never a hop.
      expect(maxStep).toBeLessThan(0.12);
      expect(path[path.length - 1].y).toBeGreaterThan(7);
    });

    it('holds nothing without a pixel size', () => {
      const m = new Motion();
      m.push({ ...toLL(0, 0), acc: 5, t: 1000 }, 0);
      m.frame(16);
      m.push({ ...toLL(0.05, 0), acc: 5, t: 2000, speed: 0 }, 1000);
      let f = m.frame(1016)!;
      for (let t = 1032; t < 3000; t += 16) f = m.frame(t)!;
      expect(toXY(f).x).toBeGreaterThan(0.001);
    });
  });
});
