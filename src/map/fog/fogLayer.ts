import earcut from 'earcut';
import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap, MapSourceDataEvent } from 'maplibre-gl';
import { CONFIG } from '../../config';
import { distanceM, polylineLengthM, projectOnPolylineM } from '../../geo/geo';
import { pencilKey, pencilOf, type Theme } from '../../theme';
import { EARTH_CIRCUMFERENCE_M, GrowBuffer, hex3, invert, localMatrix, program, type Program } from '../gl';
import { KC } from '../ink';
import {
  HOUSE_FLOATS, LONG_AGO, RIB_FLOATS, SEG_FLOATS, localX, localY, makeOrigin, miter, pushHouse, pushPiece, rng,
  sample, sweepTime, type Mesh, type Origin, type Sweep,
} from './geometry';
import { MaskMemo, type MaskInputs } from './maskMemo';
import * as S from './shaders';

/** A walked street piece, as the crayon needs it: its line, its class, and what picks its crayon. */
export interface FogPiece {
  coords: ArrayLike<number>;
  kind: 'road' | 'path' | 'side';
  hw: string;
  name: string | null;
  way: string | number;
}

interface PieceRec {
  coords: ArrayLike<number>;
  width: number;
  sweep: Sweep | null;
  offsetM: number;
  tone: number;
}

interface HouseRec {
  house: { id: string; coords: ArrayLike<number>; holes?: ArrayLike<number>[] };
  tOn: number;
  tone: number;
}

/** The walk in progress, sampled: where his trail and the canal's zigzag go on from. */
interface Run {
  /** Where the last step ended (local units). */
  x: number;
  y: number;
  /** Carry into the next step: of the trail, and of the canal (local units). */
  tc: number;
  wc: number;
  /**
   * Zigzag turns so far; the ones not drawn yet (from the last drawn on), as the design draws
   * three strokes at a time; and the way the walk heads, smoothed over GPS noise.
   */
  k: number;
  zig: number[];
  hx: number;
  hy: number;
  /** The trail's last two samples (its last one waits for the next, for its miter). */
  px: number;
  py: number;
  qx: number;
  qy: number;
  qTone: number;
  /** Has the trail of this run any vertices yet? */
  started: boolean;
}

/** Rebase the local origin once the walk is this far from it (float32 stays mm-exact well past it). */
const REBASE_M = 200_000;
/** The paper's tooth: one texel a device pixel, tiled. */
const TOOTH_SIZE = 256;
/** Floats of a zigzag instance. */
const ZIG_FLOATS = 8;
/** A step this close to a street lit on it (m) is where its color starts from. */
const ON_STREET_M = 25;
/** The design's water crayon. */
const WATER = '#55c4f0';

/** Seconds on the page clock the shaders animate with. */
export const pageTime = () => performance.now() / 1000;

const mesh = (): { v: GrowBuffer<Float32Array>; i: GrowBuffer<Uint32Array> } => ({
  v: new GrowBuffer((n) => new Float32Array(n), 4096),
  i: new GrowBuffer((n) => new Uint32Array(n), 4096),
});
type GpuMesh = ReturnType<typeof mesh>;

/** Append a mesh built on the CPU, its indices offset by the vertices already there. */
function append(m: GpuMesh, add: Mesh, stride: number): void {
  const base = m.v.length / stride;
  m.v.push(add.v);
  m.i.push(base ? add.i.map((i) => i + base) : add.i);
}

/**
 * The crayon walking leaves on the coloring page (ADR 0014), drawn on the GPU as one MapLibre
 * custom layer right above the basemap: the streets you walked colored in, each in its own crayon,
 * their houses hatched in, his trail, and the canal colored as he passes it, all as the design
 * draws them (see shaders.ts). The page itself prints in full ink everywhere.
 */
export class FogLayer implements CustomLayerInterface {
  readonly id = 'wl-fog';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private map: MlMap | null = null;
  private origin: Origin | null = null;
  /** Local units a unit of the design: its scale is KC CSS px a unit at the walk zoom. */
  private readonly u = (KC * EARTH_CIRCUMFERENCE_M) / (512 * 2 ** CONFIG.walkZoom);
  private pieces: PieceRec[] = [];
  private houses: HouseRec[] = [];
  /** The walk in progress: [aLon, aLat, bLon, bLat, crayon, ...]. */
  private steps: number[] = [];
  /** Water polygons seen so far, as lon/lat rings, by feature. */
  private water = new Map<string, number[][]>();
  private waterDirty = true;
  private nextWaterScan = 0;

