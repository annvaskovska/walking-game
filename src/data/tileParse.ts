/**
 * Turns one z14 OpenMapTiles vector tile into the app's street graph and house footprints.
 *
 * The basemap tiles are built by planetiler-openmaptiles, which shapes them for drawing, not for
 * routing, so this module rebuilds what the walking rules need:
 *  - `transportation` lines are merged strokes (one feature can hold hundreds of OSM ways) with no
 *    names and no node ids. Junctions are found geometrically: line ends that touch another line,
 *    shared vertices and crossings on the same layer. Every stroke is cut at its junctions, so each
 *    resulting edge is one city block side between two intersections.
 *  - Names come from `transportation_name`, matched by geometry (the two layers come from the same
 *    OSM ways) and checked per edge, because a merged stroke can run through several streets.
 *  - Sidewalks and crossings are not tagged in the tiles. A footway that runs alongside a road for
 *    most of its length, or a short one across a road, is dropped: walking it lights the road.
 *  - Lines and buildings are clipped exactly to the tile square, so neighbouring tiles join without
 *    overlaps and each piece of street belongs to exactly one tile.
 *  - Landmarks come from the `poi` layer: the named shops, cafés, churches, schools… a walker would
 *    recognise a street by. Points in the tile's buffer are left to the tile they are in.
 */
import { bboxOfCoords } from '../geo/geo';
import type { Building, PieceKind, Place, WayInput } from '../core/types';
import type { MvtLayer, MvtValue } from './mvt';

export interface ParsedTile {
  ways: WayInput[];
  houses: Building[];
  places: Place[];
}

type Props = Record<string, MvtValue>;

/** Layers parseTile reads; pass to decodeTile so the rest of the tile is skipped. */
export const TILE_LAYERS: ReadonlySet<string> = new Set(['transportation', 'transportation_name', 'building', 'poi']);

