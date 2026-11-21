import type { Occluders } from './occluders';

/**
 * What you can see from a spot: rays fanned out around you, each stopping at the first wall
 * (an angular sweep, as in the map-view prototype). Everything is in WM units (see occluders.ts).
 */
export interface Sight {
  x: number;
  y: number;
  radius: number;
  n: number;
  /** Ray angles, sorted ascending in (-PI, PI], atan2 in WM (y south). */
  ang: Float64Array;
  /** Free distance along each ray (≤ radius), WM units. */
  dist: Float64Array;
  /** House index (into Occluders.houses) each ray stops at, or -1. */
  hit: Int32Array;
  /** Unit vector of each ray (cos, sin of `ang`), kept so the polygon is cheap to rebuild. */
  ux: Float64Array;
  uy: Float64Array;
}

const PI = Math.PI;
const TAU = 2 * PI;
/** Rays just either side of every corner: one stops at the wall, the other slips past it. */
const EPS = 2e-4;
/** Evenly spaced rays, so open ground between far corners is still sampled. */
const BASE_RAYS = 240;

/** An empty sight with room for `cap` rays; pass it back to `computeSight` to reuse it. */
export function newSight(cap = 1024): Sight {
  return {
    x: 0, y: 0, radius: 0, n: 0, ang: new Float64Array(cap), dist: new Float64Array(cap), hit: new Int32Array(cap),
    ux: new Float64Array(cap), uy: new Float64Array(cap),
  };
}

// Scratch reused across calls: the walls that face you (ax, ay, ex, ey relative to you, and
// cross(a, b)), their angular span, their owner.
let wall = new Float64Array(5 * 512);
let wallLo = new Float64Array(512);
let wallHi = new Float64Array(512);
let wallOwner = new Int32Array(512);

function grow(s: Sight, cap: number): void {
  if (s.ang.length >= cap) return;
  const c = Math.max(cap, s.ang.length * 2);
  s.ang = new Float64Array(c);
  s.dist = new Float64Array(c);
  s.hit = new Int32Array(c);
  s.ux = new Float64Array(c);
  s.uy = new Float64Array(c);
}

function growWalls(cap: number): void {
  if (wallLo.length >= cap) return;
  const c = Math.max(cap, wallLo.length * 2);
  const w = new Float64Array(5 * c);
  w.set(wall);
  wall = w;
  wallLo = new Float64Array(c);
  wallHi = new Float64Array(c);
  wallOwner = new Int32Array(c);
}