  private segs = new GrowBuffer((n) => new Float32Array(n), SEG_FLOATS * 4096);
  private fill = mesh();
  private ribs = mesh();
  private trail = mesh();
  /** The canal's zigzag, three strokes (four turns, local units) an instance. */
  private canal = new GrowBuffer((n) => new Float32Array(n), ZIG_FLOATS * 2048);
  private lakes = mesh();
  private run: Run | null = null;
  private trailRng = rng(24);
  private canalRng = rng(23);
  /** Your pace (m/s on the page clock), from your steps, and when the last one came. */
  private mps = 1.4;
  private stepT = 0;
  /** With reduced motion, the crayon colors everything in place, at once. */
  private reduced = matchMedia('(prefers-reduced-motion: reduce)');

  /** Until when something colors in fast (the frame loop draws every frame), and at all. */
  private fastUntil = 0;
  private paintUntil = 0;
  /** Bumped by every change of what goes into the paint, so a frame that changes nothing skips it. */
  private version = 0;
  private memo = new MaskMemo();
  private still: MaskInputs = { version: 0, t: 0, animUntil: 0, mvp: [], ws: 0, w: 0, h: 0, probeX: 0, probeY: 0 };
  private broken = false;

  // GL state, created lazily inside prerender (MapLibre resets its state cache right after).
  private gl: WebGL2RenderingContext | null = null;
  private progs: Record<'street' | 'house' | 'ribbon' | 'zigzag' | 'water' | 'pencil', Program> | null = null;
  private vao: Record<'street' | 'house' | 'ribs' | 'trail' | 'zigzag' | 'water' | 'tri', WebGLVertexArrayObject> | null = null;
  private toothTex: WebGLTexture | null = null;
  /** The canvas' size, so the scribble stays crisp: what the crayons absorb, RGB, and how covered, A. */
  private paintTex: WebGLTexture | null = null;
  private paintFbo: WebGLFramebuffer | null = null;
  private stencil: WebGLRenderbuffer | null = null;
  private paintW = 0;
  private paintH = 0;

  /** `masks`: frames that painted the crayon; `kept`: frames that kept it, as nothing had changed. */
  readonly stats = { segments: 0, houses: 0, frames: 0, masks: 0, kept: 0 };
  /** The crayons for the u_crayons array: the box's lay colors, their press colors, the water. */
  private crayons: Float32Array;

  constructor(private theme: Theme) {
    const box = theme.pencils;
    this.crayons = new Float32Array([...box.flatMap((p) => hex3(p.lay)), ...box.flatMap((p) => hex3(p.press)), ...hex3(WATER)]);
  }

  // ---- Data ----

  /**
   * A walked street piece, in its crayon, `offsetM` along its block; with a sweep (`sweep()`) it
   * colors in as you walk it, without one it is there at once.
   */
  addPiece(piece: FogPiece, sweep: Sweep | null = null, offsetM = 0): void {
    const { coords } = piece;
    if (coords.length < 4) return;
    if (this.reduced.matches) sweep = null;
    const pen = this.theme.pencil;
    const rec: PieceRec = {
      coords, sweep, offsetM, tone: pencilOf(pencilKey(piece), this.theme.pencils.length),
      width: piece.kind === 'road' ? (pen.width[piece.hw] ?? pen.road) : pen.path,
    };
    this.pieces.push(rec);
    if (!this.origin) this.setOrigin(coords[0], coords[1]);
    this.pushPiece(rec);
    if (sweep) {
      const len = polylineLengthM(coords);
      const far = Math.abs(offsetM - sweep.fromM) > Math.abs(offsetM + len - sweep.fromM) ? offsetM : offsetM + len;
      this.paintUntil = Math.max(this.paintUntil, sweepTime(sweep, far, this.catchMps) + 0.1);
      // Up to you it is fast; then it goes at your pace.
      this.fastUntil = Math.max(this.fastUntil, Math.min(sweepTime(sweep, far, this.catchMps), sweep.t0 + sweep.headM / this.catchMps) + 0.1);
    }
    this.changed();
  }

