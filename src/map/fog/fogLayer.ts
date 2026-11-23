import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import type { Occluders } from '../../core/occluders';
import type { SeenTile } from '../../core/seen';
import { polylineLengthM } from '../../geo/geo';
import { pencilKey, pencilOf, type Theme } from '../../theme';
import { EARTH_CIRCUMFERENCE_M, GrowBuffer, hex3, invert, localMatrix, program, type Program } from '../gl';
import {
  HOUSE_FLOATS, KIND_PATH, KIND_ROAD, SEG_FLOATS, houseSeed, makeOrigin, pushHouse, pushPiece,
  type Origin, type Sweep,
} from './geometry';
import { MaskMemo, type MaskInputs, type MaskLight } from './maskMemo';
import { MoonHouses, SeenTextures } from './seenLayer';
import { ShadowCaster } from './shadows';
import * as S from './shaders';

/** Where you are, for the lantern. */
export interface Lantern {
  /** Where the light comes from: you, stepped out of a house if GPS put you inside one. */
  lon: number;
  lat: number;
  /** Degrees clockwise from north. */
  heading: number | null;
  /** Visibility of the cone of sight, 0..1. */
  cone: number;
}

interface PieceRec {
  coords: ArrayLike<number>;
  kind: number;
  sweep: Sweep | null;
  tone: number;
}

/** A walked street piece, as the fog needs it: its line, its kind, and what picks its pencil. */
export interface FogPiece {
  coords: ArrayLike<number>;
  kind: 'road' | 'path' | 'side';
  name: string | null;
  way: string | number;
}

interface HouseRec {
  house: { id: string; coords: ArrayLike<number>; holes?: ArrayLike<number>[] };
  tOn: number;
  tone: number;
}

/** Rebase the local origin once the view is this far from it (float32 stays mm-exact well past it). */
const REBASE_M = 200_000;
const NOISE_SIZE = 128;
/** The paper's tooth: one texel a device pixel, tiled. */
const TOOTH_SIZE = 256;
/** Below this zoom the seen memory is not drawn (a tile would be a few pixels). */
const SEEN_MIN_ZOOM = 14;

/** Seconds on the page clock the shaders animate with. */
export const pageTime = () => performance.now() / 1000;

/**
 * The paper wash over the unwalked city and the colored pencil of the walked one (ADR 0014), drawn
 * on the GPU as one MapLibre custom layer right above the basemap. It owns everything walked: the
 * streets colored in from where you stood, each in its own pencil, your colored houses, and your
 * sight, which clears the wash around you and stops at walls. It also draws what you have seen:
 * the wash clears there for good, and seen houses print in ink over it. See shaders.ts for how it
 * looks.
 */
export class FogLayer implements CustomLayerInterface {
  readonly id = 'wl-fog';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;

  private map: MlMap | null = null;
  private origin: Origin | null = null;
  private pieces: PieceRec[] = [];
  private houses: HouseRec[] = [];
  private segs = new GrowBuffer((n) => new Float32Array(n), SEG_FLOATS * 4096);
  private hverts = new GrowBuffer((n) => new Float32Array(n), HOUSE_FLOATS * 4096);
  private hidx = new GrowBuffer((n) => new Uint32Array(n), 8192);
  private lantern: Lantern | null = null;
  private animUntil = 0;
  /** Until when the masks animate (an unlock wave, a house fading in); the rest is in `render`. */
  private maskUntil = 0;
  /** Bumped by every change of what goes into the masks, so a frame that changes nothing skips them. */
  private version = 0;
  private memo = new MaskMemo();
  private still: MaskInputs = {
    version: 0, t: 0, animUntil: 0, mvp: [], ws: 0, w: 0, h: 0, light: null, probeX: 0, probeY: 0,
  };
  private stillLight: MaskLight = { x: 0, y: 0, heading: null, cone: 0 };
  private broken = false;
  /** Walls around you, for the shadows of your light. */
  readonly shadows = new ShadowCaster();
  /** The seen memory, as textures; and the houses you have seen. */
  readonly seen = new SeenTextures();
  readonly moon = new MoonHouses();

