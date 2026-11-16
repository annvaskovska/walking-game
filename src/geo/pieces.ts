import { CONFIG } from '../config';
import { bboxOfCoords, distanceM } from './geo';
import type { Piece, PieceKind, WayInput } from '../core/types';

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/**
 * Split a way into pieces of roughly `target` metres. The way is cut into n equal parts where
 * n = round(length / target), so ids `wayId:0..n-1` stay the same as long as the way does.
 */
export function splitWay(way: WayInput, target: number = CONFIG.pieceLengthM): Piece[] {
  const c = way.coords;
  const nPts = c.length / 2;
  if (nPts < 2) return [];

  const cum = new Float64Array(nPts);
  for (let i = 1; i < nPts; i++) {
    cum[i] = cum[i - 1] + distanceM(c[2 * i - 2], c[2 * i - 1], c[2 * i], c[2 * i + 1]);
  }
  const total = cum[nPts - 1];
  const n = Math.max(1, Math.round(total / target));
  const step = total / n;

  const pointAt = (d: number, seg: number): [number, number] => {
    const segLen = cum[seg + 1] - cum[seg];
    const t = segLen > 0 ? (d - cum[seg]) / segLen : 0;
    return [
      round6(c[2 * seg] + (c[2 * seg + 2] - c[2 * seg]) * t),
      round6(c[2 * seg + 1] + (c[2 * seg + 3] - c[2 * seg + 1]) * t),
    ];
  };

  const pieces: Piece[] = [];
  let seg = 0;
  for (let k = 0; k < n; k++) {
    const d0 = k * step;
    const d1 = k === n - 1 ? total : (k + 1) * step;
    const coords: number[] = [];
    while (seg < nPts - 2 && cum[seg + 1] <= d0) seg++;
    coords.push(...pointAt(d0, seg));
    let s = seg;
    while (s < nPts - 1 && cum[s + 1] < d1) {
      coords.push(round6(c[2 * s + 2]), round6(c[2 * s + 3]));
      s++;
    }
    if (k === n - 1) {
      coords.push(round6(c[2 * nPts - 2]), round6(c[2 * nPts - 1]));
    } else {
      coords.push(...pointAt(d1, Math.min(s, nPts - 2)));
    }
    // Drop consecutive duplicates (e.g. a cut exactly on a vertex).
    const clean: number[] = [coords[0], coords[1]];
    for (let i = 2; i < coords.length; i += 2) {
      if (coords[i] !== clean[clean.length - 2] || coords[i + 1] !== clean[clean.length - 1]) {
        clean.push(coords[i], coords[i + 1]);
      }
    }
    if (clean.length === 2) clean.push(clean[0], clean[1]);
    pieces.push({
      id: `${way.id}:${k}`,
      way: way.id,
      idx: k,
      name: way.name,
      hw: way.highway,
      kind: way.kind,
      len: d1 - d0,
      coords: clean,
      bbox: bboxOfCoords(clean),
    });
  }
  return pieces;
}

/** Streets are pieces grouped by name; unnamed ways are "paths" that still light up. */
export function isStreet(p: { name: string | null }): p is { name: string } {
  return !!p.name;
}

/**
 * Fallback kind for records saved before kinds existed: walkway classes become paths, everything
 * else a road. New data gets its kind from the tile attributes in `parseTile`.
 */
export function kindFromHighway(hw: string): PieceKind {
  return hw === 'footway' || hw === 'path' || hw === 'cycleway' || hw === 'steps' || hw === 'bridleway'
    ? 'path'
    : 'road';
}
