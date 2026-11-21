import { describe, expect, it } from 'vitest';
import { wrap180, wrap360 } from '../core/heading';
import { createCompass, lookHeading, type CompassHost, type OrientationSample } from './compass';

const D = Math.PI / 180;
const apart = (a: number, b: number) => Math.abs(wrap180(a - b));

// ---- Poses: rotation matrices (row-major), device axes → earth (x east, y north, z up) ----
type M = number[];
const mul = (a: M, b: M): M => {
  const r = new Array<number>(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
};
const rz = (deg: number): M => {
  const c = Math.cos(deg * D), s = Math.sin(deg * D);
  return [c, -s, 0, s, c, 0, 0, 0, 1];
};
const rx = (deg: number): M => {
  const c = Math.cos(deg * D), s = Math.sin(deg * D);
  return [1, 0, 0, 0, c, -s, 0, s, c];
};
const ry = (deg: number): M => {
  const c = Math.cos(deg * D), s = Math.sin(deg * D);
  return [c, 0, s, 0, 1, 0, -s, 0, c];
};
/** The W3C pose: R = Rz(alpha) Rx(beta) Ry(gamma). */
const fromEuler = (a: number, b: number, g: number) => mul(mul(rz(a), rx(b)), ry(g));
/** W3C Euler angles of a pose: alpha [0, 360), beta [-180, 180), gamma [-90, 90). */
function toEuler(r: M): [number, number, number] {
  let b = Math.asin(Math.max(-1, Math.min(1, r[7]))) / D;
  let a: number, g: number;
  if (Math.cos(b * D) < 1e-9) {
    g = 0;
    a = Math.atan2(r[3], r[0]) / D;
  } else {
    g = Math.atan2(-r[6], r[8]) / D;
    a = Math.atan2(-r[1], r[4]) / D;
  }
  if (g < -90 || g >= 90) {
    b = 180 - b;
    g += 180;
    a += 180;
  }
  return [wrap360(a), wrap180(b), wrap180(g)];
}
/** Where the back of the phone faces (heading of -z). */
const backHeading = (r: M) => wrap360(Math.atan2(-r[2], -r[5]) / D);
/**
 * iOS's heading, from its description: the yaw left once the tilt is undone by the shortest
 * rotation, i.e. the heading of the top after rotating the screen normal up along a great circle.
 */
function untiltedTopHeading(r: M): number {
  const n = [r[2], r[5], r[8]], top = [r[1], r[4], r[7]];
  // Axis n × up, angle between n and up (Rodrigues).
  let k = [n[1], -n[0], 0];
  const s = Math.hypot(k[0], k[1]);
  if (s < 1e-12) return wrap360(Math.atan2(top[0], top[1]) / D);
  k = [k[0] / s, k[1] / s, 0];
  const th = Math.acos(Math.max(-1, Math.min(1, n[2])));
  const c = Math.cos(th), sn = Math.sin(th);
  const kd = k[0] * top[0] + k[1] * top[1];
  const kx = [k[1] * top[2], -k[0] * top[2], k[0] * top[1] - k[1] * top[0]];
  const v = [0, 1, 2].map((i) => top[i] * c + kx[i] * sn + k[i] * kd * (1 - c));
  return wrap360(Math.atan2(v[0], v[1]) / D);
}
/** What iOS reports as webkitCompassHeading (measured, AR-js-org/locar.js#39). */
const iosCompass = (a: number, b: number, g: number) =>
  wrap360(-(a + (2 * Math.atan2(Math.sin((b * D) / 2) * Math.sin((g * D) / 2), Math.cos((b * D) / 2) * Math.cos((g * D) / 2))) / D));

/** Phone held up, camera `elev` degrees above the horizon facing `h`, rolled `roll` degrees in your hand. */
const heldUp = (h: number, elev: number, roll: number) => mul(mul(rz(-h), rx(90 + elev)), rz(roll));
/** Phone with its top towards `h`, raised `pitch` degrees from flat, tipped `tip` degrees about its long side. */
const reading = (h: number, pitch: number, tip = 0) => mul(mul(rz(-h), rx(pitch)), ry(tip));

/** Both platforms' answer for a pose. */
function both(r: M, screen = 0): { ios: number; android: number } {
  const [a, b, g] = toEuler(r);
  return { ios: lookHeading('ios', iosCompass(a, b, g), b, g, screen), android: lookHeading('absolute', a, b, g, screen) };
}

describe('poses', () => {
  it('the test helpers agree with each other', () => {
    for (const [a, b, g] of [[10, 20, 30], [200, -120, 45], [300, 170, -80], [5, 89, 10]]) {
      const [a2, b2, g2] = toEuler(fromEuler(a, b, g));
      expect(apart(a2, a)).toBeLessThan(1e-6);
      expect(apart(b2, b)).toBeLessThan(1e-6);
      expect(apart(g2, g)).toBeLessThan(1e-6);
    }
    // The measured iOS formula is the yaw left after undoing the tilt by the shortest rotation.
    for (let i = 0; i < 200; i++) {
      const a = (i * 137.5) % 360, b = ((i * 61) % 340) - 170, g = ((i * 29) % 178) - 89;
      const r = fromEuler(a, b, g);
      if (r[8] < -0.6) continue;
      expect(apart(iosCompass(a, b, g), untiltedTopHeading(r))).toBeLessThan(1e-6);
    }
  });

  it('flat: where the top points', () => {
    for (const h of [0, 45, 170, 300]) {
      const { ios, android } = both(reading(h, 0));
      expect(apart(ios, h)).toBeLessThan(1e-6);
      expect(apart(android, h)).toBeLessThan(1e-6);
    }
  });

  it('reading the map, raised or not: the way the top points', () => {
    for (const h of [0, 100, 359]) {
      for (const pitch of [10, 30, 45, 60, 80]) {
        const { ios, android } = both(reading(h, pitch));
        expect(apart(ios, h)).toBeLessThan(1e-6);
        expect(apart(android, h)).toBeLessThan(1e-6);
      }
    }
  });

  it('held up like a camera: where the back faces, however crooked', () => {
    for (const h of [0, 90, 225]) {
      for (const elev of [-20, -5, 0, 10]) {
        for (const roll of [-30, -10, 0, 15, 30]) {
          const r = heldUp(h, elev, roll);
          expect(backHeading(r)).toBeCloseTo(h, 6);
          const { ios, android } = both(r);
          expect(apart(ios, h)).toBeLessThan(1e-6);
          expect(apart(android, h)).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('flat-ish and tipped sideways: close to where the top points', () => {
    for (const tip of [-15, 15]) {
      const { ios, android } = both(reading(80, 30, tip));
      expect(apart(ios, 80)).toBeLessThan(5);
      expect(apart(android, ios)).toBeLessThan(1e-6);
    }
  });

  it('iOS and Android agree on any pose, and turn smoothly between flat and held up', () => {
    for (let i = 0; i < 500; i++) {
      const a = (i * 97.3) % 360, b = ((i * 53.7) % 340) - 170, g = ((i * 31.1) % 178) - 89;
      const r = fromEuler(a, b, g);
      const { ios, android } = both(r, (i % 4) * 90);
      if (r[8] < -0.6) {
        expect(ios).toBeNaN();
        expect(android).toBeNaN();
        continue;
      }
      expect(apart(ios, android)).toBeLessThan(1e-6);
    }
    // Raising the phone from flat to upright while crooked: no jumps.
    let prev = both(mul(reading(40, 0), rz(20))).android;
    for (let p = 1; p <= 100; p++) {
      const h = both(mul(reading(40, p), rz(20))).android;
      expect(apart(h, prev)).toBeLessThan(3);
      prev = h;
    }
  });

  it('accounts for the screen turned sideways', () => {
    // Flat in landscape (screen rotated 90°): the top of the phone points west, the screen's north.
    expect(apart(lookHeading('absolute', 90, 0, 0, 90), 0)).toBeLessThan(1e-9);
    expect(apart(lookHeading('ios', 270, 0, 0, 90), 0)).toBeLessThan(1e-9);
    // Landscape, screen top raised 30° towards 120°.
    for (const screen of [90, 270]) {
      const { ios, android } = both(mul(reading(120, 30), rz(screen)), screen);
      expect(apart(ios, 120)).toBeLessThan(1e-6);
      expect(apart(android, 120)).toBeLessThan(1e-6);
    }
    // Held up in landscape: still where the back faces.
    const { ios, android } = both(heldUp(200, 0, 90), 90);
    expect(apart(ios, 200)).toBeLessThan(1e-6);
    expect(apart(android, 200)).toBeLessThan(1e-6);
  });

  it('face down is no heading', () => {
    expect(both(fromEuler(0, 180, 0)).android).toBeNaN();
    expect(both(fromEuler(0, 0, 0)).android).not.toBeNaN();
    // Held overhead, the camera 50° up: ignored (iOS flips its heading past 45°).
    expect(both(heldUp(0, 50, 0)).ios).toBeNaN();
    expect(both(heldUp(0, 30, 0)).ios).toBeCloseTo(0, 6);
  });
});

// ---- The compass on a fake window ----
class FakeHost implements CompassHost {
  listeners = new Map<string, Set<(e: OrientationSample) => void>>();
  clock = 1000;
  performance = { now: () => this.clock };
  screen = { orientation: { angle: 0 } };
  DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } = {};
  constructor(events: string[]) {
    for (const e of events) (this as Record<string, unknown>)['on' + e] = null;
  }
  addEventListener(type: string, fn: (e: OrientationSample) => void) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type)!.add(fn);
  }
  removeEventListener(type: string, fn: (e: OrientationSample) => void) {
    this.listeners.get(type)?.delete(fn);
  }
  count(type: string) {
    return this.listeners.get(type)?.size ?? 0;
  }
  fire(type: string, e: Partial<OrientationSample>) {
    const full: OrientationSample = { alpha: null, beta: null, gamma: null, ...e };
    for (const fn of this.listeners.get(type) ?? []) fn(full);
  }
}
const chrome = () => new FakeHost(['deviceorientation', 'deviceorientationabsolute']);
const safari = () => new FakeHost(['deviceorientation']);
/** iOS event for a phone flat with its top towards `h`. */
const iosFlat = (h: number, acc = 10): Partial<OrientationSample> => ({
  alpha: 123, beta: 0, gamma: 0, absolute: false, webkitCompassHeading: h, webkitCompassAccuracy: acc,
});

describe('createCompass', () => {
  it('does nothing on a desktop browser without orientation events', async () => {
    const host = { addEventListener() {}, removeEventListener() {}, performance: { now: () => 0 } };
    const c = createCompass(host);
    expect(c.supported).toBe(false);
    c.start();
    expect(c.read(0)).toBeNull();
    c.stop();
    expect(await c.requestPermission()).toBe('not-needed');
    // And in node, on the real global.
    expect(createCompass().supported).toBe(false);
  });

  it('listens to the absolute stream on Chrome (its plain one has no north)', () => {
    const host = chrome();
    const c = createCompass(host);
    expect(c.supported).toBe(true);
    c.start();
    c.start();
    expect(host.count('deviceorientationabsolute')).toBe(1);
    expect(host.count('deviceorientation')).toBe(0);
    host.fire('deviceorientationabsolute', { alpha: 90, beta: 0, gamma: 0, absolute: true });
    expect(c.read(host.clock)).toMatchObject({ heading: 270, accuracy: null, t: 1000 });
    c.stop();
    expect(host.count('deviceorientationabsolute')).toBe(0);
    expect(c.read(host.clock)).toBeNull();
  });

  it('ignores events with no sensor behind them', () => {
    const host = chrome();
    const c = createCompass(host);
    c.start();
    host.fire('deviceorientationabsolute', { absolute: true });
    expect(c.read(host.clock)).toBeNull();
  });

  it('uses webkitCompassHeading on iOS, with its accuracy, and skips it uncalibrated', () => {
    const host = safari();
    const c = createCompass(host);
    c.start();
    expect(host.count('deviceorientation')).toBe(1);
    host.fire('deviceorientation', iosFlat(0, -1));
    expect(c.read(host.clock)).toBeNull();
    host.fire('deviceorientation', iosFlat(42, 15));
    expect(c.read(host.clock)).toMatchObject({ heading: 42, accuracy: 15 });
    // A relative event (no compass) changes nothing.
    host.clock += 10;
    host.fire('deviceorientation', { alpha: 300, beta: 0, gamma: 0, absolute: false });
    expect(c.read(host.clock)!.heading).toBeCloseTo(42, 9);
  });

  it('takes absolute deviceorientation events where there is no absolute event (Firefox)', () => {
    const host = safari();
    const c = createCompass(host);
    c.start();
    host.fire('deviceorientation', { alpha: 30, beta: 0, gamma: 0, absolute: true });
    expect(c.read(host.clock)!.heading).toBeCloseTo(330, 9);
  });

  it('turns with the screen rotation', () => {
    const host = chrome();
    host.screen.orientation.angle = 90;
    const c = createCompass(host);
    c.start();
    host.fire('deviceorientationabsolute', { alpha: 90, beta: 0, gamma: 0, absolute: true });
    expect(c.read(host.clock)!.heading).toBeCloseTo(0, 9);
  });

  it('says nothing face down, and nothing once readings stop', () => {
    const host = safari();
    const c = createCompass(host);
    c.start();
    host.fire('deviceorientation', { ...iosFlat(10), beta: 179, gamma: 1 });
    expect(c.read(host.clock)).toBeNull();
    host.fire('deviceorientation', iosFlat(10));
    expect(c.read(host.clock)).not.toBeNull();
    expect(c.read(host.clock + 999)).not.toBeNull();
    expect(c.read(host.clock + 1001)).toBeNull();
  });

  it('smooths along the short way round, the same at any frame rate', () => {
    /** Turn from 350° to 10° (the phone reports at 60 Hz), read at `fps`; heading per read. */
    const turn = (fps: number, frames: number) => {
      const host = safari();
      const c = createCompass(host);
      c.start();
      host.fire('deviceorientation', iosFlat(350));
      c.read(host.clock);
      const t0 = host.clock;
      const seen: number[] = [];
      for (let i = 1; i <= frames; i++) {
        host.clock = t0 + (i * 1000) / fps;
        host.fire('deviceorientation', iosFlat(10));
        seen.push(c.read(host.clock)!.heading);
      }
      return seen;
    };
    const fast = turn(60, 60), slow = turn(15, 15);
    // Never via the south.
    for (const h of [...fast, ...slow]) expect(apart(h, 0)).toBeLessThanOrEqual(10 + 1e-9);
    // After 133 ms (8 frames at 60 fps, 2 at 15): the exponential, whatever the frame rate.
    const expected = 10 - 20 * Math.exp(-(400 / 3) / 120);
    expect(apart(fast[7], expected)).toBeLessThan(1e-6);
    expect(apart(slow[1], expected)).toBeLessThan(1e-6);
    // About 63% of the way after one time constant (0.12 s).
    expect(apart(fast[6], 350 + 20 * (1 - Math.exp(-(350 / 3) / 120)))).toBeLessThan(1e-6);
    expect(apart(fast[59], 10)).toBeLessThan(0.01);
    expect(apart(slow[14], 10)).toBeLessThan(0.01);
  });

  it('starts over at the reading after a gap instead of sweeping', () => {
    const host = safari();
    const c = createCompass(host);
    c.start();
    host.fire('deviceorientation', iosFlat(0));
    c.read(host.clock);
    host.clock += 800;
    host.fire('deviceorientation', iosFlat(180));
    expect(c.read(host.clock)!.heading).toBe(180);
  });

  it('asks iOS for leave once at a time, and never throws', async () => {
    const host = safari();
    let calls = 0;
    let answer: (s: string) => void = () => {};
    host.DeviceOrientationEvent = {
      requestPermission: () => {
        calls++;
        return new Promise<string>((r) => (answer = r));
      },
    };
    const c = createCompass(host);
    const p1 = c.requestPermission(), p2 = c.requestPermission();
    expect(calls).toBe(1);
    answer('granted');
    expect(await p1).toBe('granted');
    expect(await p2).toBe('granted');
    host.DeviceOrientationEvent.requestPermission = () => Promise.resolve('denied');
    expect(await c.requestPermission()).toBe('denied');
    host.DeviceOrientationEvent.requestPermission = () => Promise.reject(new DOMException('no gesture', 'NotAllowedError'));
    expect(await c.requestPermission()).toBe('denied');
    host.DeviceOrientationEvent.requestPermission = () => {
      throw new Error('boom');
    };
    expect(await c.requestPermission()).toBe('denied');
    host.DeviceOrientationEvent = {};
    expect(await c.requestPermission()).toBe('not-needed');
  });
});