  // GL state, created lazily inside prerender (MapLibre resets its state cache right after).
  private gl: WebGL2RenderingContext | null = null;
  private progs: Record<'seg' | 'houseMask' | 'lamp' | 'paintSeg' | 'paintHouse' | 'comp' | 'pencil', Program> | null = null;
  private vaoSeg: WebGLVertexArrayObject | null = null;
  private vaoHouse: WebGLVertexArrayObject | null = null;
  private vaoQuad: WebGLVertexArrayObject | null = null;
  private vaoTri: WebGLVertexArrayObject | null = null;
  private maskTex: WebGLTexture | null = null;
  private maskFbo: WebGLFramebuffer | null = null;
  private maskW = 0;
  private maskH = 0;
  /** Same size as the mask: the seen memory in view, R = 0..1. */
  private seenTex: WebGLTexture | null = null;
  /** The seen mask holds nothing (cleared, and nothing drawn since). */
  private seenClear = false;
  private seenFbo: WebGLFramebuffer | null = null;
  private noiseTex: WebGLTexture | null = null;
  private toothTex: WebGLTexture | null = null;
  /** The canvas' size, so the scribble stays crisp: what the pencils absorb, RGB, and how covered, A. */
  private paintTex: WebGLTexture | null = null;
  private paintFbo: WebGLFramebuffer | null = null;
  private paintW = 0;
  private paintH = 0;

  /** `masks`: frames that drew the masks; `kept`: frames that kept them, as nothing had changed. */
  readonly stats = { segments: 0, houses: 0, frames: 0, masks: 0, kept: 0 };
  private paper: [number, number, number];
  /** The pencils' lay colours, flat, for the u_pencils array. */
  private pencils: Float32Array;

  constructor(private theme: Theme) {
    this.paper = hex3(theme.fog.color);
    this.pencils = new Float32Array(theme.pencils.flatMap((p) => hex3(p.lay)));
  }

  // ---- Data ----

  /** A walked street piece, in its pencil; with a sweep it colors in from where you stood. */
  addPiece(piece: FogPiece, sweep: Sweep | null = null): void {
    const { coords } = piece;
    if (coords.length < 4) return;
    const rec: PieceRec = {
      coords, kind: piece.kind === 'road' ? KIND_ROAD : KIND_PATH, sweep, tone: pencilOf(pencilKey(piece), this.theme.pencils.length),
    };
    this.pieces.push(rec);
    if (!this.origin) this.setOrigin(coords[0], coords[1]);
    this.pushPiece(rec);
    if (sweep) {
      const end = sweep.offsetM + polylineLengthM(coords);
      const reach = Math.max(Math.abs(sweep.offsetM - sweep.fromM), Math.abs(end - sweep.fromM));
      const until = sweep.t0 + reach / this.theme.fog.sweepMps + 3;
      this.animUntil = Math.max(this.animUntil, until);
      this.maskUntil = Math.max(this.maskUntil, until);
    }
    this.version++;
    this.map?.triggerRepaint();
  }

  /**
   * A walked house; it colors in from page time `tOn` (at once for houses walked long ago). Some take
   * the pencil of `street`, the pencilKey of the street that colored it in, and the rest one of
   * their own, as a child colors a page.
   */
  addHouse(house: HouseRec['house'], tOn: number, street?: string): void {
    const n = this.theme.pencils.length;
    const match = street !== undefined && pencilOf(`match ${house.id}`, 100) < this.theme.pencil.houseMatch * 100;
    const rec: HouseRec = { house, tOn, tone: pencilOf(match ? street : `house ${house.id}`, n) };
    this.houses.push(rec);
    if (!this.origin) this.setOrigin(house.coords[0], house.coords[1]);
    this.pushHouse(rec);
    this.animUntil = Math.max(this.animUntil, tOn + 3);
    // Its footprint clears the wash and colors in over 0.4 s.
    this.maskUntil = Math.max(this.maskUntil, tOn + 0.7);
    this.version++;
    this.map?.triggerRepaint();
  }

  clear(): void {
    this.pieces = [];
    this.houses = [];
    this.segs.clear();
    this.hverts.clear();
    this.hidx.clear();
    this.stats.segments = this.stats.houses = 0;
    this.version++;
    this.map?.triggerRepaint();
  }

  /** The walls around you: your light stops at them. */
  setOccluders(occ: Occluders | null): void {
    this.shadows.setOccluders(occ);
    this.version++;
    this.map?.triggerRepaint();
  }

  /** A tile of the seen memory that is new or changed. */
  setSeenTile(tile: SeenTile): void {
    this.seen.set(tile);
    this.version++;
    this.map?.triggerRepaint();
  }

