import type { Feature, Point } from 'geojson';
import { distanceM, metresPerDegree } from '../geo/geo';
import { paperTheme, pencilOf } from '../theme';

/** A street name: where it is written, in which crayon (`c`), turned `r` degrees clockwise. */
export type NameFeature = Feature<Point, { n: string; c: string; r: number }>;

interface NamedPiece {
  way: string | number;
  idx: number;
  name: string | null;
  kind: string;
  coords: number[];
}

/** Ends closer than this (m) belong to the same line (pieces from neighbouring tiles meet here). */
const JOIN_M = 3;
/** Segments that turn less than this (radians) from where a straight run began still belong to it. */
const STRAIGHT = 0.06;
/**
 * Two names of one street stand at least this far apart (m): one per street where you see it, as
 * the design writes it, not one per side of a canal or per bit walked twice.
 */
const NAMES_APART_M = 150;

/**
 * The names of walked streets, as the design writes them: the walked pieces of each named street
 * are joined into the longest runs they form, and each run gets its name once, straight, centred on
 * its longest straight stretch and turned along it, kept upright; a shorter run close to a longer
 * one of the same name goes without. Each carries its street's crayon, pressed hard, as `c`.
 */
export function nameLines(pieces: Iterable<NamedPiece>): NameFeature[] {
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
  const out: NameFeature[] = [];
  const { pencils } = paperTheme;
  for (const [name, lines] of runs) {
    const c = pencils[pencilOf(name, pencils.length)].press;
    const kept: [number, number][] = [];
    // The longest run first: it carries the name where the street has two.
    const longestFirst = mergeLines(lines).map((line) => ({ line, len: lengthM(line) })).sort((a, b) => b.len - a.len);
    for (const { line } of longestFirst) {
      const { at, r } = longestStraight(line);
      if (kept.some((k) => distanceM(k[0], k[1], at[0], at[1]) < NAMES_APART_M)) continue;
      kept.push(at);
      out.push({ type: 'Feature', properties: { n: name, c, r }, geometry: { type: 'Point', coordinates: at } });
    }
  }
  return out;
}

/** The middle of a line's longest straight stretch, and its angle in degrees clockwise from east, within ±90. */
export function longestStraight(line: number[]): { at: [number, number]; r: number } {
  const m = metresPerDegree(line[1]);
  let best = { len: -1, a: 0, b: 2 };
  let a = 0, dir = 0, len = 0;
  for (let i = 2; i < line.length; i += 2) {
    const dx = (line[i] - line[i - 2]) * m.lon, dy = (line[i + 1] - line[i - 1]) * m.lat;
    const d = Math.atan2(dy, dx), l = Math.hypot(dx, dy);
    if (i === 2 || Math.abs(Math.atan2(Math.sin(d - dir), Math.cos(d - dir))) > STRAIGHT) {
      a = i - 2;
      dir = d;
      len = 0;
    }
    len += l;
    if (len > best.len) best = { len, a, b: i };
  }
  const { a: s, b: e } = best;
  // Screen y runs down: north is up, so the clockwise angle is the negated compass one.
  let r = (-Math.atan2((line[e + 1] - line[s + 1]) * m.lat, (line[e] - line[s]) * m.lon) * 180) / Math.PI;
  if (r > 90) r -= 180;
  if (r < -90) r += 180;
  return { at: [(line[s] + line[e]) / 2, (line[s + 1] + line[e + 1]) / 2], r };
}

function lengthM(line: number[]): number {
  let len = 0;
  for (let i = 2; i < line.length; i += 2) len += distanceM(line[i - 2], line[i - 1], line[i], line[i + 1]);
  return len;
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