  /**
   * A walked house; it hatches in from page time `tOn` (at once for houses walked long ago). Some
   * take the crayon of `street`, the pencilKey of the street that colored it in, and the rest one
   * of their own, as a child colors a page.
   */
  addHouse(house: HouseRec['house'], tOn: number, street?: string): void {
    if (this.reduced.matches) tOn = LONG_AGO;
    const n = this.theme.pencils.length;
    const match = street !== undefined && pencilOf(`match ${house.id}`, 100) < this.theme.pencil.houseMatch * 100;
    const rec: HouseRec = { house, tOn, tone: pencilOf(match ? street : `house ${house.id}`, n) };
    this.houses.push(rec);
    if (!this.origin) this.setOrigin(house.coords[0], house.coords[1]);
    this.pushHouse(rec);
    this.fastUntil = Math.max(this.fastUntil, tOn + 0.35);
    this.paintUntil = Math.max(this.paintUntil, tOn + 0.35);
    this.changed();
  }

  /**
   * How a street lit now colors in (`line`: its block's, or its own): from the end you walked in
   * from on your last step (the last of `steps`, the walk's [aLon, aLat, bLon, bLat, radius, ...]),
   * up to you and on at your pace. Null when that step is not on it: it is there at once.
   */
  sweep(line: ArrayLike<number>, steps: ArrayLike<number>): Sweep | null {
    const n = steps.length;
    if (n < 5) return null;
    const a = projectOnPolylineM(steps[n - 5], steps[n - 4], line);
    const b = projectOnPolylineM(steps[n - 3], steps[n - 2], line);
    if (b.distM > ON_STREET_M) return null;
    const fromM = b.alongM >= a.alongM ? 0 : polylineLengthM(line);
    return { fromM, headM: Math.abs(b.alongM - fromM), mps: this.mps, t0: pageTime() };
  }

  /** Page time a sweep colors in up to the spot (lon, lat) beside its `line`: now, without one. */
  reach(sweep: Sweep | null, line: ArrayLike<number>, lon: number, lat: number): number {
    return sweep ? sweepTime(sweep, projectOnPolylineM(lon, lat, line).alongM, this.catchMps) : pageTime();
  }

  /**
   * A step of the walk in progress, from a to b, on the street with crayon `tone`: his trail goes
   * on in its press color, and the canal beside him colors in. Steps replayed at once (a reload
   * mid-walk) leave his pace as it was.
   */
  walkTo(aLon: number, aLat: number, bLon: number, bLat: number, tone: number): void {
    const t = pageTime(), dt = t - this.stepT;
    const mps = Math.min(40, Math.max(0.3, distanceM(aLon, aLat, bLon, bLat) / dt));
    if (dt > 0.05 && dt < 10) this.mps = this.stepT ? this.mps * 0.6 + mps * 0.4 : mps;
    this.stepT = t;
    this.steps.push(aLon, aLat, bLon, bLat, tone);
    const o = this.origin;
    if (!o || distanceM(o.lon, o.lat, bLon, bLat) > REBASE_M) this.setOrigin(bLon, bLat);
    else this.pushStep(this.steps.length - 5);
    this.changed();
  }

  /** A new walk: the last one's trail goes. */
  clearWalk(): void {
    this.steps = [];
    this.trail.v.clear();
    this.trail.i.clear();
    this.canal.clear();
    this.run = null;
    this.trailRng = rng(24);
    this.canalRng = rng(23);
    this.stepT = 0;
    this.changed();
  }

  /** The walk is over: whatever still colors in is there at once. */
  finish(): void {
    for (const p of this.pieces) p.sweep = null;
    for (const h of this.houses) h.tOn = LONG_AGO;
    this.fastUntil = this.paintUntil = 0;
    if (this.origin) this.setOrigin(this.origin.lon, this.origin.lat);
    this.changed();
  }

  /** Is a street or a house coloring in fast? */
  animating(now = pageTime()): boolean {
    return now < this.fastUntil;
  }

