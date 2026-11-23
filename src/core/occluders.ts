import { expandBBox } from '../geo/geo';
import type { GridIndex } from '../geo/spatialIndex';
import { wmX, wmY } from '../map/fog/geometry';
import { paperTheme } from '../theme';
import type { Building } from './types';

/**
 * The walls around you, in WM ("world metres mercator": mercator × the earth's circumference, y
 * south). Light and sight stop at them; the CPU sight and the GPU shadows both read this one list.
 */
export interface Occluders {
  /** Centre and radius of the gather, WM units. */
  cx: number;
  cy: number;
  radius: number;
  /** Houses gathered; an edge's owner indexes this array. */
  houses: Building[];
  /**
   * Per wall edge, 8 float64s, WM units: ax, ay, bx, by (the wall, a→b), px, py (the corner
   * before a on the same ring), nx, ny (the corner after b). Every ring is ordered so the
   * building's inside is on the side where cross(b - a, p - a) > 0 (holes included: the inside
   * of a hole ring is open air, so hole rings run the other way round).
   */
  edges: Float64Array;
  /** House index per edge. */
  owner: Int32Array;
  /** Edges of house k are [houseStart[k], houseStart[k + 1]). */
  houseStart: Int32Array;
  /** Per house, 4 float64s: minx, miny, maxx, maxy (WM), so a point-in-house test rejects fast. */
  hbox: Float64Array;
  /**
   * Per house, its whole rings in WM (flat x, y; no closing point; oriented as `edges`), outer
   * ring first. `edges` keeps only the walls near the centre; these stay whole, so the
   * inside test of a big house never misses a far wall.
   */
  rings: Float64Array[][];
  n: number;
  /** Bumped whenever the gather changes (consumers re-upload when it differs). */
  version: number;
}

const RAD = Math.PI / 180;
/** How far past the nearest wall `stepOutside` puts you, ground metres. */
const STEP_OUT_M = 0.6;

/** WM units per ground metre at a latitude (mercator is conformal: the same in every direction). */
export const wmPerMetre = (lat: number): number => 1 / Math.cos(lat * RAD);

interface Shape {
  rings: Float64Array[];
  box: [number, number, number, number];
}

/** Twice the signed area of a flat ring (relative to its first point, so float64 stays exact). */
function ringArea2(r: Float64Array): number {
  const m = r.length >> 1, x0 = r[0], y0 = r[1];
  let s = 0;
  for (let i = 0; i < m; i++) {
    const j = i + 1 === m ? 0 : i + 1;
    s += (r[i * 2] - x0) * (r[j * 2 + 1] - y0) - (r[j * 2] - x0) * (r[i * 2 + 1] - y0);
  }
  return s;
}

/**
 * One lon/lat ring to WM, without the closing duplicate or repeated points, turned so the
 * building's inside is where cross(b - a, p - a) > 0: positive area for an outer ring, negative
 * for a hole (whose inside is a courtyard). Null when fewer than 3 corners are left.
 */
function toWM(flat: ArrayLike<number>, hole: boolean): Float64Array | null {
  let m = flat.length >> 1;
  if (m > 1 && flat[0] === flat[(m - 1) * 2] && flat[1] === flat[(m - 1) * 2 + 1]) m--;
  const out = new Float64Array(m * 2);
  let k = 0;
  for (let i = 0; i < m; i++) {
    const x = wmX(flat[i * 2]), y = wmY(flat[i * 2 + 1]);
    if (k > 0 && x === out[k - 2] && y === out[k - 1]) continue;
    out[k++] = x;
    out[k++] = y;
  }
  if (k > 2 && out[0] === out[k - 2] && out[1] === out[k - 1]) k -= 2;
  if (k < 6) return null;
  const r = k === out.length ? out : out.slice(0, k);
  const a = ringArea2(r);
  if (a === 0) return null;
  if (hole ? a > 0 : a < 0) {
    for (let i = 0, j = (k >> 1) - 1; i < j; i++, j--) {
      const x = r[i * 2], y = r[i * 2 + 1];
      r[i * 2] = r[j * 2];
      r[i * 2 + 1] = r[j * 2 + 1];
      r[j * 2] = x;
      r[j * 2 + 1] = y;
    }
  }
  return r;
}

/** WM rings of a house, converted once per Building object. */
const shapes = new WeakMap<Building, Shape | null>();

