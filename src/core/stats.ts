import { CONFIG } from '../config';
import { distanceM } from '../geo/geo';
import type { Piece, WalkRecord } from './types';

/** Local calendar day as an integer (days since 1970-01-01 in local time); DST-safe. */
export function localDay(ts: number): number {
  const d = new Date(ts);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86_400_000);
}

export function isRealWalk(w: Pick<WalkRecord, 'distanceM' | 'newPieces'>): boolean {
  return w.distanceM >= CONFIG.realWalkMinM || w.newPieces > 0;
}

/**
 * Current streak: consecutive days with a walk, ending today — or yesterday, so the streak isn't
 * shown as broken before you had a chance to walk today. Best: longest run ever.
 */
export function streaks(walks: Iterable<WalkRecord>, now: number): { current: number; best: number } {
  const days = new Set<number>();
  for (const w of walks) if (isRealWalk(w)) days.add(localDay(w.startedAt));
  if (days.size === 0) return { current: 0, best: 0 };

  const sorted = [...days].sort((a, b) => a - b);
  let best = 1, run = 1;
  for (let i = 1; i < sorted.length; i++) {
    run = sorted[i] === sorted[i - 1] + 1 ? run + 1 : 1;
    if (run > best) best = run;
  }

  const today = localDay(now);
  let start = days.has(today) ? today : days.has(today - 1) ? today - 1 : null;
  let current = 0;
  while (start !== null && days.has(start)) {
    current++;
    start--;
  }
  return { current, best };
}

export interface DayBar {
  label: string;
  day: number;
  distanceM: number;
  isToday: boolean;
}

/** Distance walked per day, Monday to Sunday of the current week. */
export function weekBars(walks: Iterable<WalkRecord>, now: number): DayBar[] {
  const labels = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const today = localDay(now);
  const weekday = (new Date(now).getDay() + 6) % 7; // Monday = 0
  const monday = today - weekday;
  const bars: DayBar[] = labels.map((label, i) => ({
    label, day: monday + i, distanceM: 0, isToday: monday + i === today,
  }));
  for (const w of walks) {
    const i = localDay(w.startedAt) - monday;
    if (i >= 0 && i < 7) bars[i].distanceM += w.distanceM;
  }
  return bars;
}

export interface StreetSummary {
  name: string;
  pieces: number;
  lenM: number;
  litPieces: number;
  litLenM: number;
}

/** Group pieces into streets by name. Unnamed pieces are paths and are left out. */
export function groupStreets(pieces: Iterable<Piece>, isLit: (id: string) => boolean): Map<string, StreetSummary> {
  const out = new Map<string, StreetSummary>();
  for (const p of pieces) {
    if (!p.name) continue;
    let s = out.get(p.name);
    if (!s) {
      s = { name: p.name, pieces: 0, lenM: 0, litPieces: 0, litLenM: 0 };
      out.set(p.name, s);
    }
    s.pieces++;
    s.lenM += p.len;
    if (isLit(p.id)) {
      s.litPieces++;
      s.litLenM += p.len;
    }
  }
  return out;
}

export interface Nudge {
  name: string;
  distM: number;
}

/** Closest named streets that have no lit piece yet: gentle "go there next" hints. */
export function nearbyUnlitStreets(
  pieces: Iterable<Piece>,
  streetIsLit: (name: string) => boolean,
  lon: number,
  lat: number,
  limit = 4,
  maxDistM = 1500,
): Nudge[] {
  const best = new Map<string, number>();
  for (const p of pieces) {
    if (!p.name || streetIsLit(p.name)) continue;
    const d = distanceM(lon, lat, p.coords[0], p.coords[1]);
    if (d > maxDistM) continue;
    const prev = best.get(p.name);
    if (prev === undefined || d < prev) best.set(p.name, d);
  }
  return [...best.entries()]
    .map(([name, distM]) => ({ name, distM }))
    .sort((a, b) => a.distM - b.distM)
    .slice(0, limit);
}

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 2 : 1)} km`;
}

export function formatDuration(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}