  private get catchMps(): number {
    return this.theme.fog.sweepMps;
  }

  private changed(): void {
    this.version++;
    this.map?.triggerRepaint();
  }

  private pushPiece(r: PieceRec): void {
    const tmp: number[] = [];
    pushPiece(tmp, this.origin!, r.coords, r.width, r.sweep, r.offsetM, r.tone);
    this.segs.push(tmp);
    this.stats.segments = this.segs.length / SEG_FLOATS;
  }

  private pushHouse(r: HouseRec): void {
    const fill: Mesh = { v: [], i: [] }, rib: Mesh = { v: [], i: [] };
    if (!pushHouse(fill, rib, this.origin!, this.u, r.house, r.tOn, r.tone)) return;
    append(this.fill, fill, HOUSE_FLOATS);
    append(this.ribs, rib, RIB_FLOATS);
    this.stats.houses++;
  }

  /** Step i of the walk: his trail every 1.3 units with a slight wobble, the canal's zigzag every 1.05. */
  private pushStep(i: number): void {
    const o = this.origin!, s = this.steps, u = this.u;
    const ax = localX(o, s[i]), ay = localY(o, s[i + 1]), bx = localX(o, s[i + 2]), by = localY(o, s[i + 3]);
    const tone = this.theme.pencils.length + s[i + 4];
    let r = this.run;
    if (!r || Math.hypot(ax - r.x, ay - r.y) > 0.01) {
      r = this.run = { x: ax, y: ay, tc: 0, wc: 0, k: 0, zig: [], hx: 0, hy: 0, px: NaN, py: NaN, qx: NaN, qy: NaN, qTone: 0, started: false };
    }
    const run = r;
    const add: Mesh = { v: [], i: [] };
    run.tc = sample(ax, ay, bx, by, 1.3 * u, run.tc, (x, y, ux, uy) => {
      const w = (this.trailRng() - 0.5) * 0.3 * u;
      this.trailPoint(run, add, x - uy * w, y + ux * w, tone);
    });
    this.trail.v.push(add.v);
    this.trail.i.push(add.i);
    // The zigzag swings across the way he heads over the last ten units or so: across each noisy
    // GPS step, its 21-unit swings would fan out.
    const keep = Math.exp(-Math.hypot(bx - ax, by - ay) / (10 * u));
    run.hx = run.hx * keep + (bx - ax);
    run.hy = run.hy * keep + (by - ay);
    const hl = Math.hypot(run.hx, run.hy) || 1, hx = run.hx / hl, hy = run.hy / hl;
    const zz: number[] = [];
    run.wc = sample(ax, ay, bx, by, 1.05 * u, run.wc, (x, y) => {
      const off = (run.k++ & 1 ? 1 : -1) * (21 + (this.canalRng() - 0.5) * 6) * u;
      run.zig.push(x - hy * off, y + hx * off);
      if (run.zig.length < ZIG_FLOATS) return;
      zz.push(...run.zig);
      run.zig = run.zig.slice(-2);
    });
    if (zz.length) this.canal.push(zz);
    run.x = bx;
    run.y = by;
  }

  /** A sample of the trail: the one before it can now be mitred and drawn up to. */
  private trailPoint(r: Run, add: Mesh, x: number, y: number, tone: number): void {
    if (!Number.isNaN(r.qx)) {
      const [mx, my] = miter(r.px, r.py, r.qx, r.qy, x, y);
      const at = (this.trail.v.length + add.v.length) / RIB_FLOATS;
      for (const side of [-1, 1]) add.v.push(r.qx, r.qy, mx, my, side, 0.4, 0.85, LONG_AGO, r.qTone);
      if (r.started) add.i.push(at - 2, at - 1, at, at - 1, at + 1, at);
      r.started = true;
    }
    r.px = r.qx;
    r.py = r.qy;
    r.qx = x;
    r.qy = y;
    r.qTone = tone;
  }

