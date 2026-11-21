import { EARTH_CIRCUMFERENCE_M } from '../map/gl';
import { chordDistance, type Sight } from './sight';

/**
 * The seen memory: how much of each spot your light has ever reached, as Web Mercator tiles of
 * one byte per texel (see the contract: z17, 256 texels, row 0 north). Painted on the CPU from
 * the sight polygon, so it is exact behind walls, and saved tile by tile.
 */
export const SEEN_Z = 17;
export const SEEN_TILE = 256;
/** Size of a texel, WM units (≈ 0.73 ground m at Amsterdam). */
export const SEEN_TEXEL = EARTH_CIRCUMFERENCE_M / 2 ** (SEEN_Z + 8);

export interface SeenTile {
  key: string;
  x: number;
  y: number;
  data: Uint8Array;
  version: number;
}

/** The light as you see: a disc around you and a cone ahead (WM units, radians, WM angle). */
export interface LightShape {
  /** Radius of the disc. */
  lantern: number;
  /** Reach of the cone. */
  cone: number;
  /** WM angle of the heading: atan2(-cos h, sin h). */
  dir: number;
  /** Half-angle at full strength (rad). */
  inner: number;
  /** Half-angle where it has faded out (rad). */
  outer: number;
  /** 0..1, cone visibility. */
  coneOn: number;
}

export const seenKey = (x: number, y: number): string => `${SEEN_Z}/${x}/${y}`;

const TILE_TEXELS = SEEN_TILE * SEEN_TILE;
const PI = Math.PI;
const TAU = 2 * PI;
/** Free distance by angle, sampled finely once per paint so a texel needs no search. */
const LUT_N = 4096;
const lut = new Float64Array(LUT_N + 1);
/** Tiles under the paint's box, row-major from (tx0, ty0); null until something is written. */
const slots: (SeenTile | null)[] = [];
/** Scratch box of the paint: minx, miny, maxx, maxy. */
const box = new Float64Array(4);

/** Grow `box` to hold the point at angle a, distance r from (x, y). */
function extend(x: number, y: number, a: number, r: number): void {
  const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
  if (px < box[0]) box[0] = px;
  if (py < box[1]) box[1] = py;
  if (px > box[2]) box[2] = px;
  if (py > box[3]) box[3] = py;
}
let slotHit = new Uint8Array(16);

/** Direction of every LUT angle. */
const lutX = new Float64Array(LUT_N + 1);
const lutY = new Float64Array(LUT_N + 1);
for (let k = 0; k <= LUT_N; k++) {
  lutX[k] = Math.cos(-PI + (k * TAU) / LUT_N);
  lutY[k] = Math.sin(-PI + (k * TAU) / LUT_N);
}

/** Fill `lut` with the sight's free distance at LUT_N even angles from -PI (one merge pass). */
function fillLut(s: Sight): void {
  const n = s.n, A = s.ang;
  if (n === 0) {
    lut.fill(s.radius);
    return;
  }
  let j = 0;
  for (let k = 0; k <= LUT_N; k++) {
    const a = -PI + (k * TAU) / LUT_N;
    while (j < n && A[j] < a) j++;
    lut[k] = chordDistance(s, j === 0 || j === n ? n - 1 : j - 1, j === n ? 0 : j, lutX[k], lutY[k]);
  }
}

export class SeenGrid {
  readonly tiles = new Map<string, SeenTile>();
  /** The same tiles by x * 2^SEEN_Z + y, so the painter looks them up without making strings. */
  private readonly byNum = new Map<number, SeenTile>();
  private readonly dirty = new Set<SeenTile>();

  private add(x: number, y: number, data: Uint8Array): SeenTile {
    const t: SeenTile = { key: seenKey(x, y), x, y, data, version: 1 };
    this.tiles.set(t.key, t);
    this.byNum.set(x * 2 ** SEEN_Z + y, t);
    return t;
  }

