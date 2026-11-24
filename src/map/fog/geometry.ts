import earcut from 'earcut';
import { distanceM } from '../../geo/geo';
import { EARTH_CIRCUMFERENCE_M } from '../gl';

/**
 * CPU side of the crayon: turns walked streets, houses and steps into the flat arrays the shaders
 * read. Positions are "local units": mercator metres east and south of an origin near the data,
 * small enough for float32 to stay exact to a millimetre across a whole city. The design's
 * numbers are in its units (`u`: local units a unit).
 */

/**
 * Per street segment: a.x, a.y, b.x, b.y, along a, along b (m); its sweep: from (m), t0 (s),
 * head (m), pace (m/s); its width (units) and crayon.
 */
export const SEG_FLOATS = 12;
/** Per house vertex: x, y, across the hatch (0..1), along it (strokes), time on (s), strokes, crayon. */
export const HOUSE_FLOATS = 7;
/** Per ribbon vertex: x, y, miter x, y, side (±1), half-width (units), alpha, time on (s), crayon. */
export const RIB_FLOATS = 9;
/** Time on for things colored before this page loaded: there already, no animation. */
export const LONG_AGO = -1e6;

export interface Origin {
  /** MapLibre mercator 0..1. */
  ox: number;
  oy: number;
  /** Local units per ground metre (1 / cos(latitude)). */
  m2u: number;
  lon: number;
  lat: number;
}