const ROAD_CLASSES = new Set(['trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'track']);
const PATH_SUBCLASSES = new Set(['footway', 'path', 'cycleway', 'steps', 'bridleway', 'pedestrian']);
/** Path kinds that may be a sidewalk or crossing in disguise. */
const SIDE_CANDIDATES = new Set(['footway', 'path', 'cycleway']);

const truthy = (v: MvtValue | undefined) => v === true || v === 1 || v === '1' || v === 'yes';

/** A walkable line's part in the lighting rule, or null when it can't be walked (or shouldn't light). */
export function classify(p: Props): { kind: PieceKind; hw: string } | null {
  const cls = String(p.class ?? '');
  const sub = p.subclass == null ? '' : String(p.subclass);
  if (p.brunnel === 'tunnel' || truthy(p.indoor)) return null;
  if (p.level != null && Number(p.level) < 0) return null;
  const foot = p.foot == null ? '' : String(p.foot);
  if (foot === 'no' || foot === 'private') return null;
  if (p.access === 'no' && foot !== 'yes' && foot !== 'designated' && foot !== 'permissive') return null;
  if (cls === 'path') {
    if (!PATH_SUBCLASSES.has(sub)) return null;
    // Pedestrian streets are streets: they unlock and get their name written in gold.
    return sub === 'pedestrian' ? { kind: 'road', hw: 'pedestrian' } : { kind: 'path', hw: sub };
  }
  if (!ROAD_CLASSES.has(cls)) return null;
  if (cls === 'trunk' && (truthy(p.expressway) || truthy(p.ramp))) return null;
  if (cls === 'service' && (p.service === 'parking_aisle' || p.service === 'driveway')) return null;
  return { kind: 'road', hw: cls };
}

/**
 * Landmarks are what you would name when giving the way: past the bakery, left at the church, the
 * street with the Spar. So shops, food and drink, services with a shop window, and public
 * buildings. Not stops, boards, parking, ATMs, parcel lockers, charging points and bike docks, nor
 * what you go to by appointment, often upstairs (offices, doctors, dentists, hairdressers, beauty
 * salons): on real tiles those were half of the named points, and hardly any of them shape a street.
 */
const LANDMARK_CLASSES = new Set([
  // Shops
  'shop', 'clothing_store', 'grocery', 'alcohol_shop', 'bakery', 'butcher', 'bicycle', 'music', 'library',
  // Food and drink
  'restaurant', 'cafe', 'fast_food', 'bar', 'beer', 'ice_cream',
  // Services you see from the street
  'pharmacy', 'bank', 'post', 'fuel', 'lodging',
  // Public buildings and places
  'school', 'college', 'place_of_worship', 'museum', 'theatre', 'cinema', 'art_gallery', 'attraction',
  'monument', 'castle', 'zoo', 'town_hall', 'police', 'hospital', 'stadium', 'sports_centre',
  'park', 'garden', 'cemetery',
  // Stations, not stops
  'railway', 'bus', 'ferry_terminal',
]);
/** Classes that mix landmarks with street furniture: only these subclasses count. */
const LANDMARK_ONLY: Readonly<Record<string, ReadonlySet<string>>> = {
  post: new Set(['post_office']),
  fuel: new Set(['fuel']),
  railway: new Set(['station', 'subway', 'halt']),
  bus: new Set(['bus_station']),
};
/** Shops you go to by appointment. */
const NOT_LANDMARK_SUBCLASSES = new Set(['beauty', 'massage', 'tattoo']);

/** Is this `poi` feature a landmark (whatever its name)? */
export function isLandmark(p: Props): boolean {
  const cls = String(p.class ?? '');
  if (!LANDMARK_CLASSES.has(cls) || truthy(p.indoor)) return false;
  const sub = p.subclass == null ? '' : String(p.subclass);
  const only = LANDMARK_ONLY[cls];
  return only ? only.has(sub) : !NOT_LANDMARK_SUBCLASSES.has(sub);
}

// ---- Small geometry kit, in tile units ----

/** Squared distance from p to segment ab and the projection parameter t in [0, 1]. */
function projSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const qx = ax + t * dx - px, qy = ay + t * dy - py;
  return [qx * qx + qy * qy, t];
}

function cumulative(pts: number[]): number[] {
  const cum = [0];
  for (let i = 2; i < pts.length; i += 2) {
    cum.push(cum[cum.length - 1] + Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]));
  }
  return cum;
}

/** Point and unit direction at a distance along a polyline. */
function pointAt(pts: number[], cum: number[], d: number): [number, number, number, number] {
  let i = 1;
  while (i < cum.length - 1 && cum[i] < d) i++;
  const seg = cum[i] - cum[i - 1];
  const t = seg > 0 ? Math.min(1, Math.max(0, (d - cum[i - 1]) / seg)) : 0;
  const ax = pts[2 * i - 2], ay = pts[2 * i - 1], bx = pts[2 * i], by = pts[2 * i + 1];
  const len = Math.hypot(bx - ax, by - ay) || 1;
  return [ax + (bx - ax) * t, ay + (by - ay) * t, (bx - ax) / len, (by - ay) / len];
}

/** The polyline between two distances along it. */
function slice(pts: number[], cum: number[], d0: number, d1: number): number[] {
  const [x0, y0] = pointAt(pts, cum, d0);
  const out = [x0, y0];
  for (let i = 1; i < cum.length - 1; i++) {
    if (cum[i] > d0 && cum[i] < d1) out.push(pts[2 * i], pts[2 * i + 1]);
  }
  const [x1, y1] = pointAt(pts, cum, d1);
  out.push(x1, y1);
  return out;
}

/** Sample spacing, and the lengths (m) that tell a sidewalk from a path that passes a road. */
const SIDE_SAMPLE_M = 4;
/** A break shorter than this in a run beside a road (a driveway, a corner) is part of the run. */
const SIDE_GAP_M = 10;
/** A run beside a road this long is a sidewalk; so is a shorter one that is most of its line. */
const SIDE_RUN_M = 16;
/** What is left at a line's end next to a sidewalk run, when shorter than this, goes with it. */
const SIDE_STUB_M = 8;