  /** A house you have just seen (or saw on an earlier walk: `tOn` long ago). */
  addSeenHouse(house: { id: string; coords: ArrayLike<number>; holes?: ArrayLike<number>[] }, tOn: number): void {
    this.moon.add(house, tOn);
    this.animUntil = Math.max(this.animUntil, tOn + 1.2);
    this.map?.triggerRepaint();
  }

  /** A seen house that has just been colored in: it is drawn as a walked house from now on. */
  removeSeenHouse(id: string): void {
    this.moon.remove(id);
  }

  setLantern(l: Lantern | null): void {
    this.lantern = l;
    if (l && this.origin) {
      const dx = (l.lon - this.origin.lon) * 111_320 * Math.cos((l.lat * Math.PI) / 180);
      const dy = (l.lat - this.origin.lat) * 110_540;
      if (Math.hypot(dx, dy) > REBASE_M) this.setOrigin(l.lon, l.lat);
    } else if (l && !this.origin) this.setOrigin(l.lon, l.lat);
  }

  /** Is a street or a house still coloring in? */
  animating(now = pageTime()): boolean {
    return now < this.animUntil;
  }

  private pushPiece(r: PieceRec): void {
    const tmp: number[] = [];
    pushPiece(tmp, this.origin!, r.coords, r.kind, r.sweep, r.tone);
    this.segs.push(tmp);
    this.stats.segments = this.segs.length / SEG_FLOATS;
  }

  private pushHouse(r: HouseRec): void {
    const v: number[] = [], idx: number[] = [], seg: number[] = [];
    // Indices are absolute: offset them by the vertices already stored.
    const base = this.hverts.length / HOUSE_FLOATS;
    if (!pushHouse(v, idx, seg, this.origin!, r.house, houseSeed(r.house.id), r.tOn, r.tone)) return;
    this.hverts.push(v);
    this.hidx.push(idx.map((i) => i + base));
    this.segs.push(seg);
    this.stats.houses++;
    this.stats.segments = this.segs.length / SEG_FLOATS;
  }

  private setOrigin(lon: number, lat: number): void {
    this.origin = makeOrigin(lon, lat);
    this.segs.clear();
    this.hverts.clear();
    this.hidx.clear();
    this.stats.houses = 0;
    for (const p of this.pieces) this.pushPiece(p);
    for (const h of this.houses) this.pushHouse(h);
    this.version++;
  }

  // ---- MapLibre hooks ----

  onAdd(map: MlMap): void {
    this.map = map;
    const canvas = map.getCanvas();
    canvas.addEventListener('webglcontextlost', this.onLost);
  }

  onRemove(map: MlMap): void {
    map.getCanvas().removeEventListener('webglcontextlost', this.onLost);
    this.map = null;
    this.release();
  }

  /** After a lost context every GL object is gone; rebuild them on the next frame. */
  private onLost = () => this.release();

  private release(): void {
    this.gl = null;
    this.progs = null;
    this.vaoSeg = this.vaoHouse = this.vaoQuad = this.vaoTri = null;
    this.maskTex = this.maskFbo = this.noiseTex = this.toothTex = null;
    this.paintTex = this.paintFbo = null;
    this.seenTex = this.seenFbo = null;
    this.maskW = this.maskH = 0;
    this.memo.forget();
    this.shadows.release();
    this.seen.release();
    this.moon.release();
    this.segs.lose();
    this.hverts.lose();
    this.hidx.lose();
  }

  private ensure(gl: WebGL2RenderingContext): boolean {
    if (this.broken || gl.isContextLost()) return false;
    if (this.gl === gl && this.progs) return true;
    try {
      this.init(gl);
      return true;
    } catch (e) {
      // Without the fog the map still works: say why once, then keep out of the way.
      console.error('Mr Sparkles: fog disabled', e);
      this.broken = true;
      return false;
    }
  }

