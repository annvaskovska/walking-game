import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import { polylineLengthM } from '../../geo/geo';
import type { Theme } from '../../theme';
import { EARTH_CIRCUMFERENCE_M, GrowBuffer, hex3, invert, localMatrix, program, type Program } from '../gl';
import {
  HOUSE_FLOATS, KIND_PATH, KIND_ROAD, SEG_FLOATS, houseSeed, makeOrigin, pushHouse, pushPiece,
  type Origin, type Sweep,
} from './geometry';
import * as S from './shaders';

/** Where you are, for the lantern. */
export interface Lantern {
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
}

interface HouseRec {
  house: { id: string; coords: ArrayLike<number>; holes?: ArrayLike<number>[] };
  tOn: number;
}

/** Rebase the local origin once the view is this far from it (float32 stays mm-exact well past it). */
const REBASE_M = 200_000;
const NOISE_SIZE = 128;

/** Seconds on the page clock the shaders animate with. */
export const pageTime = () => performance.now() / 1000;

/**
 * The fog of the unwalked city, drawn on the GPU as one MapLibre custom layer right above the
 * basemap. It owns everything "lit": the cleared corridors of your streets with their gold line
 * and unlock wave, your lit houses, and your lantern. See shaders.ts for how it looks.
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
  private broken = false;

  // GL state, created lazily inside prerender (MapLibre resets its state cache right after).
  private gl: WebGL2RenderingContext | null = null;
  private progs: Record<'seg' | 'houseMask' | 'lamp' | 'house' | 'comp', Program> | null = null;
  private vaoSeg: WebGLVertexArrayObject | null = null;
  private vaoHouse: WebGLVertexArrayObject | null = null;
  private vaoQuad: WebGLVertexArrayObject | null = null;
  private vaoTri: WebGLVertexArrayObject | null = null;
  private maskTex: WebGLTexture | null = null;
  private maskFbo: WebGLFramebuffer | null = null;
  private maskW = 0;
  private maskH = 0;
  private noiseTex: WebGLTexture | null = null;

  readonly stats = { segments: 0, houses: 0, frames: 0 };
  private col: Record<'fill' | 'warm' | 'pale' | 'fog' | 'mist' | 'rim' | 'lamp' | 'beam' | 'flash' | 'street', [number, number, number]>;

  constructor(private theme: Theme) {
    const f = theme.fog, h = theme.house;
    this.col = {
      fill: hex3(h.fill), warm: hex3(h.windowWarm), pale: hex3(h.windowPale),
      fog: hex3(f.color), mist: hex3(f.mist), rim: hex3(f.rim), lamp: hex3(f.lamp), beam: hex3(f.beam), flash: hex3(f.flash), street: hex3(f.street),
    };
  }

  // ---- Data ----

  /** A lit street piece; with a sweep it lights up as a wave from where you stood. */
  addPiece(coords: ArrayLike<number>, kind: 'road' | 'path' | 'side', sweep: Sweep | null = null): void {
    if (coords.length < 4) return;
    const rec: PieceRec = { coords, kind: kind === 'road' ? KIND_ROAD : KIND_PATH, sweep };
    this.pieces.push(rec);
    if (!this.origin) this.setOrigin(coords[0], coords[1]);
    this.pushPiece(rec);
    if (sweep) {
      const end = sweep.offsetM + polylineLengthM(coords);
      const reach = Math.max(Math.abs(sweep.offsetM - sweep.fromM), Math.abs(end - sweep.fromM));
      this.animUntil = Math.max(this.animUntil, sweep.t0 + reach / this.theme.fog.sweepMps + 3);
    }
    this.map?.triggerRepaint();
  }

  /** A lit house; its windows come on at page time `tOn` (or at once for houses lit long ago). */
  addHouse(house: HouseRec['house'], tOn: number): void {
    const rec: HouseRec = { house, tOn };
    this.houses.push(rec);
    if (!this.origin) this.setOrigin(house.coords[0], house.coords[1]);
    this.pushHouse(rec);
    this.animUntil = Math.max(this.animUntil, tOn + 3);
    this.map?.triggerRepaint();
  }

  clear(): void {
    this.pieces = [];
    this.houses = [];
    this.segs.clear();
    this.hverts.clear();
    this.hidx.clear();
    this.stats.segments = this.stats.houses = 0;
    this.map?.triggerRepaint();
  }

  setLantern(l: Lantern | null): void {
    this.lantern = l;
    if (l && this.origin) {
      const dx = (l.lon - this.origin.lon) * 111_320 * Math.cos((l.lat * Math.PI) / 180);
      const dy = (l.lat - this.origin.lat) * 110_540;
      if (Math.hypot(dx, dy) > REBASE_M) this.setOrigin(l.lon, l.lat);
    } else if (l && !this.origin) this.setOrigin(l.lon, l.lat);
  }

  /** Is an unlock wave or a house's windows still animating? */
  animating(now = pageTime()): boolean {
    return now < this.animUntil;
  }

  private pushPiece(r: PieceRec): void {
    const tmp: number[] = [];
    pushPiece(tmp, this.origin!, r.coords, r.kind, r.sweep);
    this.segs.push(tmp);
    this.stats.segments = this.segs.length / SEG_FLOATS;
  }

  private pushHouse(r: HouseRec): void {
    const v: number[] = [], idx: number[] = [], seg: number[] = [];
    // Indices are absolute: offset them by the vertices already stored.
    const base = this.hverts.length / HOUSE_FLOATS;
    if (!pushHouse(v, idx, seg, this.origin!, r.house, houseSeed(r.house.id), r.tOn)) return;
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
    this.maskTex = this.maskFbo = this.noiseTex = null;
    this.maskW = this.maskH = 0;
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
      console.error('Wanderlight: fog disabled', e);
      this.broken = true;
      return false;
    }
  }

  private init(gl: WebGL2RenderingContext): void {
    this.gl = gl;
    this.progs = {
      seg: program(gl, S.SEG_VS, S.SEG_FS, ['a_corner', 'i_ab', 'i_along', 'i_sweep', 'i_kind']),
      houseMask: program(gl, S.HOUSE_MASK_VS, S.HOUSE_MASK_FS, ['a_pos', 'a_frame', 'a_house']),
      lamp: program(gl, S.LAMP_VS, S.LAMP_FS, ['a_corner']),
      house: program(gl, S.HOUSE_VS, S.HOUSE_FS, ['a_pos', 'a_frame', 'a_house']),
      comp: program(gl, S.COMP_VS, S.COMP_FS, ['a_corner']),
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
    const inst: [number, number, number][] = [[1, 4, 0], [2, 2, 16], [3, 2, 24], [4, 1, 32]];
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
    for (const [loc, off] of [[0, 0], [1, 8], [2, 16]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, hs, off);
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

    this.noiseTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, NOISE_SIZE, NOISE_SIZE, 0, gl.RED, gl.UNSIGNED_BYTE, makeNoise(NOISE_SIZE));
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  }

  private resizeMask(gl: WebGL2RenderingContext): void {
    const w = Math.max(1, Math.ceil(gl.drawingBufferWidth / 2));
    const h = Math.max(1, Math.ceil(gl.drawingBufferHeight / 2));
    if (w === this.maskW && h === this.maskH && this.maskTex) return;
    if (this.maskTex) gl.deleteTexture(this.maskTex);
    if (this.maskFbo) gl.deleteFramebuffer(this.maskFbo);
    this.maskTex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.maskFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.maskFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.maskTex, 0);
    this.maskW = w;
    this.maskH = h;
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
    const p = this.progs!;
    const f = this.frame(opts);
    const t = pageTime();
    const fog = this.theme.fog;
    this.resizeMask(gl);
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
      gl.uniform2f(p.lamp.u.u_dir, Math.sin(h), -Math.cos(h));
      gl.uniform1f(p.lamp.u.u_cone, l.heading === null ? 0 : l.cone);
      gl.uniform1f(p.lamp.u.u_on, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.blendEquation(gl.FUNC_ADD);
    gl.bindVertexArray(null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
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

    const mpp = f.cssPxUnits / f.dpr / f.o.m2u;
    const nIdx = this.hidx.length;
    if (nIdx > 0) {
      gl.useProgram(p.house.p);
      gl.bindVertexArray(this.vaoHouse);
      gl.uniformMatrix4fv(p.house.u.u_matrix, false, f.matrix);
      gl.uniform1f(p.house.u.u_time, t);
      gl.uniform1f(p.house.u.u_mpp, mpp);
      gl.uniform3fv(p.house.u.u_fill, this.col.fill);
      gl.uniform3fv(p.house.u.u_warm, this.col.warm);
      gl.uniform3fv(p.house.u.u_pale, this.col.pale);
      gl.drawElements(gl.TRIANGLES, nIdx, gl.UNSIGNED_INT, 0);
    }

    const inv = invert(f.m64);
    if (inv) {
      const ndcZ = f.m64[14] / f.m64[15];
      const roadUnits = th.fog.roadM * f.o.m2u;
      const core = Math.min(0.985, Math.max(0.86, 1 - (1.5 * f.cssPxUnits) / roadUnits));
      gl.useProgram(p.comp.p);
      gl.bindVertexArray(this.vaoTri);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.maskTex);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, this.noiseTex);
      const u = p.comp.u;
      gl.uniform1i(u.u_mask, 0);
      gl.uniform1i(u.u_noise, 1);
      gl.uniformMatrix4fv(u.u_inv, false, new Float32Array(inv));
      gl.uniform1f(u.u_ndcZ, ndcZ);
      gl.uniform1f(u.u_time, t);
      gl.uniform1f(u.u_noiseScale, 1 / (700 * f.o.m2u));
      gl.uniform1f(u.u_mistAmt, smooth(12.5, 15, f.zoom));
      gl.uniform1f(u.u_opacity, th.fog.opacity);
      gl.uniform1f(u.u_core, f.zoom < 14 ? 2 : core);
      const c = this.col;
      gl.uniform3fv(u.u_fog, c.fog);
      gl.uniform3fv(u.u_mist, c.mist);
      gl.uniform3fv(u.u_rim, c.rim);
      gl.uniform3fv(u.u_lamp, c.lamp);
      gl.uniform3fv(u.u_beam, c.beam);
      gl.uniform3fv(u.u_flash, c.flash);
      gl.uniform3fv(u.u_street, c.street);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    }
    gl.bindVertexArray(null);
    this.stats.frames++;
  }
}

const mercXOf = (lon: number) => (lon + 180) / 360;
function mercYOf(lat: number): number {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Tileable soft noise: white noise blurred with wrap-around, two octaves. */
export function makeNoise(n: number): Uint8Array {
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
  const big = blur(blur(white, 9), 9);
  const small = blur(blur(white.map(() => rnd()), 3), 3);
  const mix = new Float32Array(n * n);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < mix.length; i++) {
    mix[i] = big[i] * 0.7 + small[i] * 0.3;
    if (mix[i] < lo) lo = mix[i];
    if (mix[i] > hi) hi = mix[i];
  }
  const out = new Uint8Array(n * n);
  for (let i = 0; i < mix.length; i++) out[i] = Math.round(((mix[i] - lo) / (hi - lo || 1)) * 255);
  return out;
}