/**
 * The stretches of a footway or cycleway to keep, as [from, to] distances along it: all of it but
 * the runs beside a road. `beside` says whether a road runs alongside a point in that direction.
 */
export function keptStretches(
  pts: number[],
  cum: number[],
  totalM: number,
  beside: (px: number, py: number, dx: number, dy: number, maxD: number) => boolean,
  maxD: number,
): [number, number][] {
  const total = cum[cum.length - 1];
  if (!(total > 0)) return [];
  const n = Math.max(3, Math.min(2000, Math.round(totalM / SIDE_SAMPLE_M)));
  const stepM = totalM / n;
  type Run = { side: boolean; n: number };
  let runs: Run[] = [];
  const pushRun = (list: Run[], side: boolean, count: number) => {
    const last = list[list.length - 1];
    if (last && last.side === side) last.n += count;
    else list.push({ side, n: count });
  };
  for (let k = 0; k < n; k++) {
    const [px, py, dx, dy] = pointAt(pts, cum, ((k + 0.5) / n) * total);
    pushRun(runs, beside(px, py, dx, dy, maxD), 1);
  }
  const remerge = () => {
    const out: Run[] = [];
    for (const r of runs) pushRun(out, r.side, r.n);
    runs = out;
  };
  for (let i = 1; i < runs.length - 1; i++) {
    if (!runs[i].side && runs[i].n * stepM < SIDE_GAP_M) runs[i].side = true;
  }
  remerge();
  for (const r of runs) if (r.side && r.n * stepM < SIDE_RUN_M && r.n < n * 0.6) r.side = false;
  remerge();
  if (runs.length > 1) {
    const first = runs[0], last = runs[runs.length - 1];
    if (!first.side && first.n * stepM < SIDE_STUB_M) first.side = true;
    if (!last.side && last.n * stepM < SIDE_STUB_M) last.side = true;
    remerge();
  }
  // Ends of kept stretches sit between two samples; move them onto a vertex nearby, where the
  // line usually turns away from the road.
  const snap = (d: number) => {
    if (d <= 0 || d >= total) return d;
    let best = d, bestDiff = (total / n) * 1.01;
    for (let i = 1; i < cum.length - 1; i++) {
      const diff = Math.abs(cum[i] - d);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = cum[i];
      }
    }
    return best;
  };
  const out: [number, number][] = [];
  let k = 0;
  for (const r of runs) {
    if (!r.side) {
      const a = k === 0 ? 0 : snap((k / n) * total);
      const b = k + r.n === n ? total : snap(((k + r.n) / n) * total);
      if (b > a) out.push([a, b]);
    }
    k += r.n;
  }
  return out;
}

/** Clip a polyline to the square [0, size]², keeping every inside run as its own line. */
export function clipLine(pts: number[], size: number): number[][] {
  const out: number[][] = [];
  let cur: number[] | null = null;
  for (let i = 2; i < pts.length; i += 2) {
    const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
    // Liang–Barsky
    const dx = bx - ax, dy = by - ay;
    let t0 = 0, t1 = 1, ok = true;
    const edge = (p: number, q: number) => {
      if (p === 0) {
        if (q < 0) ok = false;
        return;
      }
      const r = q / p;
      if (p < 0) {
        if (r > t1) ok = false;
        else if (r > t0) t0 = r;
      } else if (r < t0) ok = false;
      else if (r < t1) t1 = r;
    };
    edge(-dx, ax);
    edge(dx, size - ax);
    edge(-dy, ay);
    edge(dy, size - ay);
    if (!ok) {
      cur = null;
      continue;
    }
    const cx0 = ax + t0 * dx, cy0 = ay + t0 * dy;
    const cx1 = ax + t1 * dx, cy1 = ay + t1 * dy;
    if (!cur || t0 > 0) {
      cur = [cx0, cy0];
      out.push(cur);
    }
    cur.push(cx1, cy1);
    if (t1 < 1) cur = null;
  }
  return out.filter((l) => l.length >= 4);
}