const RAD = Math.PI / 180;
export const mercX = (lon: number) => (lon + 180) / 360;
export function mercY(lat: number): number {
  const s = Math.sin(lat * RAD);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** Inverse of mercX / mercY. */
export const lonOfMercX = (x: number) => x * 360 - 180;
export function latOfMercY(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI;
}

/** World metres mercator ("WM"): 0..1 scaled by the earth's circumference. */
export const wmX = (lon: number) => mercX(lon) * EARTH_CIRCUMFERENCE_M;
export const wmY = (lat: number) => mercY(lat) * EARTH_CIRCUMFERENCE_M;
export const lonOfWm = (x: number) => lonOfMercX(x / EARTH_CIRCUMFERENCE_M);
export const latOfWm = (y: number) => latOfMercY(y / EARTH_CIRCUMFERENCE_M);

export function makeOrigin(lon: number, lat: number): Origin {
  return { ox: mercX(lon), oy: mercY(lat), m2u: 1 / Math.cos(lat * RAD), lon, lat };
}

export function localX(o: Origin, lon: number): number {
  return (mercX(lon) - o.ox) * EARTH_CIRCUMFERENCE_M;
}

export function localY(o: Origin, lat: number): number {
  return (mercY(lat) - o.oy) * EARTH_CIRCUMFERENCE_M;
}

/** The design's random numbers: xorshift32, seeded as its rng(seed). */
export function rng(seed: number): () => number {
  let s = Math.imul((seed | 0) + 1, 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

/** FNV-1a of an id, so a house is hatched the same on every load. */
export function idSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}

/**
 * How a newly walked street colors in: from the end of its block you walked in from, fast up to
 * where you are, then on at your pace, as the design's crayon keeps pace with Mr Sparkles' tip.
 */
export interface Sweep {
  /** Where it starts along the block (m): the end you walked in from. */
  fromM: number;
  /** How far from there you were when it lit (m). */
  headM: number;
  /** Your pace (m/s on the page clock). */
  mps: number;
  /** Page time it lit (s). */
  t0: number;
}

/** Page time a sweep reaches `alongM` along its block, catching up at `catchMps`. */
export function sweepTime(s: Sweep, alongM: number, catchMps: number): number {
  const d = Math.abs(alongM - s.fromM);
  return s.t0 + Math.max(d / catchMps, (d - s.headM) / s.mps);
}

/** Push the segments of one walked street piece, `offsetM` along its block, `width` units wide. */
export function pushPiece(
  out: number[], o: Origin, coords: ArrayLike<number>, width: number, sweep: Sweep | null, offsetM: number, tone: number,
): void {
  const s = sweep ?? { fromM: 0, headM: 0, mps: 1, t0: LONG_AGO };
  let along = offsetM;
  let ax = localX(o, coords[0]), ay = localY(o, coords[1]);
  for (let i = 2; i + 1 < coords.length; i += 2) {
    const bx = localX(o, coords[i]), by = localY(o, coords[i + 1]);
    const len = distanceM(coords[i - 2], coords[i - 1], coords[i], coords[i + 1]);
    if (len > 0.01) {
      out.push(ax, ay, bx, by, along, along + len, s.fromM, s.t0, s.headM, s.mps, width, tone);
      along += len;
    }
    ax = bx;
    ay = by;
  }
}

/** Ring without the closing duplicate point, as local units. */
function ringLocal(o: Origin, flat: ArrayLike<number>): number[] {
  let n = flat.length;
  if (n >= 4 && flat[0] === flat[n - 2] && flat[1] === flat[n - 1]) n -= 2;
  const out: number[] = [];
  for (let i = 0; i + 1 < n; i += 2) out.push(localX(o, flat[i]), localY(o, flat[i + 1]));
  return out;
}

/** Vertices and triangle indices, appended to. */
export interface Mesh {
  v: number[];
  i: number[];
}

/**
 * The miter at b (local units): the way to push its edges out, a unit away from the line on either
 * side. `a` or `c` NaN: b ends the line.
 */
export function miter(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): [number, number] {
  let nx = 0, ny = 0;
  for (const [x0, y0, x1, y1] of [[ax, ay, bx, by], [bx, by, cx, cy]]) {
    const l = Math.hypot(x1 - x0, y1 - y0);
    if (l > 0) {
      nx += -(y1 - y0) / l;
      ny += (x1 - x0) / l;
    }
  }
  const l = Math.hypot(nx, ny);
  if (!(l > 1e-9)) return [0, 0];
  // Along the bisector, as far as the edges need; a sharp corner is cut at twice the width.
  const ex = Number.isNaN(cx) ? -(by - ay) : -(cy - by), ey = Number.isNaN(cx) ? bx - ax : cx - bx;
  const cos = (nx * ex + ny * ey) / (l * Math.hypot(ex, ey));
  const k = 1 / (l * Math.max(cos, 0.5));
  return [nx * k, ny * k];
}

/** A crayon line along a polyline (local units), as mitred quads: each spot is colored once. */
export function pushRibbon(
  m: Mesh, pts: number[], closed: boolean, hw: number, alpha: number, tOn: number, crayon: number,
): void {
  const n = pts.length / 2;
  if (n < 2) return;
  const base = m.v.length / RIB_FLOATS;
  for (let k = 0; k < n; k++) {
    const p = k > 0 ? k - 1 : closed ? n - 1 : -1, q = k < n - 1 ? k + 1 : closed ? 0 : -1;
    const [mx, my] = miter(
      p < 0 ? NaN : pts[2 * p], p < 0 ? NaN : pts[2 * p + 1], pts[2 * k], pts[2 * k + 1],
      q < 0 ? NaN : pts[2 * q], q < 0 ? NaN : pts[2 * q + 1],
    );
    for (const side of [-1, 1]) m.v.push(pts[2 * k], pts[2 * k + 1], mx, my, side, hw, alpha, tOn, crayon);
  }
  for (let k = 0; k < (closed ? n : n - 1); k++) {
    const a = base + 2 * k, b = base + 2 * ((k + 1) % n);
    // The quad's last vertex, b's, gives its color: a stretch takes the crayon of where it ends.
    m.i.push(a, a + 1, b, a + 1, b + 1, b);
  }
}

/**
 * Push one walked house, as the design's prep() and drawHouse(): its footprint hatched at about
 * -0.62 rad, off register by 0.42 to 0.92 units (up and left for one house in five), under a 45%
 * outline 0.9 units wide on that shape, coming on at `tOn`; and one house in five gets a stroke
 * that got away, when the hatch is done.
 */
export function pushHouse(
  fill: Mesh, rib: Mesh, o: Origin, u: number,
  house: { id: string; coords: ArrayLike<number>; holes?: ArrayLike<number>[] }, tOn: number, tone: number,
): boolean {
  const outer = ringLocal(o, house.coords);
  if (outer.length < 6) return false;
  const flat = outer.slice();
  const holeIdx: number[] = [];
  for (const h of house.holes ?? []) {
    const r = ringLocal(o, h);
    if (r.length < 6) continue;
    holeIdx.push(flat.length / 2);
    for (const v of r) flat.push(v);
  }
  const tri = earcut(flat, holeIdx.length ? holeIdx : undefined, 2);
  if (!tri.length) return false;

  const r = rng(idSeed(house.id));
  const ang = -0.62 + (r() - 0.5) * 0.5;
  const flip = r() < 0.22 ? -1 : 1;
  const ox = flip * (0.42 + r() * 0.5), oy = flip * (0.3 + r() * 0.42);
  const flick = r() < 0.2, fa = r() * Math.PI * 2;

  // The hatch's frame (units, from the corner of the house's box), as the design's hatchZ().
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0; k < outer.length; k += 2) {
    x0 = Math.min(x0, outer[k]);
    x1 = Math.max(x1, outer[k]);
    y0 = Math.min(y0, outer[k + 1]);
    y1 = Math.max(y1, outer[k + 1]);
  }
  const c = Math.cos(ang), s = Math.sin(ang), W = (x1 - x0) / u, H = (y1 - y0) / u;
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const [x, y] of [[0, 0], [W, 0], [0, H], [W, H]]) {
    u0 = Math.min(u0, x * c + y * s);
    u1 = Math.max(u1, x * c + y * s);
    v0 = Math.min(v0, -x * s + y * c);
    v1 = Math.max(v1, -x * s + y * c);
  }
  u0 -= 0.6;
  u1 += 0.6;
  const strokes = Math.floor((v1 + 0.4 - (v0 + 0.32)) / 0.8) + 1;

  // The hatch stays where the house is; the shape it is clipped to is off register.
  const base = fill.v.length / HOUSE_FLOATS;
  for (let k = 0; k < flat.length; k += 2) {
    const x = (flat[k] - x0) / u + ox, y = (flat[k + 1] - y0) / u + oy;
    const hu = x * c + y * s, hv = -x * s + y * c;
    fill.v.push(flat[k] + ox * u, flat[k + 1] + oy * u, (hu - u0) / (u1 - u0), (hv - v0 - 0.32) / 0.8, tOn, strokes, tone);
  }
  for (const t of tri) fill.i.push(base + t);

  const ring: number[] = [];
  for (let k = 0; k < outer.length; k += 2) ring.push(outer[k] + ox * u, outer[k + 1] + oy * u);
  pushRibbon(rib, ring, true, 0.45, 0.45, tOn, tone);
  if (flick) {
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rr = (Math.max(W, H) / 2 + 1.6) * u;
    const at = (a: number, f: number) => [cx + Math.cos(fa + a) * rr * f, cy + Math.sin(fa + a) * rr * f];
    const [ax, ay] = at(0, 0.4), [bx, by] = at(0.3, 0.8), [ex, ey] = at(0.1, 1);
    const pts: number[] = [];
    for (let k = 0; k <= 8; k++) {
      const t = k / 8, a = (1 - t) * (1 - t), b = 2 * t * (1 - t), e = t * t;
      pts.push(a * ax + b * bx + e * ex, a * ay + b * by + e * ey);
    }
    pushRibbon(rib, pts, false, 0.375, 0.5, tOn + 0.3, tone);
  }
  return true;
}

/**
 * Where a walk step puts samples, every `step` local units from `carry` on: calls `fn` with each
 * spot and the step's direction, and returns the carry into the next step.
 */
export function sample(
  ax: number, ay: number, bx: number, by: number, step: number, carry: number,
  fn: (x: number, y: number, ux: number, uy: number) => void,
): number {
  const L = Math.hypot(bx - ax, by - ay);
  if (L < 1e-9) return carry;
  const ux = (bx - ax) / L, uy = (by - ay) / L;
  let d = carry;
  for (; d < L; d += step) fn(ax + ux * d, ay + uy * d, ux, uy);
  return d - L;
}