  /** Tiles from storage (they are not dirty). Keys that are not "17/x/y" are skipped. */
  load(tiles: Iterable<{ key: string; data: Uint8Array }>): void {
    for (const { key, data } of tiles) {
      const m = /^(\d+)\/(\d+)\/(\d+)$/.exec(key);
      if (!m || Number(m[1]) !== SEEN_Z || data.length !== TILE_TEXELS) continue;
      const x = Number(m[2]), y = Number(m[3]);
      const old = this.byNum.get(x * 2 ** SEEN_Z + y);
      if (old) {
        for (let i = 0; i < TILE_TEXELS; i++) if (data[i] > old.data[i]) old.data[i] = data[i];
        old.version++;
      } else this.add(x, y, new Uint8Array(data));
    }
  }

  /** Seen value 0..1 at a WM point (for tests and the summary). */
  at(x: number, y: number): number {
    const I = Math.floor(x / SEEN_TEXEL), J = Math.floor(y / SEEN_TEXEL);
    const t = this.byNum.get(Math.floor(I / SEEN_TILE) * 2 ** SEEN_Z + Math.floor(J / SEEN_TILE));
    return t ? t.data[(J & (SEEN_TILE - 1)) * SEEN_TILE + (I & (SEEN_TILE - 1))] / 255 : 0;
  }

  /** How many tiles changed since the last `takeDirty`. */
  get dirtyCount(): number {
    return this.dirty.size;
  }

  /** Tiles changed since the last call, for saving. */
  takeDirty(): SeenTile[] {
    const out = [...this.dirty];
    this.dirty.clear();
    return out;
  }