  private init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    const n = this.theme.pencils.length;
    this.progs = {
      seg: program(gl, S.SEG_VS, S.SEG_FS, ['a_corner', 'i_ab', 'i_along', 'i_sweep', 'i_kind', 'i_tone']),
      houseMask: program(gl, S.HOUSE_MASK_VS, S.HOUSE_MASK_FS, ['a_pos', 'a_frame', 'a_house']),
      lamp: program(gl, S.LAMP_VS, S.LAMP_FS, ['a_corner']),
      paintSeg: program(gl, S.SEG_VS, S.PAINT_SEG_FS(n), ['a_corner', 'i_ab', 'i_along', 'i_sweep', 'i_kind', 'i_tone']),
      paintHouse: program(gl, S.PAINT_HOUSE_VS, S.PAINT_HOUSE_FS(n), ['a_pos', 'a_frame', 'a_house', 'a_tone']),
      comp: program(gl, S.COMP_VS, S.COMP_FS, ['a_corner']),
      pencil: program(gl, S.COMP_VS, S.PENCIL_FS, ['a_corner']),
    };
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const tri = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    this.segs.buffer = gl.createBuffer();
    this.hverts.buffer = gl.createBuffer();
    this.hidx.buffer = gl.createBuffer();

    // Street segments: a unit quad per instance.
    this.vaoSeg = gl.createVertexArray();
    gl.bindVertexArray(this.vaoSeg);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.segs.sync(gl, gl.ARRAY_BUFFER);
    const st = SEG_FLOATS * 4;
    const inst: [number, number, number][] = [[1, 4, 0], [2, 2, 16], [3, 2, 24], [4, 1, 32], [5, 1, 36]];
    for (const [loc, size, off] of inst) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, st, off);
      gl.vertexAttribDivisor(loc, 1);
    }

    // Houses: indexed triangles.
    this.vaoHouse = gl.createVertexArray();
    gl.bindVertexArray(this.vaoHouse);
    this.hverts.sync(gl, gl.ARRAY_BUFFER);
    const hs = HOUSE_FLOATS * 4;
    for (const [loc, size, off] of [[0, 2, 0], [1, 2, 8], [2, 2, 16], [3, 1, 24]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, hs, off);
    }
    this.hidx.sync(gl, gl.ELEMENT_ARRAY_BUFFER);

    this.vaoQuad = gl.createVertexArray();
    gl.bindVertexArray(this.vaoQuad);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.vaoTri = gl.createVertexArray();
    gl.bindVertexArray(this.vaoTri);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.noiseTex = repeating(gl, NOISE_SIZE, makeNoise(NOISE_SIZE));
    this.toothTex = repeating(gl, TOOTH_SIZE, makeTooth(TOOTH_SIZE));

    // Without shadows or the seen memory the fog still works: those parts just stay out.
    for (const part of [this.shadows, this.seen, this.moon]) {
      try {
        part.init(gl);
      } catch (e) {
        console.error('Mr Sparkles: part of the fog disabled', e);
      }
    }
    this.seenClear = false;
    this.version++;
  }

  private resizeMask(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, Math.ceil(gl.drawingBufferWidth / 2));
    const h = Math.max(1, Math.ceil(gl.drawingBufferHeight / 2));
    const pw = Math.max(1, gl.drawingBufferWidth), ph = Math.max(1, gl.drawingBufferHeight);
    if (w === this.maskW && h === this.maskH && pw === this.paintW && ph === this.paintH && this.maskTex) return;
    this.paintW = pw;
    this.paintH = ph;
    for (const t of [this.maskTex, this.seenTex, this.paintTex]) if (t) gl.deleteTexture(t);
    for (const f of [this.maskFbo, this.seenFbo, this.paintFbo]) if (f) gl.deleteFramebuffer(f);
    [this.maskTex, this.maskFbo] = target(gl, w, h, gl.RGBA8, gl.RGBA);
    [this.paintTex, this.paintFbo] = target(gl, this.paintW, this.paintH, gl.RGBA8, gl.RGBA);
    // Only one channel: the seen memory.
    [this.seenTex, this.seenFbo] = target(gl, w, h, gl.R8, gl.RED);
    this.seenClear = false;
    this.maskW = w;
    this.maskH = h;
    this.version++;
  }

  /** Frame constants shared by both passes. */
  private frame(opts: CustomRenderMethodInput) {
    const map = this.map!;
    const zoom = map.getZoom();
    const ws = 512 * 2 ** zoom;
    const o = this.origin ?? makeOrigin(map.getCenter().lng, map.getCenter().lat);
    const m64 = localMatrix(opts.modelViewProjectionMatrix, ws, o.ox, o.oy);
    const cssPxUnits = EARTH_CIRCUMFERENCE_M / ws;
    return { zoom, ws, o, m64, matrix: new Float32Array(m64), cssPxUnits, dpr: map.getPixelRatio() };
  }

  prerender(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput): void {
    if (!this.map || !this.ensure(gl)) return;
    this.resizeMask(gl);
    const t = pageTime();
    // Standing still, the masks would come out as they are: keep them (and the battery).
    const still = this.stillInputs(opts, t);
    if (this.memo.same(still)) {
      this.stats.kept++;
      return;
    }
    this.stats.masks++;
    const p = this.progs!;
    const f = this.frame(opts);
    const fog = this.theme.fog;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFbo);
    gl.viewport(0, 0, this.maskW, this.maskH);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);

    const nSeg = this.segs.length / SEG_FLOATS;
    if (nSeg > 0) {
      gl.useProgram(p.seg.p);
      gl.bindVertexArray(this.vaoSeg);
      this.segs.sync(gl, gl.ARRAY_BUFFER);
      gl.uniformMatrix4fv(p.seg.u.u_matrix, false, f.matrix);
      gl.uniform3f(p.seg.u.u_radius, fog.roadM, fog.pathM, fog.houseM);
      gl.uniform1f(p.seg.u.u_m2u, f.o.m2u);
      gl.uniform1f(p.seg.u.u_minr, 2.5 * f.cssPxUnits);
      gl.uniform1f(p.seg.u.u_time, t);
      gl.uniform1f(p.seg.u.u_speed, fog.sweepMps);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nSeg);
    }

    const nIdx = this.hidx.length;
    if (nIdx > 0) {
      gl.useProgram(p.houseMask.p);
      gl.bindVertexArray(this.vaoHouse);
      this.hverts.sync(gl, gl.ARRAY_BUFFER);
      this.hidx.sync(gl, gl.ELEMENT_ARRAY_BUFFER);
      gl.uniformMatrix4fv(p.houseMask.u.u_matrix, false, f.matrix);
      gl.uniform1f(p.houseMask.u.u_time, t);
      gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_INT, 0);
    }

    const l = this.lantern;
    if (l) {
      const x = (mercXOf(l.lon) - f.o.ox) * EARTH_CIRCUMFERENCE_M;
      const y = (mercYOf(l.lat) - f.o.oy) * EARTH_CIRCUMFERENCE_M;
      const h = ((l.heading ?? 0) * Math.PI) / 180;
      gl.useProgram(p.lamp.p);
      gl.bindVertexArray(this.vaoQuad);
      gl.uniformMatrix4fv(p.lamp.u.u_matrix, false, f.matrix);
      gl.uniform2f(p.lamp.u.u_pos, x, y);
      gl.uniform1f(p.lamp.u.u_extent, Math.max(fog.lanternM, fog.coneM) * f.o.m2u * 1.05);
      gl.uniform1f(p.lamp.u.u_m2u, f.o.m2u);
      gl.uniform1f(p.lamp.u.u_lantern, fog.lanternM);
      gl.uniform1f(p.lamp.u.u_coneLen, fog.coneM);
      gl.uniform1f(p.lamp.u.u_coneCos, Math.cos((fog.coneHalfDeg * Math.PI) / 180));
      gl.uniform1f(p.lamp.u.u_coneInnerCos, Math.cos((fog.coneInnerDeg * Math.PI) / 180));
      gl.uniform2f(p.lamp.u.u_dir, Math.sin(h), -Math.cos(h));
      gl.uniform1f(p.lamp.u.u_cone, l.heading === null ? 0 : l.cone);
      gl.uniform1f(p.lamp.u.u_on, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      // Your light stops at walls: darken it behind every wall that faces you.
      gl.bindVertexArray(null);
      const reach = Math.max(fog.lanternM, fog.coneM) * f.o.m2u * 1.05;
      this.shadows.draw(
        gl, f.matrix, f.o.ox * EARTH_CIRCUMFERENCE_M, f.o.oy * EARTH_CIRCUMFERENCE_M, this.lightAt(x, y), reach,
        fog.lampRadiusM * f.o.m2u,
      );
    }

    // The pencils: every walked street and house in its own, into the paint target. MAX keeps a
    // street's overlapping capsules from coloring twice; where two pencils cross, the darker wins.
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.paintFbo);
    gl.viewport(0, 0, this.paintW, this.paintH);
    // Map units per device pixel.
    const devUnits = f.cssPxUnits / f.dpr;
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    const pen = this.theme.pencil;
    if (nSeg > 0) {
      const u = p.paintSeg.u;
      gl.useProgram(p.paintSeg.p);
      gl.bindVertexArray(this.vaoSeg);
      gl.uniformMatrix4fv(u.u_matrix, false, f.matrix);
      gl.uniform3f(u.u_radius, pen.roadM, pen.pathM, 0);
      gl.uniform1f(u.u_m2u, f.o.m2u);
      // Never thinner than this (CSS px), so a whole walk on one screen (the summary) still shows.
      gl.uniform1f(u.u_minr, 2.4 * f.cssPxUnits);
      // Room for the scribble past the lines: its widest turn and half a stroke, on the narrowest path.
      gl.uniform1f(u.u_grow, 1.6 + (0.5 * pen.strokeWidthM) / pen.pathM);
      gl.uniform1f(u.u_edge, devUnits);
      gl.uniform1f(u.u_pxUnits, devUnits);
      gl.uniform2f(u.u_stroke, pen.strokeM, pen.strokeWidthM);
      gl.uniform1f(u.u_time, t);
      gl.uniform1f(u.u_speed, fog.sweepMps);
      gl.uniform3fv(u.u_pencils, this.pencils);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, nSeg);
    }
    if (nIdx > 0) {
      const u = p.paintHouse.u;
      gl.useProgram(p.paintHouse.p);
      gl.bindVertexArray(this.vaoHouse);
      gl.uniformMatrix4fv(u.u_matrix, false, f.matrix);
      gl.uniform1f(u.u_m2u, f.o.m2u);
      gl.uniform1f(u.u_time, t);
      gl.uniform1f(u.u_amount, pen.house);
      gl.uniform3fv(u.u_pencils, this.pencils);
      gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_INT, 0);
    }

    gl.blendEquation(gl.FUNC_ADD);
    gl.bindVertexArray(null);

    // What you have seen, for the view: its own mask, read by the composite. Zoomed far out it
    // is a few pixels a tile, not worth a texture each. With nothing to draw, cleared once.
    const seenOn = f.zoom >= SEEN_MIN_ZOOM && this.seen.stats.tiles > 0;
    let pending = false;
    if (seenOn || !this.seenClear) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.seenFbo);
      gl.viewport(0, 0, this.maskW, this.maskH);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      if (seenOn) {
        gl.disable(gl.BLEND);
        pending = this.seen.draw(gl, f.matrix, f.o.ox, f.o.oy, this.viewBounds());
        if (pending) this.map?.triggerRepaint();
        gl.enable(gl.BLEND);
      }
      this.seenClear = !seenOn;
      gl.bindVertexArray(null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    this.memo.drawn(still, pending);
  }

  /** What the masks would be drawn from this frame, without allocating. */
  private stillInputs(opts: CustomRenderMethodInput, t: number): MaskInputs {
    const s = this.still;
    const ws = 512 * 2 ** this.map!.getZoom();
    s.version = this.version;
    s.t = t;
    s.animUntil = this.maskUntil;
    s.mvp = opts.modelViewProjectionMatrix;
    s.ws = ws;
    s.w = this.maskW;
    s.h = this.maskH;
    const l = this.lantern;
    if (l) {
      const sl = this.stillLight;
      sl.x = mercXOf(l.lon) * ws;
      sl.y = mercYOf(l.lat) * ws;
      sl.heading = l.heading;
      sl.cone = l.cone;
      s.light = sl;
    } else {
      s.light = null;
      const c = this.map!.getCenter();
      s.probeX = mercXOf(c.lng) * ws;
      s.probeY = mercYOf(c.lat) * ws;
    }
    return s;
  }

  private lightXY = new Float64Array(2);
  private lightAt(x: number, y: number): Float64Array {
    this.lightXY[0] = x;
    this.lightXY[1] = y;
    return this.lightXY;
  }

  /** The map's view as WM bounds [west, north, east, south] (x grows east, y south). */
  private viewBounds(): [number, number, number, number] {
    const b = this.map!.getBounds();
    return [
      mercXOf(b.getWest()) * EARTH_CIRCUMFERENCE_M, mercYOf(b.getNorth()) * EARTH_CIRCUMFERENCE_M,
      mercXOf(b.getEast()) * EARTH_CIRCUMFERENCE_M, mercYOf(b.getSouth()) * EARTH_CIRCUMFERENCE_M,
    ];
  }

  render(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput): void {
    if (!this.map || !this.progs || this.gl !== gl || !this.maskTex || gl.isContextLost()) return;
    const p = this.progs;
    const f = this.frame(opts);
    const t = pageTime();
    const th = this.theme;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const nIdx = this.hidx.length;

    const inv = invert(f.m64);
    const ndcZ = f.m64[14] / f.m64[15];
    const invM = inv ? new Float32Array(inv) : null;
    if (invM) {
      const u = p.comp.u;
      gl.useProgram(p.comp.p);
      gl.bindVertexArray(this.vaoTri);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, this.seenTex);
      gl.uniform1i(u.u_mask, 0);
      gl.uniform1i(u.u_noise, 1);
      gl.uniform1i(u.u_seen, 2);
      gl.uniform1f(u.u_seenClear, th.seen.clear);
      gl.uniformMatrix4fv(u.u_inv, false, invM);
      gl.uniform1f(u.u_ndcZ, ndcZ);
      gl.uniform1f(u.u_noiseScale, 1 / (700 * f.o.m2u));
      gl.uniform1f(u.u_opacity, th.fog.opacity);
      gl.uniform3fv(u.u_paper, this.paper);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.bindVertexArray(null);

    // Houses you have seen print in ink over the wash; walls that face you a little heavier.
    this.moon.draw(gl, f.matrix, f.o.ox, f.o.oy, t, f.cssPxUnits, f.dpr, this.maskTex);
    gl.bindVertexArray(null);

    // Last, the pencil, multiplied over the paper and the ink: lines stay black under it.
    if (invM && (this.segs.length || nIdx)) {
      const u = p.pencil.u;
      gl.useProgram(p.pencil.p);
      gl.bindVertexArray(this.vaoTri);
      gl.blendFuncSeparate(gl.DST_COLOR, gl.ZERO, gl.ZERO, gl.ONE);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.toothTex);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.paintTex);
      gl.uniform1i(u.u_paint, 0);
      gl.uniform1i(u.u_tooth, 1);
      gl.uniformMatrix4fv(u.u_inv, false, invM);
      gl.uniform1f(u.u_ndcZ, ndcZ);
      gl.uniform1f(u.u_pxUnits, f.cssPxUnits / f.dpr);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, null);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindVertexArray(null);
    }
    this.stats.frames++;
  }
}

