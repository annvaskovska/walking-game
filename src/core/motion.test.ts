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
function walkNorth(opts: { n: number; speed?: number; noise?: number; everyMs?: number; extra?: (i: number, fix: Fix) => Fix }): Walk {
  const { n, speed = 1.4, noise = 3, everyMs = 1000 } = opts;
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
      const f = m.frame(now)!;
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
});
