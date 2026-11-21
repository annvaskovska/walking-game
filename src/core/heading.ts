/**
 * Where the beam points: where you look when the phone has a compass, else where you walk.
 *
 * With a compass you can stand still and turn the phone to look down a side street, so its beam
 * is fully on. Without one (or while it is stale, uncalibrated, or the phone lies face down) the
 * beam follows the GPS course as before, fading out a few seconds after you stop. Switching
 * between the two never jumps: the difference at the switch is eased away along the shortest
 * arc, and the cone fades rather than pops.
 */

/** A compass reading, as `Compass.read` gives it. */
export interface CompassReading {
  /** Degrees clockwise from (magnetic) north. */
  heading: number;
  /** Degrees, or null when the device does not say. */
  accuracy: number | null;
  /** When it was taken, on the frame clock (performance.now, ms). */
  t: number;
}

/** The GPS side, straight from `MotionFrame`. */
export interface GpsHeading {
  heading: number | null;
  cone: number;
  moving?: boolean;
}

export type HeadingSource = 'compass' | 'gps';

export interface FusedHeading {
  /** Degrees clockwise from north, or null before there was any. */
  heading: number | null;
  /** How visible the beam is, 0..1. */
  cone: number;
  /** Where the heading comes from right now, or null when nothing gives one. */
  source: HeadingSource | null;
  /** A switch between sources or a cone fade is under way: worth drawing every frame. */
  settling: boolean;
}

/** A compass reading older than this (ms) no longer counts. */
export const COMPASS_FRESH_MS = 1000;
/** A compass that says it is worse than this (degrees) is not trusted. */
export const COMPASS_MAX_ACCURACY = 35;
/** How long a switch between compass and GPS takes to ease out (s). */
const BLEND_S = 0.3;
/** Cone fade, a little quicker than Motion's (0.35 s) so the GPS cone passes through unchanged. */
const CONE_FADE_S = 0.3;
/** Below this the beam is as good as off: turn it at once instead of easing. */
const CONE_OFF = 0.01;

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
/** An angle in [0, 360). */
export const wrap360 = (d: number) => ((d % 360) + 360) % 360;
/** An angle difference in [-180, 180). */
export const wrap180 = (d: number) => wrap360(d + 180) - 180;

/** Is this compass reading worth following at `now`? */
export const compassUsable = (r: CompassReading | null, now: number): r is CompassReading =>
  r !== null &&
  Number.isFinite(r.heading) &&
  now - r.t < COMPASS_FRESH_MS &&
  (r.accuracy === null || (r.accuracy >= 0 && r.accuracy <= COMPASS_MAX_ACCURACY));

export class HeadingFusion {
  /**
   * Magnetic declination where you are, degrees east of true north. Compasses (iOS
   * webkitCompassHeading, Android's absolute orientation) point to magnetic north; the map and
   * the GPS course to true north. 0 until someone knows better.
   */
  declination = 0;
  /** Reused every call: copy what you keep. */
  private out: FusedHeading = { heading: null, cone: 0, source: null, settling: false };
  private source: HeadingSource | null = null;
  /** What is left to ease away of the difference at the last switch (degrees). */
  private offset = 0;
  private blendAt = 0;
  /** Time of the last update, or NaN before the first. */
  private last = NaN;

  /** Forget everything (the walk ended). */
  reset(): void {
    this.out.heading = null;
    this.out.cone = 0;
    this.out.source = null;
    this.out.settling = false;
    this.source = null;
    this.offset = 0;
    this.last = NaN;
  }

  /** The beam at frame time `now` (ms, the clock of the compass readings). Returns the same object every call. */
  update(now: number, gps: GpsHeading, compass: CompassReading | null): FusedHeading {
    const dt = Number.isNaN(this.last) ? 0 : clamp((now - this.last) / 1000, 0, 0.1);
    this.last = now;
    const out = this.out;
    const useCompass = compassUsable(compass, now);
    const source: HeadingSource | null = useCompass ? 'compass' : gps.heading !== null ? 'gps' : null;
    const target = useCompass ? wrap360(compass.heading + this.declination) : gps.heading;
    const coneTarget = useCompass ? 1 : gps.cone;

    if (target !== null) {
      if (out.heading === null || out.cone <= CONE_OFF) {
        // Nothing shown yet: no turn to ease.
        this.offset = 0;
      } else if (source !== this.source) {
        // From wherever the beam points now, so it never jumps.
        this.offset = wrap180(out.heading - target);
        this.blendAt = now;
      }
      let left = 0;
      if (this.offset !== 0) {
        const k = clamp((now - this.blendAt) / (BLEND_S * 1000), 0, 1);
        left = 1 - k * k * (3 - 2 * k);
        if (left <= 0) this.offset = 0;
      }
      out.heading = wrap360(target + this.offset * left);
    }
    // No heading from anywhere: keep pointing the last way while the cone fades.
    this.source = source;

    const step = dt / CONE_FADE_S;
    const prevCone = out.cone;
    out.cone = clamp(prevCone + clamp(coneTarget - prevCone, -step, step), 0, 1);
    out.source = source;
    out.settling = this.offset !== 0 || out.cone !== prevCone;
    return out;
  }
}
