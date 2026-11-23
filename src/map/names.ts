import type { Feature, LineString } from 'geojson';
import { distanceM } from '../geo/geo';
import { paperTheme, pencilOf } from '../theme';

interface NamedPiece {
  way: string | number;
  idx: number;
  name: string | null;
  kind: string;
  coords: number[];
}

/** Ends closer than this (m) belong to the same line (pieces from neighbouring tiles meet here). */
const JOIN_M = 3;

/**
 * Lines for the names of walked streets: the walked pieces of each named street, joined into the
 * longest runs they form, so a name is written along a whole walked stretch rather than squeezed
 * onto each 20 m piece (where it would not fit and would never show). Each carries its street's
 * pencil, pressed hard, as `c`.
 */
export function nameLines(pieces: Iterable<NamedPiece>): Feature<LineString, { n: string; c: string }>[] {
  // 1. Contiguous runs within each way.
  const byWay = new Map<string, NamedPiece[]>();
  for (const p of pieces) {
    if (!p.name || p.kind !== 'road' || p.coords.length < 4) continue;
    const key = `${p.name}\u0001${p.way}`;
    const list = byWay.get(key);
    if (list) list.push(p);
    else byWay.set(key, [p]);
  }
  const runs = new Map<string, number[][]>();
  for (const list of byWay.values()) {
    list.sort((a, b) => a.idx - b.idx);
    const name = list[0].name!;
    let run: number[] | null = null;
    let last = -2;
    for (const p of list) {
      if (run && p.idx === last + 1) appendLine(run, p.coords);
      else {
        run = p.coords.slice();
        const named = runs.get(name);
        if (named) named.push(run);
        else runs.set(name, [run]);
      }
      last = p.idx;
    }
  }
  // 2. Join runs of the same name whose ends meet (the next block, or the next tile).
  const out: Feature<LineString, { n: string; c: string }>[] = [];
  const { pencils } = paperTheme;
  for (const [name, lines] of runs) {
    const c = pencils[pencilOf(name, pencils.length)].press;
    for (const line of mergeLines(lines)) {
      const coordinates: [number, number][] = [];
      for (let i = 0; i < line.length; i += 2) coordinates.push([line[i], line[i + 1]]);
      out.push({ type: 'Feature', properties: { n: name, c }, geometry: { type: 'LineString', coordinates } });
    }
  }
  return out;
}

function appendLine(run: number[], coords: ArrayLike<number>): void {
  const n = run.length;
  const skip = distanceM(run[n - 2], run[n - 1], coords[0], coords[1]) < 0.5 ? 2 : 0;
  for (let i = skip; i < coords.length; i++) run.push(coords[i]);
}

function reversed(line: number[]): number[] {
  const out: number[] = [];
  for (let i = line.length - 2; i >= 0; i -= 2) out.push(line[i], line[i + 1]);
  return out;
}

const near = (l: number[], i: number, m: number[], j: number) =>
  distanceM(l[i], l[i + 1], m[j], m[j + 1]) < JOIN_M;

/** Greedy line merge: keep extending each line at either end while another line touches it. */
export function mergeLines(lines: number[][]): number[][] {
  const pool = lines.map((l) => l.slice());
  const out: number[][] = [];
  while (pool.length) {
    let cur = pool.pop()!;
    for (let grown = true; grown; ) {
      grown = false;
      for (let k = 0; k < pool.length; k++) {
        const o = pool[k];
        const ce = cur.length - 2, oe = o.length - 2;
        let joined: number[] | null = null;
        if (near(cur, ce, o, 0)) joined = cur.concat(o.slice(2));
        else if (near(cur, ce, o, oe)) joined = cur.concat(reversed(o).slice(2));
        else if (near(cur, 0, o, oe)) joined = o.concat(cur.slice(2));
        else if (near(cur, 0, o, 0)) joined = reversed(o).concat(cur.slice(2));
        if (joined) {
          cur = joined;
          pool.splice(k, 1);
          grown = true;
          break;
        }
      }
    }
    out.push(cur);
  }
  return out;
}