function shapeOf(b: Building): Shape | null {
  let s = shapes.get(b);
  if (s !== undefined) return s;
  s = null;
  const outer = toWM(b.coords, false);
  if (outer) {
    const rings = [outer];
    for (const h of b.holes ?? []) {
      const r = toWM(h, true);
      if (r) rings.push(r);
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let i = 0; i < outer.length; i += 2) {
      const x = outer[i], y = outer[i + 1];
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
    s = { rings, box: [x0, y0, x1, y1] };
  }
  shapes.set(b, s);
  return s;
}

/** Squared distance from (px, py) to segment ab. */
function segDist2(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
  let t = l2 > 0 ? ((px - ax) * ex + (py - ay) * ey) / l2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * ex - px, qy = ay + t * ey - py;
  return qx * qx + qy * qy;
}

/** No walls at all (before any house has loaded). */
export function noOccluders(cx = 0, cy = 0, version = 0): Occluders {
  return {
    cx, cy, radius: 0, houses: [], edges: new Float64Array(0), owner: new Int32Array(0),
    houseStart: new Int32Array(1), hbox: new Float64Array(0), rings: [], n: 0, version,
  };
}

/**
 * The walls of `houses` that come within `radius` (WM) of (cx, cy). Houses whose box is farther
 * are left out; a house that is kept keeps its whole rings for `stepOutside`.
 */
export function gatherOccluders(
  houses: Iterable<Building>, cx: number, cy: number, radius: number, version: number,
): Occluders {
  const kept: Building[] = [];
  const keptShapes: Shape[] = [];
  let maxEdges = 0;
  for (const b of houses) {
    const s = shapeOf(b);
    if (!s) continue;
    const [x0, y0, x1, y1] = s.box;
    const dx = cx < x0 ? x0 - cx : cx > x1 ? cx - x1 : 0;
    const dy = cy < y0 ? y0 - cy : cy > y1 ? cy - y1 : 0;
    if (dx * dx + dy * dy > radius * radius) continue;
    kept.push(b);
    keptShapes.push(s);
    for (const r of s.rings) maxEdges += r.length >> 1;
  }
  const H = kept.length;
  const edges = new Float64Array(maxEdges * 8);
  const owner = new Int32Array(maxEdges);
  const houseStart = new Int32Array(H + 1);
  const hbox = new Float64Array(H * 4);
  const rings: Float64Array[][] = [];
  const r2 = radius * radius;
  let n = 0;
  for (let k = 0; k < H; k++) {
    const s = keptShapes[k];
    houseStart[k] = n;
    hbox.set(s.box, k * 4);
    rings.push(s.rings);
    for (const r of s.rings) {
      const m = r.length >> 1;
      for (let i = 0; i < m; i++) {
        const ia = i * 2, ib = ((i + 1) % m) * 2;
        const ax = r[ia], ay = r[ia + 1], bx = r[ib], by = r[ib + 1];
        if (segDist2(cx, cy, ax, ay, bx, by) > r2) continue;
        const ip = ((i + m - 1) % m) * 2, iN = ((i + 2) % m) * 2, o = n * 8;
        edges[o] = ax;
        edges[o + 1] = ay;
        edges[o + 2] = bx;
        edges[o + 3] = by;
        edges[o + 4] = r[ip];
        edges[o + 5] = r[ip + 1];
        edges[o + 6] = r[iN];
        edges[o + 7] = r[iN + 1];
        owner[n++] = k;
      }
    }
  }
  houseStart[H] = n;
  return {
    cx, cy, radius, houses: kept, edges: edges.slice(0, n * 8), owner: owner.slice(0, n),
    houseStart, hbox, rings, n, version,
  };
}

/** Keeps the walls around a moving point: re-gathers only when it moved far or the houses changed. */
export class OccluderCache {
  private occ: Occluders = noOccluders();
  private housesVersion = Number.NaN;
  private readonly radiusM: number;
  private readonly slackM: number;

  /**
   * `radiusM`: how far sight reaches (the cone plus a little); `slackM`: how far you may walk
   * before the walls are gathered again. The gather radius is their sum.
   */
  constructor(opts: { radiusM?: number; slackM?: number } = {}) {
    this.radiusM = opts.radiusM ?? paperTheme.fog.coneM + 5;
    this.slackM = opts.slackM ?? 25;
  }

  /** Current walls around (lon, lat); same object (same version) while nothing changed. */
  around(lon: number, lat: number, houses: GridIndex<Building>, housesVersion: number): Occluders {
    const x = wmX(lon), y = wmY(lat), m2u = wmPerMetre(lat);
    const o = this.occ;
    if (o.version > 0 && housesVersion === this.housesVersion) {
      const dx = x - o.cx, dy = y - o.cy, s = this.slackM * m2u;
      if (dx * dx + dy * dy <= s * s) return o;
    }
    const reachM = this.radiusM + this.slackM;
    const near = houses.query(expandBBox([lon, lat, lon, lat], reachM + 2));
    this.occ = gatherOccluders(near, x, y, reachM * m2u, o.version + 1);
    this.housesVersion = housesVersion;
    return this.occ;
  }
}

/** Even-odd test of (x, y) against every ring of house k (holes count as outside). */
function insideHouse(occ: Occluders, k: number, x: number, y: number): boolean {
  let c = false;
  for (const r of occ.rings[k]) {
    const m = r.length;
    for (let i = 0, j = m - 2; i < m; j = i, i += 2) {
      const yi = r[i + 1], yj = r[j + 1];
      if (yi > y !== yj > y) {
        const xi = r[i], xj = r[j];
        if (x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
      }
    }
  }
  return c;
}

/** Index of a house that holds (x, y), or -1. Box test first, so it costs little every frame. */
export function houseAt(occ: Occluders, x: number, y: number): number {
  const B = occ.hbox;
  for (let k = 0, H = occ.houses.length; k < H; k++) {
    const o = k * 4;
    if (x < B[o] || y < B[o + 1] || x > B[o + 2] || y > B[o + 3]) continue;
    if (insideHouse(occ, k, x, y)) return k;
  }
  return -1;
}

// Scratch for stepOutside among overlapping houses: per candidate, distance², x, y.
let cand = new Float64Array(3 * 256);

/**
 * Push the nearest point of every wall of house k, stepped `off` past it (away from (x, y), or
 * along the wall's outward normal when you stand on it), into `cand` from slot `n`.
 */
function wallExits(occ: Occluders, k: number, x: number, y: number, off: number, n: number): number {
  for (const r of occ.rings[k]) {
    const m = r.length;
    if ((n + (m >> 1)) * 3 > cand.length) {
      const c = new Float64Array(Math.max(cand.length * 2, (n + m) * 3));
      c.set(cand);
      cand = c;
    }
    for (let i = 0, j = m - 2; i < m; j = i, i += 2) {
      const ax = r[j], ay = r[j + 1], ex = r[i] - ax, ey = r[i + 1] - ay;
      const l2 = ex * ex + ey * ey;
      if (l2 === 0) continue;
      let t = ((x - ax) * ex + (y - ay) * ey) / l2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const qx = ax + t * ex, qy = ay + t * ey;
      const d2 = (qx - x) * (qx - x) + (qy - y) * (qy - y), d = Math.sqrt(d2);
      // The inside is where cross(b - a, p - a) > 0, so (ey, -ex) points out.
      const l = Math.sqrt(l2);
      const ux = d > 1e-9 ? (qx - x) / d : ey / l, uy = d > 1e-9 ? (qy - y) / d : -ex / l;
      cand[n * 3] = d2;
      cand[n * 3 + 1] = qx + ux * off;
      cand[n * 3 + 2] = qy + uy * off;
      n++;
    }
  }
  return n;
}

/** Houses this close (m) are searched for a way out when the nearest wall leads into another house. */
const OVERLAP_SEARCH_M = 40;

/**
 * Inside a house (GPS puts you there between tall houses)? Step out to just past its nearest wall
 * (0.6 m). Where building parts overlap and that wall leads into the next part, the nearest
 * wall point of any house around that leads into the open is taken instead.
 */
export function stepOutside(occ: Occluders, x: number, y: number, m2u: number): [number, number] {
  const k = houseAt(occ, x, y);
  if (k < 0) return [x, y];
  const off = STEP_OUT_M * m2u;
  // The common case: one house, its nearest wall.
  let n = wallExits(occ, k, x, y, off, 0);
  let best = -1;
  for (let c = 0; c < n; c++) if (best < 0 || cand[c * 3] < cand[best * 3]) best = c;
  if (best < 0) return [x, y];
  const fx = cand[best * 3 + 1], fy = cand[best * 3 + 2];
  if (houseAt(occ, fx, fy) < 0) return [fx, fy];
  // Overlapping parts: try the wall points of every house around, nearest first.
  n = 0;
  const B = occ.hbox, R = OVERLAP_SEARCH_M * m2u;
  for (let h = 0, H = occ.houses.length; h < H; h++) {
    const o = h * 4;
    if (x < B[o] - R || y < B[o + 1] - R || x > B[o + 2] + R || y > B[o + 3] + R) continue;
    n = wallExits(occ, h, x, y, off, n);
  }
  for (let tries = 0; tries < n; tries++) {
    let c = -1;
    for (let i = 0; i < n; i++) if (cand[i * 3] >= 0 && (c < 0 || cand[i * 3] < cand[c * 3])) c = i;
    if (c < 0) break;
    const cx = cand[c * 3 + 1], cy = cand[c * 3 + 2];
    if (houseAt(occ, cx, cy) < 0) return [cx, cy];
    cand[c * 3] = -1;
  }
  return [fx, fy];
}
