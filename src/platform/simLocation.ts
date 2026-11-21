import type { Fix } from '../core/types';
import { bearingDeg, distanceM, metresPerDegree } from '../geo/geo';
import type { LocationProvider } from './location';
import { SIM_ROUTE } from './simRoute';

/**
 * Hidden test mode (`?sim`, `?sim=fast` for 10×, or `?sim=<factor>`): walks a scripted route at
 * walking speed on a clock that runs `factor` times faster than real time, so fix timestamps
 * still look like walking to the filter. Adds GPS-like noise, an occasional inaccurate fix and
 * one glitch jump to exercise the filters. Position survives reloads (sessionStorage).
 */

const KEY = 'wanderlight-sim';
const WALK_MPS = 1.4;

interface SimState {
  dist: number;
  step: number;
  vNow: number;
}

function rand(n: number): number {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export function simFactor(param: string | null): number {
  if (param === 'fast') return 10;
  const n = Number(param);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 1;
}

export function createSimLocation(factor: number, route: readonly number[] = SIM_ROUTE): LocationProvider {
  const key = KEY;
  const cum: number[] = [0];
  for (let i = 2; i < route.length; i += 2) {
    cum.push(cum[cum.length - 1] + distanceM(route[i - 2], route[i - 1], route[i], route[i + 1]));
  }
  const total = cum[cum.length - 1];

  let saved: SimState | null = null;
  try {
    saved = JSON.parse(sessionStorage.getItem(key) ?? 'null');
  } catch {
    saved = null;
  }
  const state: SimState = saved ?? { dist: 0, step: 0, vNow: Date.now() };
  let vBase = state.vNow;
  let wBase = Date.now();
  const now = () => vBase + (Date.now() - wBase) * factor;
  const save = () => {
    state.vNow = now();
    try {
      sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* ignore */
    }
  };

  const at = (d: number) => {
    let i = 1;
    while (i < cum.length - 1 && cum[i] < d) i++;
    const seg = cum[i] - cum[i - 1];
    const t = seg > 0 ? Math.min(1, Math.max(0, (d - cum[i - 1]) / seg)) : 0;
    const aLon = route[2 * i - 2], aLat = route[2 * i - 1], bLon = route[2 * i], bLat = route[2 * i + 1];
    return {
      lon: aLon + (bLon - aLon) * t,
      lat: aLat + (bLat - aLat) * t,
      heading: bearingDeg(aLon, aLat, bLon, bLat),
    };
  };

  const fixAt = (step: number, moving: boolean): Fix => {
    const p = at(state.dist);
    const m = metresPerDegree(p.lat);
    let acc = 6 + rand(step) * 7;
    let dx = (rand(step + 0.31) - 0.5) * 5;
    let dy = (rand(step + 0.67) - 0.5) * 5;
    if (step > 0 && step % 97 === 0) acc = 48; // weak fix: must be ignored
    if (step === 140) dy += 260; // glitch: must be ignored
    return {
      lon: p.lon + dx / m.lon,
      lat: p.lat + dy / m.lat,
      acc,
      t: now(),
      speed: moving ? WALK_MPS : 0,
      heading: moving ? p.heading : null,
    };
  };

  return {
    kind: 'sim',
    badge: factor === 1 ? 'SIM' : `SIM ×${factor}`,
    now,
    watch(onFix) {
      const tick = () => {
        const moving = state.dist < total;
        if (moving) state.dist = Math.min(total, state.dist + WALK_MPS * (0.9 + rand(state.step + 0.5) * 0.2));
        state.step++;
        onFix(fixAt(state.step, moving));
        save();
      };
      const id = setInterval(tick, 1000 / factor);
      queueMicrotask(tick);
      return () => clearInterval(id);
    },
    async current() {
      return fixAt(state.step, false);
    },
    async permission() {
      return 'granted';
    },
    reset() {
      state.dist = 0;
      state.step = 0;
      vBase = now();
      wBase = Date.now();
      save();
    },
  };
}