/** Sutherland–Hodgman clip of a closed ring (without its closing point) to [0, size]². */
export function clipRing(ring: number[], size: number): number[] {
  let pts = ring;
  const planes: [(x: number, y: number) => number][] = [
    [(x) => x], [(x) => size - x], [(_x, y) => y], [(_x, y) => size - y],
  ];
  for (const [f] of planes) {
    if (pts.length < 6) return [];
    const next: number[] = [];
    const n = pts.length / 2;
    for (let i = 0; i < n; i++) {
      const ax = pts[2 * i], ay = pts[2 * i + 1];
      const j = (i + 1) % n;
      const bx = pts[2 * j], by = pts[2 * j + 1];
      const fa = f(ax, ay), fb = f(bx, by);
      if (fa >= 0) next.push(ax, ay);
      if ((fa >= 0) !== (fb >= 0)) {
        const t = fa / (fa - fb);
        next.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      }
    }
    pts = next;
  }
  return pts.length >= 6 ? pts : [];
}

function ringArea(r: number[]): number {
  let a = 0;
  const n = r.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    a += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1];
  }
  return a / 2;
}

/** Uniform hash grid of line segments. */
class SegGrid {
  private cells = new Map<number, number[]>();
  constructor(private cell: number) {}
  private key(cx: number, cy: number) {
    return (cx + 1024) * 4096 + (cy + 1024);
  }
  add(ref: number, ax: number, ay: number, bx: number, by: number, pad: number) {
    const c = this.cell;
    const x0 = Math.floor((Math.min(ax, bx) - pad) / c), x1 = Math.floor((Math.max(ax, bx) + pad) / c);
    const y0 = Math.floor((Math.min(ay, by) - pad) / c), y1 = Math.floor((Math.max(ay, by) + pad) / c);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const k = this.key(x, y);
        const l = this.cells.get(k);
        if (l) l.push(ref);
        else this.cells.set(k, [ref]);
      }
    }
  }
  near(x: number, y: number): number[] {
    return this.cells.get(this.key(Math.floor(x / this.cell), Math.floor(y / this.cell))) ?? [];
  }
  /** Every non-empty cell with its column and row. */
  *entries(): IterableIterator<[number, number, number[]]> {
    for (const [k, refs] of this.cells) yield [Math.floor(k / 4096) - 1024, (k % 4096) - 1024, refs];
  }
}

const REF = 65536;

interface Line {
  pts: number[];
  cum: number[];
  kind: PieceKind;
  hw: string;
  cls: string;
  sub: string;
  layer: number;
  /** Distances along the line (units) where another line meets it. */
  cuts: number[];
}

interface NameLine {
  pts: number[];
  name: string;
  cls: string;
  sub: string;
}

