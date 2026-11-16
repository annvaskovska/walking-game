import { metresPerDegree } from '../geo/geo';
import type { Fix } from './types';

/**
 * Smooth, honest motion for the walker on the map.
 *
 * Fixes arrive about once a second, each a few metres off. Drawn as they come, the walker hops;
 * eased to one by one, it lurches. Like navigation apps, this:
 *  1. filters fixes with a constant-velocity Kalman filter (position and velocity per axis), which
 *     weighs each fix by its accuracy and drops outliers by how surprising they are;
 *  2. glides a target from where it is to the filtered position over about one fix interval, so
 *     the walker never stops between fixes;
 *  3. lets the drawn position follow that target through a critically damped spring, which
 *     rounds off the corners of the glide.
 * Heading comes from the GPS course while moving, else from the filtered velocity, is held for a
 * moment after you stop, and turns along the shortest arc.
 *
 * The filter runs on fix timestamps and the drawing on the frame clock, so the 10x simulator
 * (whose fixes say "one second later" every 100 ms) looks like a fast walk, not a broken one.
 */

export interface MotionFrame {
  lon: number;
  lat: number;
  /** Degrees clockwise from north, or null before any movement. */
  heading: number | null;
  /** How visible the heading cone is, 0..1 (fades out a few seconds after you stop). */
  cone: number;
  /** Is the drawn walker still moving (worth drawing every frame)? */
  moving: boolean;
  /** Accuracy of the last accepted fix, metres. */
  acc: number;
}

/** Acceleration noise of a walker, m²/s³. */
const Q = 0.3;
/** Chi-square gate for 2 degrees of freedom at 99.9%. */
const GATE = 13.8;
const MAX_REJECTS = 3;
const RESET_GAP_S = 10;
const SNAP_M = 100;
const SMOOTH_S = 0.3;
const HEADING_HOLD_MS = 3000;
const HEADING_TAU_S = 0.4;
const CONE_FADE_S = 0.35;
/** Doppler speed noise, m/s. */
const SPEED_SD = 0.5;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

export class Motion {
  private ready = false;
  private lon0 = 0;
  private lat0 = 0;
  private mx = 1;
  private my = 1;
  // Kalman state, metres east/north of the origin, and the covariance shared by both axes.
  private px = 0;
  private py = 0;
  private vx = 0;
  private vy = 0;
  private a = 0;
  private b = 0;
  private c = 0;
  private lastT = 0;
  private rejects = 0;
  // Glide of the target between fixes (frame clock, ms).
  private g0x = 0;
  private g0y = 0;
  private g1x = 0;
  private g1y = 0;
  private gStart = 0;
  private gDur = 1000;
  private interval = 1000;
  private lastArrival = 0;
  // The drawn position and its spring velocity.
  private dx = 0;
  private dy = 0;
  private svx = 0;
  private svy = 0;
  private lastFrame = 0;
  // Heading.
  private heading: number | null = null;
  private targetHeading: number | null = null;
  private headingAt = -Infinity;
  private cone = 0;
  private acc = 0;

  get hasFix(): boolean {
    return this.ready;
  }

  /** The filtered position (where the walker is heading for). */
  get position(): { lon: number; lat: number } | null {
    return this.ready ? this.toLonLat(this.px, this.py) : null;
  }

  /** Forget everything; the next fix places the walker at once. */
  reset(): void {
    this.ready = false;
    this.heading = this.targetHeading = null;
    this.headingAt = -Infinity;
    this.cone = 0;
  }

  /** Jump the drawn walker to its target (after the tab was hidden, say). */
  snap(): void {
    if (!this.ready) return;
    this.g0x = this.g1x = this.dx = this.px;
    this.g0y = this.g1y = this.dy = this.py;
    this.svx = this.svy = 0;
    this.gDur = 0;
  }

  /** Feed a fix. `arrival` is the frame clock (performance.now) when it came in. Returns false if it was dropped. */
  push(fix: Fix, arrival: number): boolean {
    if (!Number.isFinite(fix.lon) || !Number.isFinite(fix.lat)) return false;
    const t = fix.t / 1000;
    this.acc = fix.acc;
    if (!this.ready || t - this.lastT > RESET_GAP_S) {
      this.start(fix, t, arrival);
      return true;
    }
    const dt = t - this.lastT;
    if (dt <= 0) return false;

    // Predict.
    this.px += this.vx * dt;
    this.py += this.vy * dt;
    this.a += 2 * dt * this.b + dt * dt * this.c + (Q * dt * dt * dt) / 3;
    this.b += dt * this.c + (Q * dt * dt) / 2;
    this.c += Q * dt;
    this.lastT = t;

    // Update with the position, unless it is an outlier.
    const r = Math.max(fix.acc / 1.5, 2) ** 2;
    const ix = this.x(fix.lon) - this.px;
    const iy = this.y(fix.lat) - this.py;
    const s = this.a + r;
    if ((ix * ix + iy * iy) / s > GATE) {
      if (++this.rejects >= MAX_REJECTS) {
        this.start(fix, t, arrival);
        return true;
      }
      return false;
    }
    this.rejects = 0;
    let k0 = this.a / s;
    let k1 = this.b / s;
    this.px += k0 * ix;
    this.py += k0 * iy;
    this.vx += k1 * ix;
    this.vy += k1 * iy;
    this.c -= k1 * this.b;
    this.b *= 1 - k0;
    this.a *= 1 - k0;

    // Update with the Doppler velocity when the device has one: a known course, or standing still.
    const speed = fix.speed != null && fix.speed >= 0 ? fix.speed : null;
    const course = fix.heading != null && Number.isFinite(fix.heading) ? fix.heading : null;
    if (speed !== null && (speed < 0.3 || course !== null)) {
      const h = ((course ?? 0) * Math.PI) / 180;
      const zvx = speed < 0.3 ? 0 : speed * Math.sin(h);
      const zvy = speed < 0.3 ? 0 : speed * Math.cos(h);
      const s2 = this.c + SPEED_SD * SPEED_SD;
      k0 = this.b / s2;
      k1 = this.c / s2;
      const jx = zvx - this.vx;
      const jy = zvy - this.vy;
      this.px += k0 * jx;
      this.py += k0 * jy;
      this.vx += k1 * jx;
      this.vy += k1 * jy;
      this.a -= k0 * this.b;
      this.b *= 1 - k1;
      this.c *= 1 - k1;
    }

    // Heading: the device's course while clearly moving, else the filter's velocity.
    let h: number | null = null;
    if (course !== null && speed !== null && speed >= 0.7) h = course;
    else if (Math.hypot(this.vx, this.vy) >= 0.5) h = ((Math.atan2(this.vx, this.vy) * 180) / Math.PI + 360) % 360;
    if (h !== null) {
      this.targetHeading = h;
      this.headingAt = arrival;
    }

    this.glideTo(this.px, this.py, arrival);
    if (Math.hypot(this.px - this.dx, this.py - this.dy) > SNAP_M) this.snap();
    return true;
  }

