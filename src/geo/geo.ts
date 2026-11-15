/** Small geodesy helpers. Coordinates are [lon, lat] in degrees; distances in metres. */

export const EARTH_RADIUS_M = 6_371_008.8;
const RAD = Math.PI / 180;

export type LonLat = [number, number];
/** [west, south, east, north] in degrees. */
export type BBox = [number, number, number, number];

export function distanceM(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const dLat = (bLat - aLat) * RAD;
  const dLon = (bLon - aLon) * RAD;
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(aLat * RAD) * Math.cos(bLat * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Metres per degree of latitude / longitude around a latitude (equirectangular approximation). */
export function metresPerDegree(lat: number): { lon: number; lat: number } {
  const perDeg = EARTH_RADIUS_M * RAD;
  return { lon: perDeg * Math.cos(lat * RAD), lat: perDeg };
}

/** Expand a bbox by a distance in metres. */
export function expandBBox(b: BBox, metres: number): BBox {
  const m = metresPerDegree((b[1] + b[3]) / 2);
  const dLon = metres / Math.max(m.lon, 1e-6);
  const dLat = metres / m.lat;
  return [b[0] - dLon, b[1] - dLat, b[2] + dLon, b[3] + dLat];
}

export function bboxOfCoords(flat: ArrayLike<number>): BBox {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (let i = 0; i < flat.length; i += 2) {
    const x = flat[i], y = flat[i + 1];
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  return [w, s, e, n];
}

export function bboxIntersects(a: BBox, b: BBox): boolean {
  return a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

export function polylineLengthM(flat: ArrayLike<number>): number {
  let len = 0;
  for (let i = 2; i < flat.length; i += 2) {
    len += distanceM(flat[i - 2], flat[i - 1], flat[i], flat[i + 1]);
  }
  return len;
}

/** Squared distance from point p to segment ab, all in a local metric plane. */
export function pointSegmentDist2(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return qx * qx + qy * qy;
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** True when segments ab and cd properly cross or touch. */
export function segmentsIntersect(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy);
  const o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay);
  const o4 = orient(cx, cy, dx, dy, bx, by);
  return ((o1 > 0 && o2 < 0) || (o1 < 0 && o2 > 0)) && ((o3 > 0 && o4 < 0) || (o3 < 0 && o4 > 0));
}

/** Distance between segments ab and cd in a local metric plane. */
export function segmentSegmentDist(
  ax: number, ay: number, bx: number, by: number,
  cx: number, cy: number, dx: number, dy: number,
): number {
  if (segmentsIntersect(ax, ay, bx, by, cx, cy, dx, dy)) return 0;
  return Math.sqrt(
    Math.min(
      pointSegmentDist2(ax, ay, cx, cy, dx, dy),
      pointSegmentDist2(bx, by, cx, cy, dx, dy),
      pointSegmentDist2(cx, cy, ax, ay, bx, by),
      pointSegmentDist2(dx, dy, ax, ay, bx, by),
    ),
  );
}

/**
 * Shortest distance (metres) between the walked segment a→b and a polyline (flat lon/lat).
 * Uses an equirectangular plane centred on a, which is exact enough at street scale.
 */
export function segmentToPolylineM(
  aLon: number, aLat: number, bLon: number, bLat: number, flat: ArrayLike<number>,
): number {
  const m = metresPerDegree(aLat);
  const bx = (bLon - aLon) * m.lon, by = (bLat - aLat) * m.lat;
  let best = Infinity;
  let px = (flat[0] - aLon) * m.lon, py = (flat[1] - aLat) * m.lat;
  if (flat.length === 2) return Math.sqrt(pointSegmentDist2(px, py, 0, 0, bx, by));
  for (let i = 2; i < flat.length; i += 2) {
    const qx = (flat[i] - aLon) * m.lon, qy = (flat[i + 1] - aLat) * m.lat;
    const d = segmentSegmentDist(0, 0, bx, by, px, py, qx, qy);
    if (d < best) best = d;
    if (best === 0) return 0;
    px = qx;
    py = qy;
  }
  return best;
}

export interface Projection {
  /** Shortest distance from the point to the polyline, metres. */
  distM: number;
  /** Distance along the polyline to the nearest point, metres from its start. */
  alongM: number;
}

/**
 * Project a point onto a polyline (flat lon/lat), returning how far away it is and how far along
 * the nearest point lies. All in metres on a local plane; exact enough at street scale.
 */
export function projectOnPolylineM(lon: number, lat: number, flat: ArrayLike<number>): Projection {
  const m = metresPerDegree(lat);
  if (flat.length <= 2) {
    return { distM: distanceM(lon, lat, flat[0], flat[1]), alongM: 0 };
  }
  // Coordinates relative to the point, so projecting the origin on each segment is cheap.
  let px = (flat[0] - lon) * m.lon, py = (flat[1] - lat) * m.lat;
  let along = 0, best = Infinity, bestAlong = 0;
  for (let i = 2; i < flat.length; i += 2) {
    const qx = (flat[i] - lon) * m.lon, qy = (flat[i + 1] - lat) * m.lat;
    const dx = qx - px, dy = qy - py;
    const len2 = dx * dx + dy * dy;
    const segLen = Math.sqrt(len2);
    let t = len2 > 0 ? -(px * dx + py * dy) / len2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const cx = px + t * dx, cy = py + t * dy;
    const d2 = cx * cx + cy * cy;
    if (d2 < best) {
      best = d2;
      bestAlong = along + t * segLen;
    }
    along += segLen;
    px = qx;
    py = qy;
  }
  return { distM: Math.sqrt(best), alongM: bestAlong };
}

/** Shortest distance between two polylines (flat lon/lat), metres. */
export function polylineDistanceM(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (!a.length || !b.length) return Infinity;
  if (a.length < 4 || b.length < 4) {
    // Degenerate input: compare the few points we have.
    let best = Infinity;
    for (let i = 0; i < a.length; i += 2) {
      for (let j = 0; j < b.length; j += 2) best = Math.min(best, distanceM(a[i], a[i + 1], b[j], b[j + 1]));
    }
    return best;
  }
  const m = metresPerDegree(a[1]);
  const ax = (i: number) => (a[i] - a[0]) * m.lon;
  const ay = (i: number) => (a[i + 1] - a[1]) * m.lat;
  const bx = (i: number) => (b[i] - a[0]) * m.lon;
  const by = (i: number) => (b[i + 1] - a[1]) * m.lat;
  let best = Infinity;
  for (let i = 2; i < a.length; i += 2) {
    for (let j = 2; j < b.length; j += 2) {
      const d = segmentSegmentDist(
        ax(i - 2), ay(i - 2), ax(i), ay(i),
        bx(j - 2), by(j - 2), bx(j), by(j),
      );
      if (d < best) best = d;
      if (best === 0) return 0;
    }
  }
  return best;
}

/** Bearing in degrees clockwise from north, from a to b. */
export function bearingDeg(aLon: number, aLat: number, bLon: number, bLat: number): number {
  const φ1 = aLat * RAD, φ2 = bLat * RAD, Δλ = (bLon - aLon) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) / RAD + 360) % 360;
}

// ---- Slippy-map tiles (used as the street cache grid) ----

export function lonLatToTile(lon: number, lat: number, z: number): { x: number; y: number } {
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const latR = lat * RAD;
  const y = Math.floor(((1 - Math.log(Math.tan(latR) + 1 / Math.cos(latR)) / Math.PI) / 2) * n);
  return { x: Math.min(n - 1, Math.max(0, x)), y: Math.min(n - 1, Math.max(0, y)) };
}

export function tileToBBox(x: number, y: number, z: number): BBox {
  const n = 2 ** z;
  const lon = (tx: number) => (tx / n) * 360 - 180;
  const lat = (ty: number) => Math.atan(Math.sinh(Math.PI * (1 - (2 * ty) / n))) / RAD;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

export function cellKey(z: number, x: number, y: number): string {
  return `${z}/${x}/${y}`;
}

export function parseCellKey(key: string): { z: number; x: number; y: number } {
  const [z, x, y] = key.split('/').map(Number);
  return { z, x, y };
}

/** Web-Mercator coordinates normalised to 0..1 (same convention as MapLibre's MercatorCoordinate). */
export function toMercator(flat: ArrayLike<number>): Float64Array {
  const out = new Float64Array(flat.length);
  for (let i = 0; i < flat.length; i += 2) {
    out[i] = (flat[i] + 180) / 360;
    const s = Math.sin(flat[i + 1] * RAD);
    out[i + 1] = 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
  }
  return out;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