function fnv(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;
const text = (v: MvtValue | undefined) => (v == null ? '' : String(v).trim());

/**
 * Parse the street graph, houses and landmarks out of a decoded z14 tile.
 * Coordinates come back as lon/lat; ids are stable for the same geometry.
 */
export function parseTile(layers: Map<string, MvtLayer>, z: number, x: number, y: number): ParsedTile {
  const tr = layers.get('transportation');
  const extent = tr?.extent ?? layers.get('building')?.extent ?? 4096;
  const n = 2 ** z;
  const lonOf = (u: number, ext = extent) => round6(((x + u / ext) / n) * 360 - 180);
  const latOf = (v: number, ext = extent) =>
    round6((Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + v / ext)) / n))) * 180) / Math.PI);
  const latC = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (y + 0.5)) / n))) * 180) / Math.PI;
  /** Metres per tile unit at this tile's latitude. */
  const mpu = (40_075_016.686 * Math.cos((latC * Math.PI) / 180)) / (n * extent);
  const U = (metres: number) => metres / mpu;

  const toLonLat = (pts: number[]) => {
    const out: number[] = [];
    for (let i = 0; i < pts.length; i += 2) out.push(lonOf(pts[i]), latOf(pts[i + 1]));
    return out;
  };

  // ---- 1. Walkable lines ----
  const raw: Line[] = [];
  for (const f of tr?.features ?? []) {
    if (f.type !== 2) continue;
    const c = classify(f.props);
    if (!c) continue;
    const cls = String(f.props.class ?? '');
    const sub = f.props.subclass == null ? '' : String(f.props.subclass);
    const layer = Number(f.props.layer ?? 0) || 0;
    for (const part of f.parts) {
      if (part.length < 4) continue;
      raw.push({ pts: part, cum: cumulative(part), kind: c.kind, hw: c.hw, cls, sub, layer, cuts: [] });
    }
  }

  // ---- 2. Drop sidewalks and crossings ----
  // Neither is tagged in the tiles, and one merged footway stroke can run along a road, cross it
  // and wander off into a park. So each candidate is judged along its length: the stretches beside
  // a road are cut out (walking them lights the road), short leftovers go with them, and what is
  // left is judged as a crossing on its own. This runs before the junction step, so a dropped
  // stretch never cuts a road into extra pieces.
  const roadGrid = new SegGrid(64);
  raw.forEach((l, li) => {
    if (l.kind !== 'road' || l.hw === 'pedestrian') return;
    for (let i = 2; i < l.pts.length; i += 2) {
      roadGrid.add(li * REF + i / 2 - 1, l.pts[i - 2], l.pts[i - 1], l.pts[i], l.pts[i + 1], U(16));
    }
  });
  /** True when a road runs within `maxD` of the point, in the same direction. */
  const besideRoad = (px: number, py: number, dx: number, dy: number, maxD: number) => {
    for (const ref of roadGrid.near(px, py)) {
      const l = raw[Math.floor(ref / REF)];
      const s = ref % REF;
      const ax = l.pts[2 * s], ay = l.pts[2 * s + 1], bx = l.pts[2 * s + 2], by = l.pts[2 * s + 3];
      const [d2] = projSeg(px, py, ax, ay, bx, by);
      if (d2 > maxD * maxD) continue;
      const len = Math.hypot(bx - ax, by - ay) || 1;
      if (Math.abs(((bx - ax) * dx + (by - ay) * dy) / len) >= 0.8) return true;
    }
    return false;
  };
  const crossesRoad = (pts: number[]) => {
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
      for (const p of [[ax, ay], [bx, by], [(ax + bx) / 2, (ay + by) / 2]]) {
        for (const ref of roadGrid.near(p[0], p[1])) {
          const r = raw[Math.floor(ref / REF)];
          const s = ref % REF;
          if (segCross(ax, ay, bx, by, r.pts[2 * s], r.pts[2 * s + 1], r.pts[2 * s + 2], r.pts[2 * s + 3])) return true;
        }
      }
    }
    return false;
  };
  const lines: Line[] = [];
  for (const l of raw) {
    if (l.kind !== 'path' || !SIDE_CANDIDATES.has(l.hw)) {
      lines.push(l);
      continue;
    }
    const total = l.cum[l.cum.length - 1];
    for (const [a, b] of keptStretches(l.pts, l.cum, total * mpu, besideRoad, U(14))) {
      const pts = a <= 0 && b >= total ? l.pts : slice(l.pts, l.cum, a, b);
      const cum = a <= 0 && b >= total ? l.cum : cumulative(pts);
      const lenM = cum[cum.length - 1] * mpu;
      if (lenM <= 30 && crossesRoad(pts)) continue; // a crossing
      lines.push({ ...l, pts, cum, cuts: [] });
    }
  }

  // ---- 3. Junctions ----
  const grid = new SegGrid(48);
  lines.forEach((l, li) => {
    for (let i = 2; i < l.pts.length; i += 2) {
      grid.add(li * REF + i / 2 - 1, l.pts[i - 2], l.pts[i - 1], l.pts[i], l.pts[i + 1], 2);
    }
  });
  const touchTol = 1.6;
  /** Cuts closer than this along a line are one junction. */
  const mergeTol = U(2.5);
  /** `at`: how far along line `li` the point is, so the line can meet itself but not its own stretch there. */
  const addCutsNear = (li: number, px: number, py: number, tol: number, sameLayerOnly: boolean, at: number) => {
    let hit = false;
    for (const ref of grid.near(px, py)) {
      const lj = Math.floor(ref / REF);
      const m = lines[lj];
      if (sameLayerOnly && m.layer !== lines[li].layer) continue;
      const s = ref % REF;
      const [d2, t] = projSeg(px, py, m.pts[2 * s], m.pts[2 * s + 1], m.pts[2 * s + 2], m.pts[2 * s + 3]);
      if (d2 > tol * tol) continue;
      const d = m.cum[s] + t * (m.cum[s + 1] - m.cum[s]);
      // A merged stroke can loop back to a junction it already passed: that is a junction too.
      if (lj === li && Math.abs(d - at) <= mergeTol) continue;
      m.cuts.push(d);
      hit = true;
    }
    return hit;
  };
  lines.forEach((l, li) => {
    const last = l.pts.length - 2;
    // A line that ends on another one joins it there (whatever their layers: they connect).
    addCutsNear(li, l.pts[0], l.pts[1], touchTol, false, 0);
    addCutsNear(li, l.pts[last], l.pts[last + 1], touchTol, false, l.cum[l.cum.length - 1]);
    // A vertex shared with another line on the same layer is a crossing of both.
    for (let i = 2; i < last; i += 2) {
      if (addCutsNear(li, l.pts[i], l.pts[i + 1], 0.75, true, l.cum[i / 2])) l.cuts.push(l.cum[i / 2]);
    }
  });
  // Proper crossings without a shared vertex (simplification can drop it), same layer only.
  // Both segments sit in the cell holding their crossing point, so each crossing is counted in
  // exactly that cell and no pair needs remembering.
  for (const [cx, cy, refs] of grid.entries()) {
    for (let a = 0; a < refs.length; a++) {
      const la = Math.floor(refs[a] / REF);
      const A = lines[la];
      const sa = refs[a] % REF;
      const ax = A.pts[2 * sa], ay = A.pts[2 * sa + 1], bx = A.pts[2 * sa + 2], by = A.pts[2 * sa + 3];
      for (let b = a + 1; b < refs.length; b++) {
        const lb = Math.floor(refs[b] / REF);
        // The same line may cross itself; its neighbouring segments share a vertex and never cross.
        if (A.layer !== lines[lb].layer) continue;
        const B = lines[lb];
        const sb = refs[b] % REF;
        const hit = segIntersect(ax, ay, bx, by, B.pts[2 * sb], B.pts[2 * sb + 1], B.pts[2 * sb + 2], B.pts[2 * sb + 3]);
        if (!hit) continue;
        const ix = ax + (bx - ax) * hit[0], iy = ay + (by - ay) * hit[0];
        if (Math.floor(ix / 48) !== cx || Math.floor(iy / 48) !== cy) continue;
        A.cuts.push(A.cum[sa] + hit[0] * (A.cum[sa + 1] - A.cum[sa]));
        B.cuts.push(B.cum[sb] + hit[1] * (B.cum[sb + 1] - B.cum[sb]));
      }
    }
  }

  // ---- 4. Names ----
  const names: NameLine[] = [];
  const nameGrid = new SegGrid(48);
  for (const f of layers.get('transportation_name')?.features ?? []) {
    if (f.type !== 2) continue;
    const name = String(f.props.name ?? '').trim();
    if (!name) continue;
    const cls = String(f.props.class ?? '');
    const sub = f.props.subclass == null ? '' : String(f.props.subclass);
    for (const part of f.parts) {
      if (part.length < 4) continue;
      const ni = names.push({ pts: part, name, cls, sub }) - 1;
      for (let i = 2; i < part.length; i += 2) {
        nameGrid.add(ni * REF + i / 2 - 1, part[i - 2], part[i - 1], part[i], part[i + 1], 6);
      }
    }
  }
  const nameOf = (pts: number[], cum: number[], cls: string, sub: string): string | null => {
    const total = cum[cum.length - 1];
    const samples = Math.max(3, Math.min(24, Math.round((total * mpu) / 6)));
    const votes = new Map<string, number>();
    for (let k = 0; k < samples; k++) {
      // Keep away from the ends, where the cross street's name line also passes.
      const d = total * (0.12 + (0.76 * (k + 0.5)) / samples);
      const [px, py, dx, dy] = pointAt(pts, cum, d);
      let best: string | null = null;
      let bestD = 36; // 6 units (about 2 m) squared
      for (const ref of nameGrid.near(px, py)) {
        const nl = names[Math.floor(ref / REF)];
        if (nl.cls !== cls || (cls === 'path' && nl.sub !== sub)) continue;
        const s = ref % REF;
        const ax = nl.pts[2 * s], ay = nl.pts[2 * s + 1], bx = nl.pts[2 * s + 2], by = nl.pts[2 * s + 3];
        const [d2] = projSeg(px, py, ax, ay, bx, by);
        if (d2 >= bestD) continue;
        const len = Math.hypot(bx - ax, by - ay) || 1;
        if (Math.abs(((bx - ax) * dx + (by - ay) * dy) / len) < 0.9) continue;
        bestD = d2;
        best = nl.name;
      }
      if (best) votes.set(best, (votes.get(best) ?? 0) + 1);
    }
    let name: string | null = null;
    let top = 0;
    for (const [k, v] of votes) {
      if (v > top) {
        top = v;
        name = k;
      }
    }
    return top >= samples * 0.5 ? name : null;
  };

  // ---- 5. Cut at junctions, clip to the tile, name and emit ----
  const ways: WayInput[] = [];
  const ids = new Map<string, number>();
  const minEdge = U(3);
  for (const l of lines) {
    const total = l.cum[l.cum.length - 1];
    const cuts = [...new Set(l.cuts)].filter((d) => d > mergeTol && d < total - mergeTol).sort((a, b) => a - b);
    const bounds = [0];
    for (const d of cuts) if (d - bounds[bounds.length - 1] > mergeTol) bounds.push(d);
    if (total - bounds[bounds.length - 1] <= mergeTol && bounds.length > 1) bounds.pop();
    bounds.push(total);
    for (let i = 1; i < bounds.length; i++) {
      const edge = slice(l.pts, l.cum, bounds[i - 1], bounds[i]);
      for (const part of clipLine(edge, extent)) {
        const cum = cumulative(part);
        if (cum[cum.length - 1] < minEdge) continue;
        const coords = toLonLat(part);
        // Drop vertices that rounding made identical.
        const clean: number[] = [coords[0], coords[1]];
        for (let k = 2; k < coords.length; k += 2) {
          if (coords[k] !== clean[clean.length - 2] || coords[k + 1] !== clean[clean.length - 1]) {
            clean.push(coords[k], coords[k + 1]);
          }
        }
        if (clean.length < 4) continue;
        const q = part.map((v) => Math.round(v / 4)).join(',');
        let id = `${x}.${y}.${fnv(`${l.kind}|${q}`)}`;
        const seen = ids.get(id) ?? 0;
        ids.set(id, seen + 1);
        if (seen) id += `.${seen}`;
        ways.push({ id, name: nameOf(part, cum, l.cls, l.sub), highway: l.hw, kind: l.kind, coords: clean });
      }
    }
  }

  // ---- 6. Houses ----
  const houses: Building[] = [];
  const houseIds = new Map<string, number>();
  const minArea = U(1) * U(1) * 4;
  for (const f of layers.get('building')?.features ?? []) {
    if (f.type !== 3 || truthy(f.props.hide_3d)) continue;
    let outer: number[] | null = null;
    let holes: number[][] = [];
    const flush = () => {
      if (!outer) return;
      const clipped = clipRing(outer, extent);
      const area = clipped.length ? ringArea(clipped) : 0;
      if (Math.abs(area) >= minArea) {
        let cx = 0, cy = 0;
        for (let i = 0; i < clipped.length; i += 2) {
          cx += clipped[i];
          cy += clipped[i + 1];
        }
        cx /= clipped.length / 2;
        cy /= clipped.length / 2;
        const coords = toLonLat([...clipped, clipped[0], clipped[1]]);
        const hs: number[][] = [];
        for (const h of holes) {
          const ch = clipRing(h, extent);
          if (ch.length && Math.abs(ringArea(ch)) >= minArea) hs.push(toLonLat([...ch, ch[0], ch[1]]));
        }
        let id = `h${x}.${y}.${Math.round(cx / 2)}.${Math.round(cy / 2)}`;
        const seen = houseIds.get(id) ?? 0;
        houseIds.set(id, seen + 1);
        if (seen) id += `.${seen}`;
        const b: Building = { id, coords, bbox: bboxOfCoords(coords) };
        if (hs.length) b.holes = hs;
        houses.push(b);
      }
      outer = null;
      holes = [];
    };
    for (const part of f.parts) {
      // Rings come closed from the decoder; drop the closing point.
      const ring = part.slice(0, part.length - 2);
      if (ring.length < 6) continue;
      if (ringArea(ring) > 0) {
        flush();
        outer = ring;
      } else if (outer) {
        holes.push(ring);
      }
    }
    flush();
  }

  // ---- 7. Landmarks ----
  const places: Place[] = [];
  const placeIds = new Set<string>();
  const poi = layers.get('poi');
  const pext = poi?.extent ?? extent;
  for (const f of poi?.features ?? []) {
    if (f.type !== 1 || !isLandmark(f.props)) continue;
    // The label name the map style uses.
    const name = text(f.props['name:latin']) || text(f.props.name);
    if (!name) continue;
    const cls = String(f.props.class);
    const r = Number(f.props.rank);
    const rank = Number.isFinite(r) ? r : 999;
    // One part per point: a multipoint is several landmarks of the same name.
    for (const [u, v] of f.parts) {
      // The buffer repeats the neighbours' points; the edge itself goes with the tile east or south.
      if (!(u >= 0 && u < pext && v >= 0 && v < pext)) continue;
      const lon = lonOf(u, pext), lat = latOf(v, pext);
      // From what it is and where (to about a metre), so no tile or map build changes it.
      const id = `p:${cls}:${name}:${Math.round(lon * 1e5)}:${Math.round(lat * 1e5)}`;
      if (placeIds.has(id)) continue;
      placeIds.add(id);
      places.push({ id, name, cls, rank, lon, lat, bbox: [lon, lat, lon, lat] });
    }
  }

  return { ways, houses, places };
}

function orient(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

/** True when two segments properly cross. */
function segCross(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number,
): boolean {
  const o1 = orient(ax, ay, bx, by, cx, cy), o2 = orient(ax, ay, bx, by, dx, dy);
  const o3 = orient(cx, cy, dx, dy, ax, ay), o4 = orient(cx, cy, dx, dy, bx, by);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

/** Parameters (t on ab, u on cd) where two segments properly cross, or null. */
function segIntersect(
  ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number,
): [number, number] | null {
  if (!segCross(ax, ay, bx, by, cx, cy, dx, dy)) return null;
  const rx = bx - ax, ry = by - ay, sx = dx - cx, sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (den === 0) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  return [t, u];
}