/** A render target with linear filtering. */
function target(
  gl: WebGL2RenderingContext, w: number, h: number, internal: number, format: number,
): [WebGLTexture, WebGLFramebuffer] {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const fbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  return [tex, fbo];
}

const mercXOf = (lon: number) => (lon + 180) / 360;
function mercYOf(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

/** A tiled R8 texture with mipmaps. */
function repeating(gl: WebGL2RenderingContext, n: number, data: Uint8Array): WebGLTexture {
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, n, n, 0, gl.RED, gl.UNSIGNED_BYTE, data);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
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
  let s = Math.imul(8, 2654435761) >>> 0 || 1;
  const r = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
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

/**
 * Tileable noise: white noise blurred with wrap-around, a coarse octave (blur radius `big`) and a
 * fine one (`small`): the wash's soft edges.
 */
export function makeNoise(n: number, big = 9, small = 3): Uint8Array {
  let seed = 1234567;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  // Box blur with wrap-around (so the texture tiles), as a running sum: O(n²) per pass.
  const pass = (src: Float32Array, r: number, at: (line: number, i: number) => number): Float32Array => {
    const out = new Float32Array(n * n);
    const w = 2 * r + 1;
    for (let line = 0; line < n; line++) {
      let s = 0;
      for (let k = -r; k <= r; k++) s += src[at(line, (k + n) % n)];
      for (let i = 0; i < n; i++) {
        out[at(line, i)] = s / w;
        s += src[at(line, (i + r + 1) % n)] - src[at(line, (i - r + n) % n)];
      }
    }
    return out;
  };
  const blur = (src: Float32Array, r: number) =>
    pass(pass(src, r, (y, x) => y * n + x), r, (x, y) => y * n + x);
  const white = new Float32Array(n * n).map(() => rnd());
  const coarse = blur(blur(white, big), big);
  const fine = blur(blur(white.map(() => rnd()), small), small);
  const mix = new Float32Array(n * n);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < mix.length; i++) {
    mix[i] = coarse[i] * 0.7 + fine[i] * 0.3;
    if (mix[i] < lo) lo = mix[i];
    if (mix[i] > hi) hi = mix[i];
  }
  const out = new Uint8Array(n * n);
  for (let i = 0; i < mix.length; i++) out[i] = Math.round(((mix[i] - lo) / (hi - lo || 1)) * 255);
  return out;
}