  /** Where to draw the walker at frame time `now` (performance.now). */
  frame(now: number): MotionFrame | null {
    if (!this.ready) return null;
    const dt = this.lastFrame ? clamp((now - this.lastFrame) / 1000, 0, 0.1) : 0;
    this.lastFrame = now;
    const k = this.gDur > 0 ? clamp((now - this.gStart) / this.gDur, 0, 1) : 1;
    const tx = this.g0x + (this.g1x - this.g0x) * k;
    const ty = this.g0y + (this.g1y - this.g0y) * k;
    if (dt > 0) {
      // Critically damped spring (Unity's SmoothDamp).
      const omega = 2 / SMOOTH_S;
      const x = omega * dt;
      const e = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
      const cx = this.dx - tx, cy = this.dy - ty;
      const tmpx = (this.svx + omega * cx) * dt, tmpy = (this.svy + omega * cy) * dt;
      this.svx = (this.svx - omega * tmpx) * e;
      this.svy = (this.svy - omega * tmpy) * e;
      this.dx = tx + (cx + tmpx) * e;
      this.dy = ty + (cy + tmpy) * e;
    }

    const active = this.targetHeading !== null && now - this.headingAt < HEADING_HOLD_MS;
    if (dt > 0) this.cone = clamp(this.cone + (active ? dt : -dt) / CONE_FADE_S, 0, 1);
    if (this.targetHeading !== null) {
      if (this.heading === null) this.heading = this.targetHeading;
      else if (dt > 0) {
        const d = ((this.targetHeading - this.heading + 540) % 360) - 180;
        this.heading = (this.heading + d * (1 - Math.exp(-dt / HEADING_TAU_S)) + 360) % 360;
      }
    }

    const gliding = k < 1 && Math.hypot(this.g1x - this.g0x, this.g1y - this.g0y) * (1 - k) > 0.02;
    const moving =
      gliding || Math.hypot(this.svx, this.svy) > 0.05 || Math.hypot(this.dx - tx, this.dy - ty) > 0.02 ||
      (this.cone > 0 && this.cone < 1);
    const { lon, lat } = this.toLonLat(this.dx, this.dy);
    return { lon, lat, heading: this.heading, cone: this.cone, moving, acc: this.acc };
  }

  private start(fix: Fix, t: number, arrival: number): void {
    const first = !this.ready;
    if (first || Math.abs(fix.lat - this.lat0) > 0.05 || Math.abs(fix.lon - this.lon0) > 0.05) {
      this.lon0 = fix.lon;
      this.lat0 = fix.lat;
      const m = metresPerDegree(fix.lat);
      this.mx = m.lon;
      this.my = m.lat;
    }
    this.ready = true;
    this.px = this.x(fix.lon);
    this.py = this.y(fix.lat);
    this.vx = this.vy = 0;
    this.a = Math.max(fix.acc / 1.5, 2) ** 2;
    this.b = 0;
    this.c = 1.5 * 1.5;
    this.lastT = t;
    this.rejects = 0;
    this.lastArrival = arrival;
    this.snap();
  }

  private glideTo(x: number, y: number, now: number): void {
    const k = this.gDur > 0 ? clamp((now - this.gStart) / this.gDur, 0, 1) : 1;
    this.g0x = this.g0x + (this.g1x - this.g0x) * k;
    this.g0y = this.g0y + (this.g1y - this.g0y) * k;
    this.g1x = x;
    this.g1y = y;
    if (this.lastArrival) this.interval = this.interval * 0.7 + clamp(now - this.lastArrival, 50, 5000) * 0.3;
    this.lastArrival = now;
    this.gStart = now;
    this.gDur = clamp(1.1 * this.interval, 250, 2000);
  }

  private x(lon: number): number {
    return (lon - this.lon0) * this.mx;
  }

  private y(lat: number): number {
    return (lat - this.lat0) * this.my;
  }

  private toLonLat(x: number, y: number): { lon: number; lat: number } {
    return { lon: this.lon0 + x / this.mx, lat: this.lat0 + y / this.my };
  }
}