  private setOrigin(lon: number, lat: number): void {
    this.origin = makeOrigin(lon, lat);
    this.segs.clear();
    for (const m of [this.fill, this.ribs, this.trail, this.lakes]) {
      m.v.clear();
      m.i.clear();
    }
    this.canal.clear();
    this.stats.houses = 0;
    for (const p of this.pieces) this.pushPiece(p);
    for (const h of this.houses) this.pushHouse(h);
    this.run = null;
    this.trailRng = rng(24);
    this.canalRng = rng(23);
    for (let i = 0; i < this.steps.length; i += 5) this.pushStep(i);
    for (const rings of this.water.values()) this.pushWater(rings);
    this.version++;
  }

  /** Water from the map's own tiles (OpenMapTiles' water layer), for the canal's crayon to stay in. */
  private scanWater(): void {
    const map = this.map!;
    let added = false;
    for (const f of map.querySourceFeatures('omt', { sourceLayer: 'water' })) {
      // Tiles of the full detail only (lower ones are coarser), and no water in tunnels.
      if (f._z < 14 || f.properties.brunnel === 'tunnel') continue;
      const g = f.geometry;
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
      for (const p of polys) {
        const rings = p.map((ring) => ring.flat());
        const key = `${f.id}:${rings[0].slice(0, 2)}:${rings[0].length}`;
        if (this.water.has(key)) continue;
        this.water.set(key, rings);
        this.pushWater(rings);
        added = true;
      }
    }
    if (added) this.version++;
  }

  private pushWater(rings: number[][]): void {
    const o = this.origin!, flat: number[] = [], holes: number[] = [];
    for (const r of rings) {
      if (flat.length) holes.push(flat.length / 2);
      for (let k = 0; k + 1 < r.length; k += 2) flat.push(localX(o, r[k]), localY(o, r[k + 1]));
    }
    append(this.lakes, { v: flat, i: earcut(flat, holes.length ? holes : undefined, 2) }, 2);
  }

  // ---- MapLibre hooks ----

  onAdd(map: MlMap): void {
    this.map = map;
    map.getCanvas().addEventListener('webglcontextlost', this.onLost);
    map.on('sourcedata', this.onSource);
  }

  onRemove(map: MlMap): void {
    map.getCanvas().removeEventListener('webglcontextlost', this.onLost);
    map.off('sourcedata', this.onSource);
    this.map = null;
    this.release();
  }

  /** New tiles may bring water. */
  private onSource = (e: MapSourceDataEvent) => {
    if (e.sourceId === 'omt' && e.tile) this.waterDirty = true;
  };

  /** After a lost context every GL object is gone; rebuild them on the next frame. */
  private onLost = () => this.release();

  private release(): void {
    this.gl = null;
    this.progs = null;
    this.vao = null;
    this.toothTex = this.paintTex = this.paintFbo = this.stencil = null;
    this.paintW = this.paintH = 0;
    this.memo.forget();
    this.segs.lose();
    this.canal.lose();
    for (const m of [this.fill, this.ribs, this.trail, this.lakes]) {
      m.v.lose();
      m.i.lose();
    }
  }

  private ensure(gl: WebGL2RenderingContext): boolean {
    if (this.broken || gl.isContextLost()) return false;
    if (this.gl === gl && this.progs) return true;
    try {
      this.init(gl);
      return true;
    } catch (e) {
      // Without the crayon the map still works: say why once, then keep out of the way.
      console.error('Mr Sparkles: crayon disabled', e);
      this.broken = true;
      return false;
    }
  }

