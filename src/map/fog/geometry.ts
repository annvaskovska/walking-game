import earcut from 'earcut';
import { distanceM } from '../../geo/geo';
import { EARTH_CIRCUMFERENCE_M } from '../gl';

/**
 * CPU side of the wash and the pencil: turns walked streets and houses into the flat arrays the shaders read.
 * Positions are "local units": mercator metres east and south of an origin near the data, small
 * enough for float32 to stay exact to a millimetre across a whole city.
 */

/** Per street segment: a.x, a.y, b.x, b.y, along a, along b (m), sweep from (m), sweep t0 (s), kind, pencil. */
export const SEG_FLOATS = 10;
/** Per house vertex: x, y, frame x, frame y (m, along the longest wall), seed, time on (s). */
export const HOUSE_FLOATS = 6;
export const KIND_ROAD = 0;
export const KIND_PATH = 1;
export const KIND_HOUSE = 2;
/** Sweep start for things lit before this page loaded: fully lit, no animation. */
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

/** How a newly walked street colors in: from where you stood, out along the block. */
export interface Sweep {
  /** Where this piece starts along its block (m). */
  offsetM: number;
  /** Where you were along the block when it unlocked (m). */
  fromM: number;
  /** Page time of the unlock (s). */
  t0: number;
}

/** Push the segments of one walked street piece, colored with pencil number `tone`. */
export function pushPiece(
  out: number[], o: Origin, coords: ArrayLike<number>, kind: number, sweep: Sweep | null, tone = 0,
): void {
  let along = sweep ? sweep.offsetM : 0;
  const from = sweep ? sweep.fromM : 0;
  const t0 = sweep ? sweep.t0 : LONG_AGO;
  let ax = localX(o, coords[0]), ay = localY(o, coords[1]);
  for (let i = 2; i + 1 < coords.length; i += 2) {
    const bx = localX(o, coords[i]), by = localY(o, coords[i + 1]);
    const len = distanceM(coords[i - 2], coords[i - 1], coords[i], coords[i + 1]);
    if (len > 0.01) {
      out.push(ax, ay, bx, by, along, along + len, from, t0, kind, tone);
      along += len;
    }
    ax = bx;
    ay = by;
  }
}

/** A small stable number for a house id, so its pencil always comes out the same. */
export function houseSeed(id: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return ((h >>> 0) % 9973) / 100;
}

/** Ring without the closing duplicate point, as local units. */
function ringLocal(o: Origin, flat: ArrayLike<number>): number[] {
  let n = flat.length;
  if (n >= 4 && flat[0] === flat[n - 2] && flat[1] === flat[n - 1]) n -= 2;
  const out: number[] = [];
  for (let i = 0; i + 1 < n; i += 2) out.push(localX(o, flat[i]), localY(o, flat[i + 1]));
  return out;
}

/**
 * Push one walked house: its triangles (for its pencil) and its outline as segments (for the
 * margin the wash clears around it). Each vertex also carries a frame along the house's longest
 * wall.
 */
export function pushHouse(
  verts: number[], index: number[], segs: number[], o: Origin,
  house: { coords: ArrayLike<number>; holes?: ArrayLike<number>[] }, seed: number, tOn: number,
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

  // Frame: x along the longest wall, y into the house, in ground metres.
  const n = outer.length / 2;
  let best = -1, ax = 0, ay = 0, ux = 1, uy = 0;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) {
    const x0 = outer[2 * i], y0 = outer[2 * i + 1];
    const j = (i + 1) % n;
    const dx = outer[2 * j] - x0, dy = outer[2 * j + 1] - y0;
    const l2 = dx * dx + dy * dy;
    cx += x0;
    cy += y0;
    if (l2 > best) {
      best = l2;
      ax = x0;
      ay = y0;
      const l = Math.sqrt(l2) || 1;
      ux = dx / l;
      uy = dy / l;
    }
  }
  cx /= n;
  cy /= n;
  let vx = -uy, vy = ux;
  if ((cx - ax) * vx + (cy - ay) * vy < 0) {
    vx = -vx;
    vy = -vy;
  }
  const inv = 1 / o.m2u;
  const base = verts.length / HOUSE_FLOATS;
  for (let i = 0; i < flat.length; i += 2) {
    const px = flat[i] - ax, py = flat[i + 1] - ay;
    verts.push(flat[i], flat[i + 1], (px * ux + py * uy) * inv, (px * vx + py * vy) * inv, seed, tOn);
  }
  for (const t of tri) index.push(base + t);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    segs.push(outer[2 * i], outer[2 * i + 1], outer[2 * j], outer[2 * j + 1], 0, 0, 0, tOn, KIND_HOUSE, 0);
  }
  return true;
}