  /**
   * Paint what this sight lights, max-combined (light falloff like the prototype's drawLight):
   * the lantern disc (1 at you, 0.92 halfway, 0 at its edge) and the cone (0.9, 0.72 at 0.45 of
   * its reach, 0 at the end; full within `inner`, gone at `outer`, times `coneOn`), cut off
   * where the sight stops with a one-texel soft edge. Returns the tiles that changed.
   */
  paint(s: Sight, light: LightShape): SeenTile[] {
    const T = SEEN_TEXEL;
    const vx = s.x, vy = s.y;
    const L = light.lantern;
    const coneOn = light.coneOn > 0 && light.cone > 0 ? Math.min(1, light.coneOn) : 0;
    const Rc = coneOn > 0 ? light.cone : 0;
    const Rmax = Math.min(Math.max(L, Rc), s.radius);
    if (!(Rmax > 0)) return [];
    const dir = light.dir, cdx = Math.cos(dir), cdy = Math.sin(dir);
    const inner = Math.max(0, Math.min(light.inner, light.outer)), outer = light.outer;
    const cosIn = Math.cos(inner), cosOut = Math.cos(outer);
    const fade = outer > inner ? 1 / (outer - inner) : 0;
    const L2 = L * L, Rc2 = Rc * Rc, Rmax2 = Rmax * Rmax;
    const invL = L > 0 ? 1 / L : 0, invRc = Rc > 0 ? 1 / Rc : 0, invT = 1 / T;
    const lutScale = LUT_N / TAU;
    fillLut(s);

    // Box of the disc and of the cone's sector (its tip, both rims and any axis it spans).
    box[0] = vx - L;
    box[1] = vy - L;
    box[2] = vx + L;
    box[3] = vy + L;
    if (Rc > 0) {
      const lo = dir - outer, hi = dir + outer;
      extend(vx, vy, lo, Rc);
      extend(vx, vy, hi, Rc);
      for (let q = Math.ceil(lo / (PI / 2)); q * (PI / 2) <= hi; q++) extend(vx, vy, q * (PI / 2), Rc);
    }
    const x0 = Math.max(box[0], vx - Rmax), y0 = Math.max(box[1], vy - Rmax);
    const x1 = Math.min(box[2], vx + Rmax), y1 = Math.min(box[3], vy + Rmax);
    const I0 = Math.floor(x0 * invT), I1 = Math.floor(x1 * invT);
    const J0 = Math.floor(y0 * invT), J1 = Math.floor(y1 * invT);
    const tx0 = Math.floor(I0 / SEEN_TILE), tx1 = Math.floor(I1 / SEEN_TILE);
    const ty0 = Math.floor(J0 / SEEN_TILE), ty1 = Math.floor(J1 / SEEN_TILE);
    const tw = tx1 - tx0 + 1, nSlots = tw * (ty1 - ty0 + 1);
    if (slotHit.length < nSlots) slotHit = new Uint8Array(nSlots * 2);
    slotHit.fill(0, 0, nSlots);
    slots.length = nSlots;
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) slots[(ty - ty0) * tw + tx - tx0] = this.byNum.get(tx * 2 ** SEEN_Z + ty) ?? null;
    }

    for (let J = J0; J <= J1; J++) {
      const dy = (J + 0.5) * T - vy, dy2 = dy * dy;
      if (dy2 >= Rmax2) continue;
      // Only the texels of this row inside the outer circle.
      const hw = Math.sqrt(Rmax2 - dy2);
      const ia = Math.max(I0, Math.ceil((vx - hw) * invT - 0.5)), ib = Math.min(I1, Math.floor((vx + hw) * invT - 0.5));
      if (ia > ib) continue;
      const ty = Math.floor(J / SEEN_TILE), rowBase = (J - ty * SEEN_TILE) * SEEN_TILE;
      for (let tx = Math.floor(ia / SEEN_TILE); tx * SEEN_TILE <= ib; tx++) {
        const sl = (ty - ty0) * tw + tx - tx0;
        let tile = slots[sl];
        let data = tile ? tile.data : null;
        const left = tx * SEEN_TILE;
        const sa = Math.max(ia, left), sb = Math.min(ib, left + SEEN_TILE - 1);
        let dx = (sa + 0.5) * T - vx;
        for (let I = sa; I <= sb; I++, dx += T) {
          const r2 = dx * dx + dy2;
          if (r2 >= Rmax2) continue;
          const r = Math.sqrt(r2);
          let v = 0;
          if (r2 < L2) {
            const u = r * invL;
            v = u < 0.5 ? 1 - 0.16 * u : 1.84 * (1 - u);
          }
          if (r2 < Rc2) {
            const dot = dx * cdx + dy * cdy;
            if (dot > r * cosOut) {
              let a = 1;
              if (dot < r * cosIn) {
                const cr = dx * cdy - dy * cdx;
                a = (outer - Math.atan2(cr < 0 ? -cr : cr, dot)) * fade;
              }
              const w = r * invRc;
              const c = (w < 0.45 ? 0.9 - 0.4 * w : (1 - w) * (0.72 / 0.55)) * a * coneOn;
              if (c > v) v = c;
            }
          }
          const idx = rowBase + I - left;
          const old = data ? data[idx] : 0;
          // The cut below only lowers v: skip texels that cannot get brighter.
          if (v * 255 + 0.5 < old + 1) continue;
          const f = (Math.atan2(dy, dx) + PI) * lutScale;
          const k = f < LUT_N ? f | 0 : LUT_N - 1;
          const free = lut[k] + (lut[k + 1] - lut[k]) * (f - k);
          const edge = (free - r) * invT;
          if (edge <= 0) continue;
          if (edge < 1) v *= edge;
          const b = (v * 255 + 0.5) | 0;
          if (b <= old) continue;
          if (!data) {
            tile = this.byNum.get(tx * 2 ** SEEN_Z + ty) ?? this.add(tx, ty, new Uint8Array(TILE_TEXELS));
            slots[sl] = tile;
            data = tile.data;
          }
          data[idx] = b;
          slotHit[sl] = 1;
        }
      }
    }

    const changed: SeenTile[] = [];
    for (let sl = 0; sl < nSlots; sl++) {
      const t = slots[sl];
      if (!slotHit[sl] || !t) continue;
      t.version++;
      this.dirty.add(t);
      changed.push(t);
    }
    slots.fill(null, 0, nSlots);
    return changed;
  }
}