  private init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    const n = this.theme.pencils.length;
    this.progs = {
      street: program(gl, S.STREET_VS, S.STREET_FS(n), ['a_corner', 'i_ab', 'i_along', 'i_sweep', 'i_wt']),
      house: program(gl, S.HOUSE_VS, S.HOUSE_FS(n), ['a_pos', 'a_hatch', 'a_house']),
      ribbon: program(gl, S.RIBBON_VS, S.RIBBON_FS(n), ['a_pos', 'a_miter', 'a_rib', 'a_crayon']),
      zigzag: program(gl, S.ZIGZAG_VS, S.ZIGZAG_FS, ['a_corner', 'i_a', 'i_b']),
      water: program(gl, S.WATER_VS, S.WATER_FS, ['a_pos']),
      pencil: program(gl, S.COMP_VS, S.PENCIL_FS, ['a_corner']),
    };
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    /** A VAO over `buf`: attributes [location, size, offset in floats], per instance with a quad, else indexed. */
    const vao = (buf: GrowBuffer<Float32Array>, stride: number, attrs: number[][], idx?: GrowBuffer<Uint32Array>) => {
      const v = gl.createVertexArray()!;
      gl.bindVertexArray(v);
      if (!idx) {
        gl.bindBuffer(gl.ARRAY_BUFFER, quad);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      }
      buf.sync(gl, gl.ARRAY_BUFFER);
      for (const [loc, size, off] of attrs) {
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, size, gl.FLOAT, false, stride * 4, off * 4);
        if (!idx) gl.vertexAttribDivisor(loc, 1);
      }
      idx?.sync(gl, gl.ELEMENT_ARRAY_BUFFER);
      return v;
    };
    const rib = [[0, 2, 0], [1, 2, 2], [2, 4, 4], [3, 1, 8]];
    const fullTri = gl.createVertexArray()!;
    gl.bindVertexArray(fullTri);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = {
      street: vao(this.segs, SEG_FLOATS, [[1, 4, 0], [2, 2, 4], [3, 4, 6], [4, 2, 10]]),
      house: vao(this.fill.v, HOUSE_FLOATS, [[0, 2, 0], [1, 2, 2], [2, 3, 4]], this.fill.i),
      ribs: vao(this.ribs.v, RIB_FLOATS, rib, this.ribs.i),
      trail: vao(this.trail.v, RIB_FLOATS, rib, this.trail.i),
      zigzag: vao(this.canal, ZIG_FLOATS, [[1, 4, 0], [2, 4, 4]]),
      water: vao(this.lakes.v, 2, [[0, 2, 0]], this.lakes.i),
      tri: fullTri,
    };
    gl.bindVertexArray(null);
    this.toothTex = repeating(gl, TOOTH_SIZE, makeTooth(TOOTH_SIZE));
    this.version++;
  }

  private resize(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, gl.drawingBufferWidth), h = Math.max(1, gl.drawingBufferHeight);
    if (w === this.paintW && h === this.paintH && this.paintTex) return;
    if (this.paintTex) gl.deleteTexture(this.paintTex);
    if (this.paintFbo) gl.deleteFramebuffer(this.paintFbo);
    if (this.stencil) gl.deleteRenderbuffer(this.stencil);
    [this.paintTex, this.paintFbo] = target(gl, w, h);
    // The water, for the canal's crayon to stay inside.
    this.stencil = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, this.stencil);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, this.stencil);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    this.paintW = w;
    this.paintH = h;
    this.version++;
  }

  /** Frame constants shared by both passes. */
  private frame(opts: CustomRenderMethodInput) {
    const map = this.map!;
    const zoom = map.getZoom();
    const ws = 512 * 2 ** zoom;
    const o = this.origin!;
    const m64 = localMatrix(opts.modelViewProjectionMatrix, ws, o.ox, o.oy);
    // Local units per device pixel.
    const px = EARTH_CIRCUMFERENCE_M / ws / map.getPixelRatio();
    return { zoom, o, m64, matrix: new Float32Array(m64), px };
  }

  /** Anything to draw? */
  private get empty(): boolean {
    return !this.origin || (!this.segs.length && !this.fill.i.length && !this.trail.i.length && !this.canal.length);
  }

  prerender(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput): void {
    if (!this.map || this.empty || !this.ensure(gl)) return;
    this.resize(gl);
    const t = pageTime();
    if (this.waterDirty && this.canal.length && t >= this.nextWaterScan) {
      this.waterDirty = false;
      this.nextWaterScan = t + 1;
      this.scanWater();
    }
    // Standing still, the paint would come out as it is: keep it (and the battery).
    const still = this.stillInputs(opts, t);
    if (this.memo.same(still)) {
      this.stats.kept++;
      return;
    }
    this.stats.masks++;
    const p = this.progs!, vao = this.vao!;
    const f = this.frame(opts);
    const u = this.u, um = u / f.o.m2u;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.paintFbo);
    gl.viewport(0, 0, this.paintW, this.paintH);
    gl.clearColor(0, 0, 0, 0);
    gl.clearStencil(0);
    gl.stencilMask(0xff);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    // Crayon over crayon multiplies (screen blending of what they absorb).
    const multiply = () => {
      gl.blendEquation(gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_COLOR, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    };
    multiply();

    // The canal: the water into the stencil (off register, as the design's), the zigzag inside it,
    // its strokes darker where they cross.
    const nZig = this.canal.length / ZIG_FLOATS, nLake = this.lakes.i.length;
    if (nZig && nLake) {
      gl.enable(gl.STENCIL_TEST);
      gl.stencilFunc(gl.ALWAYS, 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.REPLACE);
      gl.colorMask(false, false, false, false);
      gl.useProgram(p.water.p);
      gl.bindVertexArray(vao.water);
      this.lakes.v.sync(gl, gl.ARRAY_BUFFER);
      this.lakes.i.sync(gl, gl.ELEMENT_ARRAY_BUFFER);
      gl.uniformMatrix4fv(p.water.u.u_matrix, false, f.matrix);
      gl.uniform2f(p.water.u.u_shift, 0.6 * u, 0.45 * u);
      gl.drawElements(gl.TRIANGLES, nLake, gl.UNSIGNED_INT, 0);
      gl.colorMask(true, true, true, true);
      gl.stencilFunc(gl.EQUAL, 1, 0xff);
      gl.stencilOp(gl.KEEP, gl.KEEP, gl.KEEP);
      gl.useProgram(p.zigzag.p);
      gl.bindVertexArray(vao.zigzag);
      this.canal.sync(gl, gl.ARRAY_BUFFER);
      gl.uniformMatrix4fv(p.zigzag.u.u_matrix, false, f.matrix);
      gl.uniform1f(p.zigzag.u.u_hw, 0.625 * u);
      gl.uniform1f(p.zigzag.u.u_aa, f.px);
      gl.uniform3fv(p.zigzag.u.u_absorb, this.crayons.subarray(-3).map((c) => 1 - c));
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nZig);
      gl.disable(gl.STENCIL_TEST);
    }

    const nSeg = this.segs.length / SEG_FLOATS;
    if (nSeg) {
      // A street must not color itself twice where its segments meet: the darker of two wins.
      gl.blendEquation(gl.MAX);
      gl.blendFunc(gl.ONE, gl.ONE);
      const su = p.street.u;
      gl.useProgram(p.street.p);
      gl.bindVertexArray(vao.street);
      this.segs.sync(gl, gl.ARRAY_BUFFER);
      gl.uniformMatrix4fv(su.u_matrix, false, f.matrix);
      gl.uniform1f(su.u_m2u, f.o.m2u);
      gl.uniform1f(su.u_um, um);
      gl.uniform1f(su.u_aa, f.px / f.o.m2u);
      gl.uniform1f(su.u_time, t);
      gl.uniform1f(su.u_catch, this.catchMps);
      // The design colors a point or two past his tip.
      gl.uniform1f(su.u_lead, 1.7 * um);
      gl.uniform3fv(su.u_crayons, this.crayons);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nSeg);
    }

    multiply();
    const nFill = this.fill.i.length;
    if (nFill) {
      const hu = p.house.u;
      gl.useProgram(p.house.p);
      gl.bindVertexArray(vao.house);
      this.fill.v.sync(gl, gl.ARRAY_BUFFER);
      this.fill.i.sync(gl, gl.ELEMENT_ARRAY_BUFFER);
      gl.uniformMatrix4fv(hu.u_matrix, false, f.matrix);
      gl.uniform1f(hu.u_time, t);
      gl.uniform1f(hu.u_aa, f.px / u);
      gl.uniform3fv(hu.u_crayons, this.crayons);
      gl.drawElements(gl.TRIANGLES, nFill, gl.UNSIGNED_INT, 0);
    }
    const ru = p.ribbon.u;
    gl.useProgram(p.ribbon.p);
    gl.uniformMatrix4fv(ru.u_matrix, false, f.matrix);
    gl.uniform1f(ru.u_unit, u);
    gl.uniform1f(ru.u_aa, f.px);
    gl.uniform1f(ru.u_time, t);
    gl.uniform3fv(ru.u_crayons, this.crayons);
    for (const [m, v, grow] of [
      [this.ribs, vao.ribs, 1],
      // His trail, drawn wider on a page of the whole walk, as the design's summary.
      [this.trail, vao.trail, f.zoom < CONFIG.walkZoom - 1 ? 1.7 : 1],
    ] as const) {
      if (!m.i.length) continue;
      gl.bindVertexArray(v);
      m.v.sync(gl, gl.ARRAY_BUFFER);
      m.i.sync(gl, gl.ELEMENT_ARRAY_BUFFER);
      gl.uniform1f(ru.u_grow, grow);
      gl.drawElements(gl.TRIANGLES, m.i.length, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.memo.drawn(still);
  }

  /** What the paint would be drawn from this frame, without allocating. */
  private stillInputs(opts: CustomRenderMethodInput, t: number): MaskInputs {
    const s = this.still, map = this.map!;
    const ws = 512 * 2 ** map.getZoom();
    const c = map.getCenter();
    s.version = this.version;
    s.t = t;
    s.animUntil = this.paintUntil;
    s.mvp = opts.modelViewProjectionMatrix;
    s.ws = ws;
    s.w = this.paintW;
    s.h = this.paintH;
    s.probeX = ((c.lng + 180) / 360) * ws;
    s.probeY = mercYOf(c.lat) * ws;
    return s;
  }

  render(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput): void {
    if (!this.map || this.empty || !this.progs || this.gl !== gl || !this.paintTex || gl.isContextLost()) return;
    const f = this.frame(opts);
    const inv = invert(f.m64);
    if (!inv) return;
    const u = this.progs.pencil.u;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    // The crayon, multiplied over the paper and the ink: lines stay black under it.
    gl.useProgram(this.progs.pencil.p);
    gl.bindVertexArray(this.vao!.tri);
    gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.toothTex);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.paintTex);
    gl.uniform1i(u.u_paint, 0);
    gl.uniform1i(u.u_tooth, 1);
    gl.uniformMatrix4fv(u.u_inv, false, new Float32Array(inv));
    gl.uniform1f(u.u_ndcZ, f.m64[14] / f.m64[15]);
    gl.uniform1f(u.u_pxUnits, f.px);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.bindVertexArray(null);
    this.stats.frames++;
  }
}

