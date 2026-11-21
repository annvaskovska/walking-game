import { wrap180, wrap360, type CompassReading } from '../core/heading';

export type { CompassReading } from '../core/heading';

/**
 * The phone's compass: which way you look, so the beam can follow it when you turn the phone.
 *
 * Which way is that? Flat in your hand, where the top of the phone points; held up like a
 * camera, where its back faces. Both platforms give the same answer:
 *
 * - iOS (Safari and the app's WKWebView) has `webkitCompassHeading`, Core Location's magnetic
 *   heading (WebKit passes `CLHeading.magneticHeading` through, uncorrected, with its accuracy
 *   as `webkitCompassAccuracy`, -1 while uncalibrated, when the heading reads 0). Measured on an
 *   iPhone (AR-js-org/locar.js#39), it is the yaw left once the tilt is undone by the shortest
 *   rotation: `360 - (alpha + 2 atan2(sin(beta/2) sin(gamma/2), cos(beta/2) cos(gamma/2)))`
 *   with `alpha` absolute. Flat, that is where the top points; held up and level, where the back
 *   faces; held up and rolled (the phone crooked in your hand), the camera's direction plus the
 *   roll. Once the screen faces more than 45° below the horizon, iOS flips to the same quantity
 *   for the phone seen from its back.
 * - Android (Chrome, `deviceorientationabsolute`; Firefox, `deviceorientation` with
 *   `absolute: true`) gives absolute Euler angles, also to magnetic north; the same quantity is
 *   computed from them.
 *
 * From there, held up, the heading turns into the direction the back faces (so a crooked hold
 * does not swing the beam), blending over from the iOS quantity between the screen tilted ~45°
 * and ~70° from flat. The difference depends on beta and gamma only, so on iOS it needs no
 * absolute alpha (its alpha is relative). The screen's rotation is accounted for. Readings with
 * the screen facing more than ~37° below the horizon (face down, or held overhead) are ignored,
 * which also keeps clear of the iOS flip.
 *
 * Events only store their numbers; the trigonometry and the smoothing (a circular low-pass,
 * frame-rate independent) happen once per frame in `read`, nothing is allocated per event.
 */
export interface Compass {
  /** The browser has orientation events at all (the phone may still have no compass). */
  readonly supported: boolean;
  start(): void;
  stop(): void;
  /**
   * The smoothed heading at frame time `now` (performance.now), or null without a fresh
   * reading. The same object every call: copy what you keep.
   */
  read(now: number): CompassReading | null;
  /**
   * iOS 13+ asks before a page gets orientation events; call this inside a tap. Elsewhere
   * 'not-needed'. The Start tap already asks in index.html (`window.__wl.orient`).
   */
  requestPermission(): Promise<'granted' | 'denied' | 'not-needed'>;
}

/** The fields of a DeviceOrientationEvent the compass reads. */
export interface OrientationSample {
  alpha: number | null;
  beta: number | null;
  gamma: number | null;
  absolute?: boolean;
  webkitCompassHeading?: number;
  webkitCompassAccuracy?: number;
}

type Listener = (e: OrientationSample) => void;

/** The bits of `window` the compass uses (a fake one in tests). */
export interface CompassHost {
  addEventListener(type: string, fn: Listener): void;
  removeEventListener(type: string, fn: Listener): void;
  DeviceOrientationEvent?: { requestPermission?: () => Promise<string> };
  screen?: { orientation?: { angle?: number } };
  /** `window.orientation`, older iOS (0, 90, -90, 180). */
  orientation?: number;
  performance: { now(): number };
}

/** Smoothing time constant (s). */
const TAU_S = 0.12;
/** A reading older than this (ms) is not fresh. */
const STALE_MS = 1000;
/** Longer than this between reads (ms) and the smoothing starts over at the reading. */
const GAP_MS = 500;
/** Screen normal's up component below which the phone is face down (~37° below the horizon). */
const FACE_DOWN = -0.6;
/** Screen normal's up component: at or below, held up (the back's direction); at or above, flat-ish (iOS's). */
const HELD_UP = 0.35;
const FLAT = 0.7;

const D = Math.PI / 180;
/** What an event gave: iOS's own compass heading, or absolute Euler angles. */
export type SampleKind = 'ios' | 'absolute';

const smoothstep = (e0: number, e1: number, x: number) => {
  const t = x <= e0 ? 0 : x >= e1 ? 1 : (x - e0) / (e1 - e0);
  return t * t * (3 - 2 * t);
};

/**
 * Which way the phone looks, degrees clockwise from magnetic north, or NaN when it lies face
 * down. `a` is webkitCompassHeading ('ios') or the absolute alpha ('absolute'); `screen` is the
 * screen's rotation (screen.orientation.angle).
 */
