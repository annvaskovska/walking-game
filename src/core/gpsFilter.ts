import { CONFIG } from '../config';
import { clamp, distanceM } from '../geo/geo';
import type { Fix } from './types';

type Cfg = Pick<
  typeof CONFIG,
  | 'maxAccuracyM' | 'radiusFactor' | 'radiusMinM' | 'radiusMaxM' | 'walkMaxSpeedMps'
  | 'jumpMaxSpeedMps' | 'speedWindowMs' | 'minWindowMs' | 'gapResetMs' | 'gapResetMinM'
  | 'rejectStreakReset' | 'minMoveMinM' | 'minMoveMaxM'
>;

/** Serializable state of the fix filter, persisted with the active walk. */
export interface FilterState {
  /** Last accepted position: the start of the next segment. */
  anchor: Fix | null;
  /** Accepted positions inside the speed window (oldest first). */
  recent: Fix[];
  /** Glitches in a row. */
  rejects: number;
}

export type Verdict =
  | { kind: 'reject'; reason: 'accuracy' | 'duplicate' | 'jump' }
  | { kind: 'anchor'; reason: 'first' | 'gap' | 'reset' }
  | { kind: 'still' }
  | { kind: 'vehicle'; speedMps: number }
  | { kind: 'walk'; from: Fix; to: Fix; distM: number; radiusM: number };

export function newFilterState(): FilterState {
  return { anchor: null, recent: [], rejects: 0 };
}

/** Lighting radius around a walked segment for a given GPS accuracy. */
export function lightRadius(accuracyM: number, cfg: Cfg = CONFIG): number {
  return clamp(accuracyM * cfg.radiusFactor, cfg.radiusMinM, cfg.radiusMaxM);
}

/**
 * Decide what a new fix means. Pure: returns the next state instead of mutating.
 *  - accuracy worse than maxAccuracyM → ignored
 *  - a hop much faster than walking and bigger than the noise → glitch (ignored; after a
 *    streak of them we trust the new place but light nothing in between)
 *  - sustained straight-line speed over walkMaxSpeedMps → vehicle (bus, tram, bike): nothing lights
 *  - otherwise the segment from the last accepted fix to this one is walked and lights up.
 */
export function stepFilter(
  state: FilterState,
  fix: Fix,
  cfg: Cfg = CONFIG,
): { state: FilterState; verdict: Verdict } {
  if (!(fix.acc <= cfg.maxAccuracyM) || !Number.isFinite(fix.lon) || !Number.isFinite(fix.lat)) {
    return { state, verdict: { kind: 'reject', reason: 'accuracy' } };
  }
  const anchor = state.anchor;
  if (!anchor) {
    return { state: { anchor: fix, recent: [fix], rejects: 0 }, verdict: { kind: 'anchor', reason: 'first' } };
  }
  const dt = fix.t - anchor.t;
  if (dt <= 0) return { state, verdict: { kind: 'reject', reason: 'duplicate' } };

  const d = distanceM(anchor.lon, anchor.lat, fix.lon, fix.lat);

  if (dt > cfg.gapResetMs && d > cfg.gapResetMinM) {
    return { state: { anchor: fix, recent: [fix], rejects: 0 }, verdict: { kind: 'anchor', reason: 'gap' } };
  }

  const hopSpeed = d / (dt / 1000);
  const noise = anchor.acc + fix.acc;
  if (hopSpeed > cfg.jumpMaxSpeedMps && d > noise) {
    const rejects = state.rejects + 1;
    if (rejects >= cfg.rejectStreakReset) {
      return { state: { anchor: fix, recent: [fix], rejects: 0 }, verdict: { kind: 'anchor', reason: 'reset' } };
    }
    return { state: { ...state, rejects }, verdict: { kind: 'reject', reason: 'jump' } };
  }

  const minMove = clamp(Math.max(anchor.acc, fix.acc) * 0.5, cfg.minMoveMinM, cfg.minMoveMaxM);
  if (d < minMove) {
    return { state: state.rejects ? { ...state, rejects: 0 } : state, verdict: { kind: 'still' } };
  }

  // Sustained speed over the window, measured as straight-line displacement so GPS jitter
  // cannot fake it.
  const recent = state.recent.filter((f) => fix.t - f.t <= cfg.speedWindowMs);
  recent.push(fix);
  const first = recent[0];
  const span = fix.t - first.t;
  const windowSpeed = span > 0 ? distanceM(first.lon, first.lat, fix.lon, fix.lat) / (span / 1000) : 0;
  const next: FilterState = { anchor: fix, recent, rejects: 0 };

  const fast = cfg.walkMaxSpeedMps * 1.5;
  const sustained = span >= cfg.minWindowMs && windowSpeed > cfg.walkMaxSpeedMps;
  // Before the window fills up, a clearly fast short window or a fast Doppler speed (which GPS
  // jitter doesn't affect) backed by a fast hop already means a vehicle.
  const earlyFast = span >= 3000 && windowSpeed > cfg.walkMaxSpeedMps * 1.25;
  const doppler = fix.speed != null && fix.speed > fast && hopSpeed > cfg.walkMaxSpeedMps;
  if (sustained || earlyFast || doppler) {
    return { state: next, verdict: { kind: 'vehicle', speedMps: Math.max(windowSpeed, fix.speed ?? 0) } };
  }

  return {
    state: next,
    verdict: {
      kind: 'walk',
      from: anchor,
      to: fix,
      distM: d,
      radiusM: lightRadius(Math.max(anchor.acc, fix.acc), cfg),
    },
  };
}