/** A render target with linear filtering, bound. */
function target(gl: WebGL2RenderingContext, w: number, h: number): [WebGLTexture, WebGLFramebuffer] {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return [tex, fbo];
}

function mercYOf(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** A tiled R8 texture, one texel a pixel: no filtering. */
function repeating(gl: WebGL2RenderingContext, n: number, data: Uint8Array): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, n, n, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  return tex;
}

/**
 * The paper's tooth, as the coloring book design draws it: a seamless n×n mask, 1 where the wax
 * takes and 0 in the tiny pits it skips, so about a quarter of the paper shows through.
 */
export function makeTooth(n: number): Uint8Array {
  // xorshift32, seeded as the design's rng(7).
  const r = rng(7);
  const lattice = (p: number) => Float32Array.from({ length: p * p }, r);
  const l1 = lattice(64), l2 = lattice(128), l3 = lattice(32);
  // Value noise on a p×p lattice that wraps, so the tile does too.
  const at = (l: Float32Array, p: number, x: number, y: number) => {
    const fx = (x * p) / n, fy = (y * p) / n, ix = Math.floor(fx), iy = Math.floor(fy);
    const tx = fx - ix, ty = fy - iy, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const x0 = ix % p, y0 = iy % p, x1 = (x0 + 1) % p, y1 = (y0 + 1) % p;
    const a = l[y0 * p + x0] + (l[y0 * p + x1] - l[y0 * p + x0]) * sx;
    const b = l[y1 * p + x0] + (l[y1 * p + x1] - l[y1 * p + x0]) * sx;
    return a + (b - a) * sy;
  };
  const out = new Uint8Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const v = 0.5 * at(l1, 64, x, y) + 0.32 * at(l2, 128, x, y) + 0.18 * r();
      const wax = v > 0.64 ? 0 : v > 0.58 ? (0.64 - v) / 0.06 : 1;
      out[y * n + x] = Math.round(wax * (0.8 + 0.2 * at(l3, 32, x, y)) * 255);
    }
  }
  return out;
}