export function lookHeading(kind: SampleKind, a: number, beta: number, gamma: number, screen: number): number {
  const b = beta * D, g = gamma * D;
  const cg = Math.cos(g);
  // How far the screen faces up: 1 flat on a table, 0 held upright, -1 face down.
  const up = Math.cos(b) * cg;
  if (up < FACE_DOWN) return NaN;
  // The part of iOS's heading that comes from the tilt (the swing-twist yaw of beta and gamma).
  const tw = (2 * Math.atan2(Math.sin(b / 2) * Math.sin(g / 2), Math.cos(b / 2) * Math.cos(g / 2))) / D;
  // iOS's heading, of the top of the screen rather than of the phone.
  const top = (kind === 'ios' ? a : -(a + tw)) + screen;
  const w = 1 - smoothstep(HELD_UP, FLAT, up);
  if (w <= 0) return wrap360(top);
  // Where the back faces (the W3C compass formula) with alpha = 0; minus iOS's heading at alpha = 0.
  const back = Math.atan2(-Math.sin(g), Math.sin(b) * cg) / D;
  return wrap360(top + w * wrap180(back + tw - screen));
}

export function createCompass(host: CompassHost = globalThis as unknown as CompassHost): Compass {
  const canListen = typeof host.addEventListener === 'function' && 'DeviceOrientationEvent' in host;
  // Chrome's plain deviceorientation is relative (no north); its absolute one has its own event.
  const type = !canListen
    ? null
    : 'ondeviceorientationabsolute' in host
      ? 'deviceorientationabsolute'
      : 'ondeviceorientation' in host
        ? 'deviceorientation'
        : null;

  let listening = false;
  // The latest event, as numbers.
  let kind: SampleKind | null = null;
  let sa = 0, sb = 0, sg = 0, sAcc = -1, sT = 0, seq = 0;
  // The latest usable reading.
  let used = 0, valid = false, raw = 0, acc: number | null = null, rawT = -Infinity;
  // The smoothed heading.
  let smooth = 0, lastRead = -Infinity;
  const out: CompassReading = { heading: 0, accuracy: null, t: 0 };

  const onEvent: Listener = (e) => {
    const wch = e.webkitCompassHeading;
    if (typeof wch === 'number' && Number.isFinite(wch)) {
      const ac = e.webkitCompassAccuracy;
      // Uncalibrated: iOS says -1 and a heading of 0.
      if (typeof ac === 'number' && ac < 0) return;
      kind = 'ios';
      sa = wch;
      sAcc = typeof ac === 'number' && Number.isFinite(ac) ? ac : -1;
      sb = e.beta ?? 0;
      sg = e.gamma ?? 0;
    } else if (e.absolute === true && e.alpha != null && e.beta != null && e.gamma != null) {
      kind = 'absolute';
      sa = e.alpha;
      sb = e.beta;
      sg = e.gamma;
      sAcc = -1;
    } else return;
    sT = host.performance.now();
    seq++;
  };

  const screenAngle = (): number => {
    const a = host.screen?.orientation?.angle ?? host.orientation ?? 0;
    return Number.isFinite(a) ? wrap360(a) : 0;
  };

  let asking: Promise<'granted' | 'denied' | 'not-needed'> | null = null;

  return {
    supported: type !== null,

    start() {
      if (listening || !type) return;
      listening = true;
      host.addEventListener(type, onEvent);
    },

    stop() {
      if (!listening || !type) return;
      listening = false;
      host.removeEventListener(type, onEvent);
      kind = null;
      valid = false;
      rawT = lastRead = -Infinity;
    },

    read(now) {
      if (kind === null) return null;
      if (seq !== used) {
        used = seq;
        const h = lookHeading(kind, sa, sb, sg, screenAngle());
        valid = !Number.isNaN(h);
        if (valid) {
          raw = h;
          acc = sAcc >= 0 ? sAcc : null;
          rawT = sT;
        }
      }
      if (!valid || now - rawT > STALE_MS) return null;
      const dt = now - lastRead;
      if (dt > GAP_MS || dt < 0) smooth = raw;
      else smooth = wrap360(smooth + wrap180(raw - smooth) * (1 - Math.exp(-dt / 1000 / TAU_S)));
      lastRead = now;
      out.heading = smooth;
      out.accuracy = acc;
      out.t = rawT;
      return out;
    },

    requestPermission() {
      const DOE = host.DeviceOrientationEvent;
      if (!DOE || typeof DOE.requestPermission !== 'function') return Promise.resolve('not-needed');
      if (asking) return asking;
      let p: Promise<string>;
      try {
        p = Promise.resolve(DOE.requestPermission());
      } catch {
        return Promise.resolve('denied');
      }
      const done = p.then(
        (s) => (s === 'granted' ? 'granted' : 'denied') as 'granted' | 'denied',
        () => 'denied' as const,
      );
      asking = done;
      void done.then(() => {
        asking = null;
      });
      return done;
    },
  };
}