/** First index in sorted a[0, n) whose value is ≥ v. */
function lowerBound(a: Float64Array, n: number, v: number): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** First index in sorted a[0, n) whose value is > v. */
function upperBound(a: Float64Array, n: number, v: number): number {
  let lo = 0, hi = n;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (a[m] <= v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Shorten rays [i0, i1) to where they meet wall w. */
function cast(s: Sight, w: number, i0: number, i1: number): void {
  const o = w * 5, ex = wall[o + 2], ey = wall[o + 3], num = wall[o + 4], own = wallOwner[w];
  const rayX = s.ux, rayY = s.uy, dist = s.dist, hit = s.hit;
  for (let i = i0; i < i1; i++) {
    // Ray t·u meets a + s·e where t = cross(a, e) / cross(u, e); both are negative for a wall
    // that faces you and a ray inside its span.
    const den = rayX[i] * ey - rayY[i] * ex;
    if (den >= 0) continue;
    const t = num / den;
    if (t < dist[i]) {
      dist[i] = t;
      hit[i] = own;
    }
  }
}

/**
 * The visibility polygon from (x, y) out to `radius` (WM). Only walls that face you count: from
 * outside every house, a ray always meets a facing wall first. Call `stepOutside` first when
 * you may be standing inside a house. Pass the previous result as `out` to reuse its arrays.
 */
export function computeSight(x: number, y: number, occ: Occluders, radius: number, out?: Sight): Sight {
  const s = out ?? newSight();
  const E = occ.edges, N = occ.n, own = occ.owner;
  growWalls(N);
  grow(s, 4 * N + BASE_RAYS);
  const ang = s.ang;
  const r2 = radius * radius;
  let nw = 0, na = 0;
  for (let e = 0; e < N; e++) {
    const o = e * 8;
    const ax = E[o] - x, ay = E[o + 1] - y, bx = E[o + 2] - x, by = E[o + 3] - y;
    // cross(b - a, you - a) < 0: you are on the open-air side of this wall.
    const num = ax * by - ay * bx;
    if (num >= 0) continue;
    if ((ax > radius && bx > radius) || (ax < -radius && bx < -radius)) continue;
    if ((ay > radius && by > radius) || (ay < -radius && by < -radius)) continue;
    const ex = bx - ax, ey = by - ay, l2 = ex * ex + ey * ey;
    let t = -(ax * ex + ay * ey) / l2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = ax + t * ex, qy = ay + t * ey;
    if (qx * qx + qy * qy > r2) continue;
    const w = nw * 5;
    wall[w] = ax;
    wall[w + 1] = ay;
    wall[w + 2] = ex;
    wall[w + 3] = ey;
    wall[w + 4] = num;
    wallOwner[nw] = own[e];
    // A facing wall has cross(a, b) < 0: its angle falls from a to b, so its span is [b, a].
    const ta = Math.atan2(ay, ax), tb = Math.atan2(by, bx);
    wallLo[nw] = tb;
    wallHi[nw++] = ta;
    // Rays by corner a; by corner b only where the next wall turns away (a silhouette corner),
    // since otherwise the next wall adds b as its own a.
    let u = ta - EPS;
    ang[na++] = u <= -PI ? u + TAU : u;
    u = ta + EPS;
    ang[na++] = u > PI ? u - TAU : u;
    const nx = E[o + 6] - x, ny = E[o + 7] - y;
    if (bx * ny - by * nx >= 0) {
      u = tb - EPS;
      ang[na++] = u <= -PI ? u + TAU : u;
      u = tb + EPS;
      ang[na++] = u > PI ? u - TAU : u;
    }
  }
  for (let k = 0; k < BASE_RAYS; k++) ang[na++] = -PI + ((k + 0.5) * TAU) / BASE_RAYS;
  ang.subarray(0, na).sort();

  const ux = s.ux, uy = s.uy;
  for (let i = 0; i < na; i++) {
    ux[i] = Math.cos(ang[i]);
    uy[i] = Math.sin(ang[i]);
  }
  s.dist.fill(radius, 0, na);
  s.hit.fill(-1, 0, na);
  for (let w = 0; w < nw; w++) {
    const lo = wallLo[w], hi = wallHi[w];
    if (lo <= hi) cast(s, w, lowerBound(ang, na, lo), upperBound(ang, na, hi));
    else {
      // The wall straddles ±PI (it is to your west).
      cast(s, w, lowerBound(ang, na, lo), na);
      cast(s, w, 0, upperBound(ang, na, hi));
    }
  }
  s.x = x;
  s.y = y;
  s.radius = radius;
  s.n = na;
  return s;
}

/**
 * Distance along direction (cx, cy) to the polygon side from ray i0 to ray i1: exact for a
 * straight wall between them. Both rays free: the arc, so the edge of the light stays round.
 */
export function chordDistance(s: Sight, i0: number, i1: number, cx: number, cy: number): number {
  const d0 = s.dist[i0], d1 = s.dist[i1], R = s.radius;
  if (d0 >= R && d1 >= R) return R;
  const p0x = s.ux[i0] * d0, p0y = s.uy[i0] * d0;
  const ex = s.ux[i1] * d1 - p0x, ey = s.uy[i1] * d1 - p0y;
  const den = cx * ey - cy * ex;
  if (den > -1e-12 && den < 1e-12) return d0 < d1 ? d0 : d1;
  const t = (p0x * ey - p0y * ex) / den;
  return t < 0 ? 0 : t > R ? R : t;
}

/** Free distance towards an angle, on the polygon side between the neighbouring rays (for rasterising). */
export function sightDistance(s: Sight, angle: number): number {
  const n = s.n;
  if (n === 0) return s.radius;
  let a = angle;
  if (a > PI || a <= -PI) a -= Math.ceil((a - PI) / TAU) * TAU;
  const i = lowerBound(s.ang, n, a);
  // Between the last ray and the first one across ±PI, else between i - 1 and i.
  const i0 = i === 0 || i === n ? n - 1 : i - 1, i1 = i === n ? 0 : i;
  return chordDistance(s, i0, i1, Math.cos(a), Math.sin(a));
}
