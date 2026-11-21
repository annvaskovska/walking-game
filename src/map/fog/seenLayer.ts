import earcut from 'earcut';
import { SEEN_TILE, SEEN_Z } from '../../core/seen';
import { nightTheme, type Theme } from '../../theme';
import { EARTH_CIRCUMFERENCE_M, hex3, program, type Program } from '../gl';
import { houseSeed, mercX, mercY } from './geometry';

/**
 * What you have seen, on the GPU, in two parts:
 *
 * - SeenTextures: the seen memory (one R8 texture per z17 tile), drawn world-anchored into the
 *   fog's half-resolution `seenMask` (R = seen 0..1), which the composite reads to thin the fog.
 * - MoonHouses: the houses you have seen, over the fog: dim blue roofs with a moonlit outline,
 *   fading in. Walls that face your light right now glow warm.
 *
 * Positions on the GPU are the fog's local units: WM (mercator metres, y south) minus the fog's
 * origin, so float32 stays exact.
 */

const C = EARTH_CIRCUMFERENCE_M;

// ---- Seen tiles ----

/** Texture side of a seen tile: its texels plus a one-texel border copied from its neighbours. */
export const SEEN_TEX = SEEN_TILE + 2;
/** Side of a seen tile, WM units. */
export const SEEN_TILE_WM = C / 2 ** SEEN_Z;
const TILES = 2 ** SEEN_Z;
/** Textures kept on the GPU (≈ 89 KB each with mipmaps, so ≈ 14 MB) before the least used go. */
export const MAX_GPU_TILES = 160;
/** A texture not drawn for this long is freed (its tile's data stays with the caller). */
const IDLE_MS = 60_000;
const SWEEP_MS = 2_000;
/** Uploads per frame; the rest wait for the next frames (draw() says so). */
const MAX_UPLOADS = 24;
/** Neighbour slots are (dy + 1) * 3 + (dx + 1); 4 is the tile itself. */
const ALL_NEIGHBOURS = 0b111_101_111;

/** A number for tile (x, y), to find neighbours without building key strings. */
export const tileId = (x: number, y: number): number => x * TILES + y;

/** WM edge of tile column / row i, minus an origin: one formula, so neighbours share it exactly. */
const tileEdge = (i: number, o: number): number => i * SEEN_TILE_WM - o;

/**
 * Quad of tile (x, y) in local units (WM minus the origin oxWM, oyWM): west, north, east, south.
 * Float32, as the GPU gets it; a tile's east edge is bit for bit its neighbour's west edge.
 */
export function tileQuad(x: number, y: number, oxWM: number, oyWM: number, out = new Float32Array(4)): Float32Array {
  out[0] = tileEdge(x, oxWM);
  out[1] = tileEdge(y, oyWM);
  out[2] = tileEdge(x + 1, oxWM);
  out[3] = tileEdge(y + 1, oyWM);
  return out;
}

/** Tiles under a WM box [west, north, east, south]: inclusive columns and rows, within the world. */
export function tileRange(view: ArrayLike<number>, out = new Int32Array(4)): Int32Array {
  for (let k = 0; k < 4; k++) out[k] = Math.min(TILES - 1, Math.max(0, Math.floor(view[k] / SEEN_TILE_WM)));
  return out;
}

/**
 * The texture of one tile: its texels inside a one-texel border holding its neighbours' edge
 * texels (0 where there is no neighbour: nothing seen there). Linear filtering then runs across a
 * tile edge exactly as inside a tile, so seams don't show. `nb` holds the tiles' data by slot
 * (dy + 1) * 3 + (dx + 1); slot 4 is the tile itself.
 */
export function composeTileTexture(out: Uint8Array, nb: ArrayLike<Uint8Array | null | undefined>): Uint8Array {
  const N = SEEN_TILE, W = SEEN_TEX, L = N - 1;
  const self = nb[4]!;
  for (let j = 0; j < N; j++) {
    const s = j * N, d = (j + 1) * W + 1;
    for (let i = 0; i < N; i++) out[d + i] = self[s + i];
  }
  const n = nb[1], s = nb[7], w = nb[3], e = nb[5];
  for (let i = 0; i < N; i++) {
    out[1 + i] = n ? n[L * N + i] : 0;
    out[(W - 1) * W + 1 + i] = s ? s[i] : 0;
    out[(i + 1) * W] = w ? w[i * N + L] : 0;
    out[(i + 1) * W + W - 1] = e ? e[i * N] : 0;
  }
  const nw = nb[0], ne = nb[2], sw = nb[6], se = nb[8];
  out[0] = nw ? nw[L * N + L] : 0;
  out[W - 1] = ne ? ne[L * N] : 0;
  out[(W - 1) * W] = sw ? sw[L] : 0;
  out[W * W - 1] = se ? se[0] : 0;
  return out;
}

/** The outer texels of a tile, as 4 strips of SEEN_TILE: north row, south row, west column, east column. */
export function tileBorder(data: Uint8Array, out: Uint8Array): Uint8Array {
  const N = SEEN_TILE, L = N - 1;
  for (let i = 0; i < N; i++) {
    out[i] = data[i];
    out[N + i] = data[L * N + i];
    out[2 * N + i] = data[i * N];
    out[3 * N + i] = data[i * N + L];
  }
  return out;
}

/** Neighbours (bits by slot) whose border copies a texel that differs between two tileBorder()s. */
export function changedNeighbours(prev: Uint8Array, next: Uint8Array): number {
  const N = SEEN_TILE, L = N - 1;
  let bits = 0;
  // Strip k of the border feeds the neighbour in `slot`: north row → north, and so on.
  const slots = [1, 7, 3, 5];
  for (let k = 0; k < 4; k++) {
    for (let i = k * N; i < (k + 1) * N; i++) {
      if (prev[i] !== next[i]) {
        bits |= 1 << slots[k];
        break;
      }
    }
  }
  // Corner texels also feed the diagonal neighbours.
  if (prev[0] !== next[0]) bits |= 1 << 0;
  if (prev[L] !== next[L]) bits |= 1 << 2;
  if (prev[N] !== next[N]) bits |= 1 << 6;
  if (prev[N + L] !== next[N + L]) bits |= 1 << 8;
  return bits;
}

/**
 * Which textures to free, as indices into `usedAt` (when each was last drawn): those idle for
 * `idleMs`, then the least recently drawn until at most `budget` remain. Textures drawn at `now`
 * (this frame) always stay.
 */
export function pickEvictions(usedAt: ArrayLike<number>, now: number, budget: number, idleMs: number): number[] {
  const out: number[] = [], kept: number[] = [];
  for (let i = 0; i < usedAt.length; i++) {
    if (usedAt[i] !== now && now - usedAt[i] > idleMs) out.push(i);
    else kept.push(i);
  }
  if (kept.length > budget) {
    const old = kept.filter((i) => usedAt[i] !== now).sort((a, b) => usedAt[a] - usedAt[b]);
    for (let k = 0; k < Math.min(old.length, kept.length - budget); k++) out.push(old[k]);
  }
  return out;
}

export const SEEN_TILE_VS = `#version 300 es
in vec2 a_corner;
uniform mat4 u_matrix;
uniform vec4 u_rect;
out vec2 v_uv;
void main() {
  // Pick the corner rather than mix(): neighbouring tiles then share their edges to the last bit,
  // so no pixel along a seam is missed or drawn twice.
  vec2 p = vec2(a_corner.x < 0.5 ? u_rect.x : u_rect.z, a_corner.y < 0.5 ? u_rect.y : u_rect.w);
  // The tile's texels sit inside a one-texel border: each texel's centre lands on its WM centre.
  v_uv = (1.0 + ${SEEN_TILE}.0 * a_corner) / ${SEEN_TEX}.0;
  gl_Position = u_matrix * vec4(p, 0.0, 1.0);
}`;

export const SEEN_TILE_FS = `#version 300 es
precision highp float;
in vec2 v_uv;
uniform sampler2D u_tex;
out vec4 o;
void main() {
  o = vec4(texture(u_tex, v_uv).r, 0.0, 0.0, 0.0);
}`;

interface TileTex {
  key: string;
  x: number;
  y: number;
  /** The caller's data (not copied): uploads read it as it is then. */
  data: Uint8Array;
  version: number;
  /** tileBorder() as of the last set(), to tell which neighbours need their border refreshed. */
  border: Uint8Array;
  tex: WebGLTexture | null;
  /** The texture is out of date: the tile or a neighbour's edge changed. */
  stale: boolean;
  /** performance.now() of the last frame it was drawn. */
  usedAt: number;
}

/**
 * The seen memory as textures, drawn into the bound render target as R = seen 0..1.
 *
 * Seams: every texture carries a one-texel border with its neighbours' edge texels (refreshed
 * when a neighbour's edge changes), and quads of neighbouring tiles share exact float32 edges, so
 * filtering runs on across a tile edge as inside a tile: exactly at mip levels 0 and 1, nearly
 * from level 2 on (258 is not a power of two), where a texel is about a pixel and less.
 *
 * Memory: textures are made for tiles in view only; one not drawn for a minute is freed, and past
 * MAX_GPU_TILES the least recently drawn go first. The tiles' data stays with the caller.
 */
export class SeenTextures {
  private byKey = new Map<string, TileTex>();
  private byId = new Map<number, TileTex>();
  private gl: WebGL2RenderingContext | null = null;
  private prog: Program | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private broken = false;
  private textures = 0;
  private lastSweep = 0;
  private uploading = false;
  private staging = new Uint8Array(SEEN_TEX * SEEN_TEX);
  private scratchBorder = new Uint8Array(4 * SEEN_TILE);
  private nb: (Uint8Array | null)[] = new Array(9).fill(null);
  private range = new Int32Array(4);
  private quad = new Float32Array(4);
  /** Per frame: tiles drawn and uploaded; and how many tiles / textures there are. */
  readonly stats = { drawn: 0, uploads: 0, tiles: 0, textures: 0 };

  /** A new or changed tile (by version, or a new data array); the texture follows on the next draw. */
  set(tile: { key: string; x: number; y: number; data: Uint8Array; version: number }): void {
    let e = this.byKey.get(tile.key);
    if (e && e.version === tile.version && e.data === tile.data) return;
    if (!e) {
      e = {
        key: tile.key, x: tile.x, y: tile.y, data: tile.data, version: tile.version,
        border: new Uint8Array(4 * SEEN_TILE), tex: null, stale: true, usedAt: -Infinity,
      };
      this.byKey.set(e.key, e);
      this.byId.set(tileId(e.x, e.y), e);
      this.stats.tiles = this.byKey.size;
    } else {
      e.data = tile.data;
      e.version = tile.version;
      e.stale = true;
    }
    // A new tile starts from an all-zero border: what its neighbours' borders held for it.
    const b = tileBorder(tile.data, this.scratchBorder);
    this.markNeighbours(e, changedNeighbours(e.border, b));
    e.border.set(b);
  }

  /** Forget a tile, texture and all. */
  drop(key: string): void {
    const e = this.byKey.get(key);
    if (!e) return;
    this.freeTexture(e);
    this.byKey.delete(key);
    this.byId.delete(tileId(e.x, e.y));
    this.markNeighbours(e, ALL_NEIGHBOURS);
    this.stats.tiles = this.byKey.size;
  }

  clear(): void {
    for (const e of this.byKey.values()) this.freeTexture(e);
    this.byKey.clear();
    this.byId.clear();
    this.stats.tiles = 0;
  }

  /** GL objects. Safe to call again: after release() (a lost context) it builds them anew. */
  init(gl: WebGL2RenderingContext): void {
    if (this.gl === gl && this.prog) return;
    this.release();
    this.prog = program(gl, SEEN_TILE_VS, SEEN_TILE_FS, ['a_corner']);
    const quad = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.gl = gl;
  }

  /** Forget every GL object without deleting it (the context is gone); tiles upload again later. */
  release(): void {
    this.gl = null;
    this.prog = null;
    this.vao = null;
    for (const e of this.byKey.values()) {
      e.tex = null;
      e.stale = true;
    }
    this.textures = this.stats.textures = 0;
  }

  /**
   * Draw every tile in view into the bound render target (R = seen, GBA = 0), world-anchored.
   * Leaves blending as it is (tiles don't overlap; MAX works too); disables face culling, uses
   * texture unit 0 (left active, with nothing bound) and unbinds its VAO.
   *
   * - `matrix`: local units → clip (FogLayer frame().matrix);
   * - `ox, oy`: the fog origin in MapLibre mercator 0..1 (frame().o.ox / .oy);
   * - `view`: the view in WM [west, north, east, south].
   *
   * Returns true when some tiles in view still wait for their upload: draw again soon.
   */
  draw(gl: WebGL2RenderingContext, matrix: Float32Array, ox: number, oy: number, view: ArrayLike<number>): boolean {
    this.stats.drawn = this.stats.uploads = 0;
    if (!this.byId.size || !this.ensure(gl)) return false;
    const u = this.prog!.u;
    const oxWM = ox * C, oyWM = oy * C;
    const r = tileRange(view, this.range);
    const now = performance.now();
    // Windings vary (and the map flips y): nothing may be culled.
    gl.disable(gl.CULL_FACE);
    gl.useProgram(this.prog!.p);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(u.u_matrix, false, matrix);
    gl.uniform1i(u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    let pending = false;
    if ((r[2] - r[0] + 1) * (r[3] - r[1] + 1) <= this.byId.size) {
      for (let ty = r[1]; ty <= r[3]; ty++) {
        for (let tx = r[0]; tx <= r[2]; tx++) {
          const e = this.byId.get(tileId(tx, ty));
          if (e && !this.drawTile(gl, e, oxWM, oyWM, now)) pending = true;
        }
      }
    } else {
      for (const e of this.byId.values()) {
        if (e.x < r[0] || e.x > r[2] || e.y < r[1] || e.y > r[3]) continue;
        if (!this.drawTile(gl, e, oxWM, oyWM, now)) pending = true;
      }
    }
    if (this.uploading) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
      this.uploading = false;
    }
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
    if (now - this.lastSweep > (this.textures > MAX_GPU_TILES ? 250 : SWEEP_MS)) this.sweep(gl, now);
    return pending;
  }

  /** Upload if needed (within this frame's budget) and draw. False when it had to wait. */
  private drawTile(gl: WebGL2RenderingContext, e: TileTex, oxWM: number, oyWM: number, now: number): boolean {
    let done = true;
    if (e.stale || !e.tex) {
      if (this.stats.uploads < MAX_UPLOADS) this.upload(gl, e);
      else done = false;
    }
    if (!e.tex) return done;
    gl.bindTexture(gl.TEXTURE_2D, e.tex);
    gl.uniform4fv(this.prog!.u.u_rect, tileQuad(e.x, e.y, oxWM, oyWM, this.quad));
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    e.usedAt = now;
    this.stats.drawn++;
    return done;
  }

  private upload(gl: WebGL2RenderingContext, e: TileTex): void {
    if (!this.uploading) {
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.uploading = true;
    }
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) this.nb[(dy + 1) * 3 + dx + 1] = this.byId.get(tileId(e.x + dx, e.y + dy))?.data ?? null;
    }
    composeTileTexture(this.staging, this.nb);
    if (!e.tex) {
      e.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, SEEN_TEX, SEEN_TEX, 0, gl.RED, gl.UNSIGNED_BYTE, this.staging);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textures++;
    } else {
      gl.bindTexture(gl.TEXTURE_2D, e.tex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, SEEN_TEX, SEEN_TEX, gl.RED, gl.UNSIGNED_BYTE, this.staging);
    }
    gl.generateMipmap(gl.TEXTURE_2D);
    e.stale = false;
    this.stats.uploads++;
    this.stats.textures = this.textures;
  }

  private sweep(gl: WebGL2RenderingContext, now: number): void {
    this.lastSweep = now;
    const live: TileTex[] = [];
    for (const e of this.byId.values()) if (e.tex) live.push(e);
    for (const i of pickEvictions(live.map((e) => e.usedAt), now, MAX_GPU_TILES, IDLE_MS)) {
      gl.deleteTexture(live[i].tex);
      live[i].tex = null;
      live[i].stale = true;
      this.textures--;
    }
    this.stats.textures = this.textures;
  }

  private freeTexture(e: TileTex): void {
    if (!e.tex) return;
    if (this.gl && !this.gl.isContextLost()) this.gl.deleteTexture(e.tex);
    e.tex = null;
    this.textures--;
    this.stats.textures = this.textures;
  }

  private markNeighbours(e: TileTex, bits: number): void {
    if (!bits) return;
    for (let slot = 0; slot < 9; slot++) {
      if (slot === 4 || !(bits & (1 << slot))) continue;
      const n = this.byId.get(tileId(e.x + (slot % 3) - 1, e.y + Math.floor(slot / 3) - 1));
      if (n) n.stale = true;
    }
  }

  private ensure(gl: WebGL2RenderingContext): boolean {
    if (this.broken || gl.isContextLost()) return false;
    if (this.gl === gl && this.prog) return true;
    try {
      this.init(gl);
      return true;
    } catch (err) {
      console.error('Wanderlight: seen memory disabled', err);
      this.broken = true;
      return false;
    }
  }
}

// ---- Moonlit houses ----

/** Seconds a newly seen house takes to fade in (ease-out). */
export const MOON_FADE_S = 0.9;
/** Floats per roof vertex: x, y (local units), seed, time on (s). */
export const MOON_VERT_FLOATS = 4;
/** Floats per wall: the corner before, the wall's two ends, the corner after (local units), seed, time on. */
export const MOON_EDGE_FLOATS = 10;
/** Corners closer than this (WM units, ≈ 6 mm) are one corner: no zero-length walls. */
const SAME_CORNER = 0.01;
/** How far outward of a wall the light is read, CSS px: just past the wall, clear of its shadow. */
const LOOK_PX = 2;
/** A lit wall's outline is this much wider (CSS px), and throws a warm halo this wide onto the street. */
const GLOW_EXTRA_PX = 0.9;
const HALO_PX = 3;

/** A house outline ready to draw, in WM (float64). */
export interface MoonShape {
  /** Corners of the outer ring, then of each hole, without the closing corner. */
  xy: Float64Array;
  /**
   * Where each ring starts in `xy` (in corners), then the total. Rings are ordered so the building
   * lies on the (-dy, dx) side of every wall a→b (outer ring: positive ringArea2, holes negative):
   * (dy, -dx) points out of it, into the street or the courtyard.
   */
  rings: Uint32Array;
  /** Roof triangles (earcut), as corner indices. */
  tri: Uint32Array;
}

/**
 * Twice the signed area of a ring of flat x, y pairs, in its own units; positive when the ring
 * turns from +x towards +y (in WM, y south: clockwise on the map). Taken about the first corner
 * for precision.
 */
export function ringArea2(xy: ArrayLike<number>, from = 0, to = xy.length): number {
  const x0 = xy[from], y0 = xy[from + 1];
  let s = 0;
  for (let i = from + 2; i + 3 < to; i += 2) {
    s += (xy[i] - x0) * (xy[i + 3] - y0) - (xy[i + 2] - x0) * (xy[i + 1] - y0);
  }
  return s;
}

/** A lon/lat ring as WM corners, without the closing corner or repeated corners. */
function ringWM(flat: ArrayLike<number>): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < flat.length; i += 2) {
    const x = mercX(flat[i]) * C, y = mercY(flat[i + 1]) * C;
    const m = out.length;
    if (m >= 2 && Math.abs(x - out[m - 2]) < SAME_CORNER && Math.abs(y - out[m - 1]) < SAME_CORNER) continue;
    out.push(x, y);
  }
  while (out.length >= 4 && Math.abs(out[out.length - 2] - out[0]) < SAME_CORNER && Math.abs(out[out.length - 1] - out[1]) < SAME_CORNER) {
    out.length -= 2;
  }
  return out;
}

function reverseRing(r: number[]): void {
  for (let i = 0, j = r.length - 2; i < j; i += 2, j -= 2) {
    const x = r[i], y = r[i + 1];
    r[i] = r[j];
    r[i + 1] = r[j + 1];
    r[j] = x;
    r[j + 1] = y;
  }
}

/** A house (closed lon/lat rings) as a MoonShape, or null when it has no area. */
export function moonShape(house: { coords: ArrayLike<number>; holes?: ArrayLike<number>[] }): MoonShape | null {
  const xy = ringWM(house.coords);
  if (xy.length < 6) return null;
  if (ringArea2(xy) < 0) reverseRing(xy);
  const rings = [0], holes: number[] = [];
  for (const h of house.holes ?? []) {
    const r = ringWM(h);
    if (r.length < 6) continue;
    if (ringArea2(r) > 0) reverseRing(r);
    holes.push(xy.length / 2);
    rings.push(xy.length / 2);
    for (const v of r) xy.push(v);
  }
  rings.push(xy.length / 2);
  // Triangulate near zero, where float64 has digits to spare.
  const x0 = xy[0], y0 = xy[1];
  const tri = earcut(xy.map((v, i) => (i & 1 ? v - y0 : v - x0)), holes.length ? holes : undefined, 2);
  if (!tri.length) return null;
  return { xy: Float64Array.from(xy), rings: Uint32Array.from(rings), tri: Uint32Array.from(tri) };
}

/**
 * Roof vertices (MOON_VERT_FLOATS each) and triangles of a shape, relative to the origin (oxWM,
 * oyWM); indices start at `base`. Written from `verts[vAt]` and `index[iAt]`, which must hold
 * the shape.
 */
export function packFill(
  s: MoonShape, oxWM: number, oyWM: number, seed: number, tOn: number,
  verts: Float32Array, index: Uint32Array, base: number, vAt = 0, iAt = 0,
): void {
  const n = s.xy.length / 2;
  for (let i = 0, o = vAt; i < n; i++, o += MOON_VERT_FLOATS) {
    verts[o] = s.xy[2 * i] - oxWM;
    verts[o + 1] = s.xy[2 * i + 1] - oyWM;
    verts[o + 2] = seed;
    verts[o + 3] = tOn;
  }
  for (let k = 0; k < s.tri.length; k++) index[iAt + k] = base + s.tri[k];
}

/**
 * The walls of a shape as outline instances (MOON_EDGE_FLOATS each), relative to the origin:
 * p (corner before a), a, b (the wall), n (corner after b), seed, time on. Written from
 * `out[at]`; returns how many (one per corner).
 */
export function packEdges(
  s: MoonShape, oxWM: number, oyWM: number, seed: number, tOn: number, out: Float32Array, at = 0,
): number {
  const xy = s.xy;
  let o = at;
  for (let r = 0; r + 1 < s.rings.length; r++) {
    const first = s.rings[r], n = s.rings[r + 1] - first;
    for (let k = 0; k < n; k++) {
      // The corner before a, a, b, the corner after b: wrapping within the ring.
      for (let j = n - 1; j <= n + 2; j++) {
        const c = first + ((k + j) % n);
        out[o++] = xy[2 * c] - oxWM;
        out[o++] = xy[2 * c + 1] - oyWM;
      }
      out[o++] = seed;
      out[o++] = tOn;
    }
  }
  return (o - at) / MOON_EDGE_FLOATS;
}

/** Outline width, CSS px: 0.6 at z15 to 1.6 at z18, as the prototype's line layer. */
export function moonEdgePx(zoom: number): number {
  return 0.6 + Math.min(1, Math.max(0, (zoom - 15) / 3));
}

/** How far a house has faded in, 0..1, at page time `now` (ease-out over MOON_FADE_S). */
export function moonFade(tOn: number, now: number): number {
  const t = Math.min(1, Math.max(0, (now - tOn) / MOON_FADE_S));
  return 1 - (1 - t) * (1 - t);
}

const FADE_GLSL = MOON_FADE_S.toFixed(3);

export const MOON_FILL_VS = `#version 300 es
in vec2 a_pos;
in vec2 a_house;
uniform mat4 u_matrix;
flat out vec2 v_house;
void main() {
  v_house = a_house;
  gl_Position = u_matrix * vec4(a_pos, 0.0, 1.0);
}`;

export const MOON_FILL_FS = `#version 300 es
precision highp float;
flat in vec2 v_house;
uniform float u_time;
uniform vec3 u_fill;
uniform float u_alpha;
out vec4 o;
void main() {
  float t = clamp((u_time - v_house.y) / ${FADE_GLSL}, 0.0, 1.0);
  float a = u_alpha * (1.0 - (1.0 - t) * (1.0 - t));
  if (a <= 0.0) discard;
  // Neighbouring houses differ a little in tone, so a terrace reads as houses, not one slab.
  vec3 c = u_fill * (0.84 + 0.32 * fract(v_house.x * 0.7548776));
  o = vec4(c * a, a);
}`;

/**
 * One quad per wall, mitred at the corners so neighbouring walls meet without overlap (no
 * doubled alpha at corners); very sharp corners end square instead of spiking. Sizes in device px.
 */
export const MOON_EDGE_VS = `#version 300 es
in vec2 a_corner;
in vec4 i_pa;
in vec4 i_bn;
in vec2 i_house;
uniform mat4 u_matrix;
uniform float u_pxUnits;
uniform float u_inner;
uniform float u_outer;
uniform float u_lookPx;
out float v_across;
out vec4 v_look;
flat out vec2 v_house;
vec2 outward(vec2 d) {
  return vec2(d.y, -d.x) / max(length(d), 1e-6);
}
void main() {
  vec2 p = i_pa.xy, a = i_pa.zw, b = i_bn.xy, n = i_bn.zw;
  // No wall: a removed house's walls are zeroed until its chunk is compacted (and the space
  // between chunks is zero too). Collapse the quad off screen: nothing to rasterize.
  if (a == b) {
    v_across = 0.0;
    v_look = vec4(0.0);
    v_house = vec2(0.0);
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 dir = normalize(b - a);
  // Rings are ordered so this points out of the house (see MoonShape.rings).
  vec2 nrm = vec2(dir.y, -dir.x);
  bool atB = a_corner.x > 0.5;
  vec2 c = atB ? b : a;
  vec2 sum = nrm + (atB ? outward(n - b) : outward(a - p));
  float sl = length(sum);
  float k = sl > 1e-3 ? dot(sum, nrm) / sl : 0.0;
  // Out of the house the quad also holds the halo; into the roof only the line.
  float s = a_corner.y * (a_corner.y > 0.0 ? u_outer : u_inner);
  vec2 off = k > 0.3 ? sum * (s / (k * sl)) : nrm * s + dir * (atB ? abs(s) : -abs(s));
  vec2 pos = c + off * u_pxUnits;
  v_across = s;
  v_house = i_house;
  // Where this wall reads your light: a little outward of it.
  v_look = u_matrix * vec4(pos + nrm * (u_lookPx * u_pxUnits), 0.0, 1.0);
  gl_Position = u_matrix * vec4(pos, 0.0, 1.0);
}`;

export const MOON_EDGE_FS = `#version 300 es
precision highp float;
in float v_across;
in vec4 v_look;
flat in vec2 v_house;
uniform sampler2D u_mask;
uniform float u_useMask;
uniform float u_time;
uniform float u_width;
uniform float u_glowWidth;
uniform float u_halo;
uniform vec3 u_edge;
uniform float u_edgeAlpha;
uniform vec3 u_facade;
out vec4 o;
void main() {
  // Your light (lantern B, cone A) just outside the wall: lit in front of a wall that faces you,
  // dark behind a back wall, which sits in its own house's shadow.
  vec4 m = textureLod(u_mask, v_look.xy / v_look.w * 0.5 + 0.5, 0.0);
  float g = smoothstep(0.03, 0.7, max(m.b, m.a)) * u_useMask;
  float t = clamp((u_time - v_house.y) / ${FADE_GLSL}, 0.0, 1.0);
  float fade = 1.0 - (1.0 - t) * (1.0 - t);
  // A line thinner than a pixel is drawn a pixel wide and fainter, so it doesn't shimmer.
  float w = mix(u_width, u_glowWidth, g);
  float wd = max(w, 1.0);
  float line = clamp(wd * 0.5 + 0.5 - abs(v_across), 0.0, 1.0) * (w / wd) * mix(u_edgeAlpha, 1.0, g);
  // A lit wall throws a little warm light onto the street in front of it.
  float halo = g * 0.3 * smoothstep(-0.75, 0.75, v_across) * (1.0 - smoothstep(0.0, u_halo, v_across));
  vec3 c = mix(u_edge, u_facade, g * 0.85) * line + u_facade * halo * (1.0 - line);
  float a = (line + halo * (1.0 - line)) * fade;
  if (a <= 0.0) discard;
  o = vec4(c * fade, a);
}`;


// ---- Seen houses in chunks: culling, and removal that stays local ----

/**
 * Side of a chunk of seen houses, WM units (≈ 300 m at Amsterdam). A house belongs to the chunk
 * under the middle of its box; a chunk is what culling skips and what a compaction repacks.
 */
export const MOON_CHUNK_WM = 500;
/** Chunk key: column * CHUNK_ROWS + row, unique and exact in float64 over the whole world. */
const CHUNK_ROWS = 2 ** 17;
/**
 * How far past the view a chunk still draws, CSS px. A wall's quad reaches out of its house by
 * its halo (3 px and a device px), stretched by at most 1 / 0.3 at a mitred corner: under 14 px.
 */
export const MOON_CULL_PX = 16;
/** Up to this many chunks in view are sorted into runs; past it (zoomed out) one span draws them. */
const MAX_SORTED = 32;
/** Regions this close in a buffer draw as one run (indices; walls): skipping less isn't worth a draw call. */
const RUN_GAP_IDX = 12_288;
const RUN_GAP_WALLS = 4096;
/** A chunk is compacted once more than this share of it belongs to removed houses. */
const DEAD_SHARE = 1 / 3;
/**
 * Everything is repacked once garbage (removed houses' vertices; room left behind by chunks that
 * moved) outweighs what is live and passes this many elements (1 MB of floats).
 */
const MIN_GARBAGE = 1 << 18;
/** The least room a chunk gets in the index arena, and in the wall arena (in walls). */
const MIN_ROOM_IDX = 256;
const MIN_ROOM_WALLS = 64;
/** Changed ranges closer than this (elements) upload as one; past MAX_DIRTY ranges, all of it. */
const DIRTY_GAP = 1024;
const MAX_DIRTY = 32;

/** A chunk's part of an Arena, in elements: start, room, used, and used by removed houses (zero). */
export interface Region {
  start: number;
  cap: number;
  len: number;
  dead: number;
}

const region = (): Region => ({ start: 0, cap: 0, len: 0, dead: 0 });

/**
 * A typed array mirrored to one GPU buffer, cut into regions (one per chunk) with room to grow at
 * their end. Everything outside the houses in it is zero, which draws nothing (degenerate
 * triangles; walls the shader collapses), so one draw may run across neighbouring regions, room
 * and holes alike. Regions start and end on whole `unit`s (a triangle's 3 indices, a wall's
 * floats), so such a run stays in step. Keeps what changed since the last upload.
 */
export class Arena<T extends Float32Array | Uint32Array> {
  data: T;
  /** End of the last region. */
  end = 0;
  /** Elements in regions no chunk owns any more (left behind when one moved or emptied). */
  holes = 0;
  /** Ranges changed since the last upload: [lo, hi) pairs, nDirty numbers. */
  readonly dirty = new Float64Array(2 * MAX_DIRTY);
  nDirty = 0;
  /** Upload all of it, [0, end): it was reallocated, repacked, or changed in too many places. */
  whole = true;

  constructor(private make: (n: number) => T, private initial: number, readonly unit = 1) {
    this.data = make(initial);
  }

  /** Elements the next upload sends (a whole one also clears what a repack left past the end). */
  get toUpload(): number {
    if (this.whole) return this.end;
    let n = 0;
    for (let k = 0; k < this.nDirty; k += 2) n += this.dirty[k + 1] - this.dirty[k];
    return n;
  }

  /** Room for n elements: doubles when short (and then uploads whole). */
  ensure(n: number): void {
    if (n <= this.data.length) return;
    let cap = this.data.length * 2;
    while (cap < n) cap *= 2;
    const next = this.make(cap);
    next.set(this.data.subarray(0, this.end));
    this.data = next;
    this.whole = true;
  }

  /** [lo, hi) changed: upload it next time, with a changed range close by. */
  mark(lo: number, hi: number): void {
    if (this.whole || hi <= lo) return;
    const d = this.dirty;
    for (let k = 0; k < this.nDirty; k += 2) {
      if (lo <= d[k + 1] + DIRTY_GAP && hi + DIRTY_GAP >= d[k]) {
        if (lo < d[k]) d[k] = lo;
        if (hi > d[k + 1]) d[k + 1] = hi;
        return;
      }
    }
    if (this.nDirty === d.length) {
      this.whole = true;
      return;
    }
    d[this.nDirty++] = lo;
    d[this.nDirty++] = hi;
  }

  zero(lo: number, hi: number): void {
    if (hi <= lo) return;
    this.data.fill(0, lo, hi);
    this.mark(lo, hi);
  }

  /** `r` becomes a new, empty region of (at least) `cap` at the end. */
  alloc(r: Region, cap: number): void {
    cap = Math.ceil(cap / this.unit) * this.unit;
    this.ensure(this.end + cap);
    r.start = this.end;
    r.cap = cap;
    r.len = r.dead = 0;
    this.end += cap;
  }

  /**
   * Room in `r` for n more elements. A full region doubles (to `minRoom` at least): in place
   * when it is the last one, else it moves to the end and leaves zeros behind (a hole, reclaimed
   * by the next repack).
   */
  reserve(r: Region, n: number, minRoom: number): void {
    const need = r.len + n;
    if (need <= r.cap) return;
    let cap = Math.max(Math.ceil(minRoom / this.unit) * this.unit, r.cap * 2);
    while (cap < need) cap *= 2;
    if (r.cap && r.start + r.cap === this.end) {
      this.ensure(r.start + cap);
      this.end = r.start + cap;
      r.cap = cap;
      return;
    }
    const at = this.end;
    this.ensure(at + cap);
    this.end = at + cap;
    if (r.cap) {
      if (r.len) {
        this.data.copyWithin(at, r.start, r.start + r.len);
        this.mark(at, at + r.len);
        this.zero(r.start, r.start + r.len);
      }
      this.holes += r.cap;
    }
    r.start = at;
    r.cap = cap;
  }

  /** Give a region back: zeroed, and a hole unless it was the last one. */
  free(r: Region): void {
    if (r.cap) {
      this.zero(r.start, r.start + r.len);
      if (r.start + r.cap === this.end) this.end = r.start;
      else this.holes += r.cap;
    }
    r.start = r.cap = r.len = r.dead = 0;
  }

  /** Empty and all zero, with room for n (reallocated when short or far too big); uploads whole next. */
  reset(n: number): void {
    if (n > this.data.length || this.data.length > 4 * Math.max(n, this.initial)) {
      let cap = this.initial;
      while (cap < n + (n >> 2)) cap *= 2;
      this.data = this.make(cap);
    } else this.data.fill(0, 0, this.end);
    this.end = this.holes = this.nDirty = 0;
    this.whole = true;
  }

  /** The GPU has it all now. */
  flushed(): void {
    this.nDirty = 0;
    this.whole = false;
  }
}

/** A seen house. */
export interface MoonRec {
  id: string;
  /** Null for a house with no area: kept, so has() stays true and it isn't offered again. */
  shape: MoonShape | null;
  seed: number;
  tOn: number;
  /** WM box of the shape: west, north, east, south. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  chunk: MoonChunk | null;
  /** Its first vertex, and its triangles and walls as offsets into its chunk's regions; -1 until packed. */
  v0: number;
  iOff: number;
  eOff: number;
  /** Removed before it was packed: skip it. */
  gone: boolean;
}

/** The seen houses whose middle lies in one MOON_CHUNK_WM square. */
export interface MoonChunk {
  key: number;
  /** WM box of its packed houses (grows; a compaction shrinks it): west, north, east, south. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** Its roof triangles (index arena) and its walls (wall arena). */
  idx: Region;
  edge: Region;
  /** Its houses: the packed ones first, in the order they lie in its regions, then the waiting ones. */
  recs: Set<MoonRec>;
  /** Added since the last sync, to append. */
  pending: MoonRec[];
  /** In the sync queue; to compact then. */
  queued: boolean;
  compact: boolean;
}

/** What MoonHouses holds, and did in the last frame. */
export interface MoonStats {
  /** Houses kept, their walls, and their chunks. */
  houses: number;
  walls: number;
  chunks: number;
  /** Last frame: chunks in view, walls drawn (a run may span a few hidden or removed ones), draw calls, bytes uploaded. */
  visible: number;
  drawn: number;
  draws: number;
  uploaded: number;
  /** So far: full repacks (the origin moved, or garbage piled up), and chunk compactions. */
  rebuilds: number;
  compactions: number;
}

const grow = (c: MoonChunk, r: MoonRec): void => {
  if (r.x0 < c.x0) c.x0 = r.x0;
  if (r.y0 < c.y0) c.y0 = r.y0;
  if (r.x1 > c.x1) c.x1 = r.x1;
  if (r.y1 > c.y1) c.y1 = r.y1;
};

const littered = (garbage: number, all: number, min: number): boolean => garbage > min && garbage * 2 > all;

const idxOf = (c: MoonChunk): Region => c.idx;
const edgeOf = (c: MoonChunk): Region => c.edge;

/**
 * Draw runs [first, count] (in `unit`s) over the regions of chunks vis[0, n), merged where they lie
 * within `gap` elements of each other in the buffer: the zeros and off-screen houses between draw
 * nothing. Past MAX_SORTED chunks, one run from the first to the last. Sorts vis by region.
 */
function runs(vis: MoonChunk[], n: number, of: (c: MoonChunk) => Region, out: Int32Array, gap: number, unit: number): number {
  if (!n) return 0;
  if (n > MAX_SORTED) {
    let lo = Infinity, hi = 0;
    for (let k = 0; k < n; k++) {
      const r = of(vis[k]);
      if (r.start < lo) lo = r.start;
      if (r.start + r.len > hi) hi = r.start + r.len;
    }
    out[0] = lo / unit;
    out[1] = (hi - lo) / unit;
    return 2;
  }
  for (let k = 1; k < n; k++) {
    const c = vis[k], s = of(c).start;
    let j = k - 1;
    for (; j >= 0 && of(vis[j]).start > s; j--) vis[j + 1] = vis[j];
    vis[j + 1] = c;
  }
  let m = 0, r = of(vis[0]), lo = r.start, hi = r.start + r.len;
  for (let k = 1; k < n; k++) {
    r = of(vis[k]);
    if (r.start - hi <= gap) {
      if (r.start + r.len > hi) hi = r.start + r.len;
      continue;
    }
    out[m++] = lo / unit;
    out[m++] = (hi - lo) / unit;
    lo = r.start;
    hi = r.start + r.len;
  }
  out[m++] = lo / unit;
  out[m++] = (hi - lo) / unit;
  return m;
}

/**
 * The WM box [west, north, east, south] that holds the screen for `matrix` (local units → clip,
 * the local origin at oxWM, oyWM): where the four clip corners land on the map's plane, through
 * the full inverse (z = 0 maps to the screen by a 3×3 projective map, so a tilt is fine). False
 * when a corner lies on or past the horizon, or the matrix is singular: draw everything then.
 */
export function viewFromMatrix(m: ArrayLike<number>, oxWM: number, oyWM: number, out: Float64Array): boolean {
  // Clip x, y and w of the point (x, y, 0, 1) are the rows of [m0 m4 m12; m1 m5 m13; m3 m7 m15].
  const a = m[0], b = m[4], c = m[12];
  const d = m[1], e = m[5], f = m[13];
  const g = m[3], h = m[7], i = m[15];
  // Its inverse times det (the adjugate): the factor cancels, but for its sign.
  const A = e * i - f * h, B = c * h - b * i, Cc = b * f - c * e;
  const D = f * g - d * i, E = a * i - c * g, F = c * d - a * f;
  const G = d * h - e * g, H = b * g - a * h, I = a * e - b * d;
  const det = a * A + b * D + c * G;
  if (!(Math.abs(det) > 0)) return false;
  let w = Infinity, n = Infinity, ea = -Infinity, s = -Infinity;
  for (let k = 0; k < 4; k++) {
    const cx = k & 1 ? 1 : -1, cy = k & 2 ? 1 : -1;
    const q = G * cx + H * cy + I;
    // The corner's ground point has clip w = det / q: it is in front of the eye only when that is positive.
    if (!(q / det > 0)) return false;
    const x = (A * cx + B * cy + Cc) / q, y = (D * cx + E * cy + F) / q;
    if (x < w) w = x;
    if (x > ea) ea = x;
    if (y < n) n = y;
    if (y > s) s = y;
  }
  if (!Number.isFinite(w + n + ea + s)) return false;
  out[0] = w + oxWM;
  out[1] = n + oyWM;
  out[2] = ea + oxWM;
  out[3] = s + oyWM;
  return true;
}

/**
 * The CPU side of MoonHouses, with no WebGL: the seen houses as float32 (relative to the fog
 * origin) in three arenas: roof vertices (appended), roof triangles and wall instances (a region
 * per chunk). Houses are bucketed into MOON_CHUNK_WM squares, so a frame draws only the chunks in
 * view, and a change stays within its chunk:
 *
 * - add() queues a house; sync() appends it to its chunk's regions (a full one doubles).
 * - remove() zeroes the house's triangles and walls where they lie (a tombstone: degenerate
 *   triangles, walls the shader collapses); sync() compacts the chunk once a third of it is dead.
 * - An origin change, or garbage outweighing what is live, repacks everything (rare), laying the
 *   chunks out in key order so that neighbours on the map are mostly neighbours in the buffers.
 */
export class MoonPack {
  readonly verts = new Arena<Float32Array>((n) => new Float32Array(n), MOON_VERT_FLOATS * 4096, MOON_VERT_FLOATS);
  readonly index = new Arena<Uint32Array>((n) => new Uint32Array(n), 8192, 3);
  readonly edges = new Arena<Float32Array>((n) => new Float32Array(n), MOON_EDGE_FLOATS * 4096, MOON_EDGE_FLOATS);
  /** The chunks; one emptied goes at the next sync. */
  readonly chunks: MoonChunk[] = [];
  /** select()'s draw runs, [first, count] pairs: roof indices, and wall instances. */
  readonly fillRuns = new Int32Array(2 * MAX_SORTED);
  readonly edgeRuns = new Int32Array(2 * MAX_SORTED);
  nFill = 0;
  nEdge = 0;
  /** The origin the arenas are relative to, WM. */
  oxWM = NaN;
  oyWM = NaN;
  readonly stats: MoonStats = {
    houses: 0, walls: 0, chunks: 0, visible: 0, drawn: 0, draws: 0, uploaded: 0, rebuilds: 0, compactions: 0,
  };

  private recs = new Map<string, MoonRec>();
  private byKey = new Map<number, MoonChunk>();
  private todo: MoonChunk[] = [];
  private rebuild = true;
  /** Vertex floats of removed houses: still in the vertex arena, no longer referenced. */
  private deadVerts = 0;
  private vis: MoonChunk[] = [];

  /** `minGarbage`: elements of garbage tolerated before a repack, whatever the share (tests lower it). */
  constructor(private minGarbage = MIN_GARBAGE) {}

  add(house: { id: string; coords: ArrayLike<number>; holes?: ArrayLike<number>[] }, tOn: number): void {
    if (this.recs.has(house.id)) return;
    const shape = moonShape(house);
    const r: MoonRec = {
      id: house.id, shape, seed: houseSeed(house.id), tOn,
      x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity,
      chunk: null, v0: -1, iOff: -1, eOff: -1, gone: false,
    };
    this.recs.set(r.id, r);
    this.stats.houses = this.recs.size;
    if (!shape) return;
    const xy = shape.xy;
    for (let i = 0; i < xy.length; i += 2) {
      if (xy[i] < r.x0) r.x0 = xy[i];
      if (xy[i] > r.x1) r.x1 = xy[i];
      if (xy[i + 1] < r.y0) r.y0 = xy[i + 1];
      if (xy[i + 1] > r.y1) r.y1 = xy[i + 1];
    }
    const c = this.chunkAt((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
    r.chunk = c;
    c.recs.add(r);
    c.pending.push(r);
    this.queue(c);
    this.stats.walls += xy.length / 2;
  }

  /** Tombstone a house: its triangles and walls are zeroed in place (the CPU copy now, the GPU's at the next upload). */
  remove(id: string): void {
    const r = this.recs.get(id);
    if (!r) return;
    this.recs.delete(id);
    this.stats.houses = this.recs.size;
    const c = r.chunk, s = r.shape;
    if (!c || !s) return;
    r.chunk = null;
    c.recs.delete(r);
    const corners = s.xy.length / 2;
    this.stats.walls -= corners;
    if (r.iOff < 0) {
      // Not packed yet (its chunk is queued): the sync skips it.
      r.gone = true;
      return;
    }
    const i = c.idx.start + r.iOff, e = c.edge.start + r.eOff;
    const iN = s.tri.length, eN = corners * MOON_EDGE_FLOATS;
    this.index.zero(i, i + iN);
    this.edges.zero(e, e + eN);
    c.idx.dead += iN;
    c.edge.dead += eN;
    this.deadVerts += corners * MOON_VERT_FLOATS;
    if (c.idx.dead > c.idx.len * DEAD_SHARE || c.edge.dead > c.edge.len * DEAD_SHARE) {
      c.compact = true;
      this.queue(c);
    }
  }

  has(id: string): boolean {
    return this.recs.has(id);
  }

  clear(): void {
    this.recs.clear();
    this.byKey.clear();
    this.chunks.length = 0;
    this.todo.length = 0;
    this.rebuild = true;
    this.stats.houses = this.stats.walls = this.stats.chunks = 0;
  }

  /** Bring the arenas up to date with the houses and the origin (WM). Only queued chunks cost anything. */
  sync(oxWM: number, oyWM: number): void {
    const v = this.verts, g = this.minGarbage;
    if (
      this.rebuild || oxWM !== this.oxWM || oyWM !== this.oyWM || littered(this.deadVerts, v.end, g) ||
      littered(this.index.holes, this.index.end, g) || littered(this.edges.holes, this.edges.end, g)
    ) {
      this.repack(oxWM, oyWM);
      return;
    }
    if (!this.todo.length) return;
    for (let k = 0; k < this.todo.length; k++) {
      const c = this.todo[k];
      c.queued = false;
      if (c.compact) this.compact(c);
      this.append(c);
    }
    this.todo.length = 0;
  }

  /**
   * What a frame draws: the chunks whose box meets `view` (WM [west, north, east, south], or null
   * for all of them) widened by `margin` WM units, as runs in fillRuns and edgeRuns.
   */
  select(view: ArrayLike<number> | null, margin: number): void {
    const vis = this.vis, chunks = this.chunks;
    let n = 0;
    for (let k = 0; k < chunks.length; k++) {
      const c = chunks[k];
      if (!c.edge.len) continue;
      if (view && (c.x1 < view[0] - margin || c.x0 > view[2] + margin || c.y1 < view[1] - margin || c.y0 > view[3] + margin)) continue;
      vis[n++] = c;
    }
    this.nFill = runs(vis, n, idxOf, this.fillRuns, RUN_GAP_IDX, 1);
    this.nEdge = runs(vis, n, edgeOf, this.edgeRuns, RUN_GAP_WALLS * MOON_EDGE_FLOATS, MOON_EDGE_FLOATS);
    let drawn = 0;
    for (let k = 1; k < this.nEdge; k += 2) drawn += this.edgeRuns[k];
    this.stats.visible = n;
    this.stats.drawn = drawn;
  }

  private chunkAt(x: number, y: number): MoonChunk {
    const key = Math.floor(x / MOON_CHUNK_WM) * CHUNK_ROWS + Math.floor(y / MOON_CHUNK_WM);
    let c = this.byKey.get(key);
    if (!c) {
      c = {
        key, x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity, idx: region(), edge: region(),
        recs: new Set(), pending: [], queued: false, compact: false,
      };
      this.byKey.set(key, c);
      this.chunks.push(c);
      this.stats.chunks = this.chunks.length;
    }
    return c;
  }

  private queue(c: MoonChunk): void {
    if (c.queued) return;
    c.queued = true;
    this.todo.push(c);
  }

  /** Pack a house at the end of its chunk's regions, which have room for it. */
  private put(c: MoonChunk, r: MoonRec): void {
    const s = r.shape!, n = s.xy.length / 2, v = this.verts, vAt = v.end;
    const i = c.idx.start + c.idx.len, e = c.edge.start + c.edge.len;
    const iN = s.tri.length, eN = n * MOON_EDGE_FLOATS;
    r.v0 = vAt / MOON_VERT_FLOATS;
    r.iOff = c.idx.len;
    r.eOff = c.edge.len;
    packFill(s, this.oxWM, this.oyWM, r.seed, r.tOn, v.data, this.index.data, r.v0, vAt, i);
    packEdges(s, this.oxWM, this.oyWM, r.seed, r.tOn, this.edges.data, e);
    v.end += n * MOON_VERT_FLOATS;
    c.idx.len += iN;
    c.edge.len += eN;
    v.mark(vAt, v.end);
    this.index.mark(i, i + iN);
    this.edges.mark(e, e + eN);
    grow(c, r);
  }

  /** Pack a chunk's waiting houses after its others; drop it once it has none. */
  private append(c: MoonChunk): void {
    if (!c.recs.size) {
      this.drop(c);
      return;
    }
    const p = c.pending;
    let nI = 0, nE = 0, nV = 0;
    for (let k = 0; k < p.length; k++) {
      if (p[k].gone) continue;
      const s = p[k].shape!, n = s.xy.length / 2;
      nI += s.tri.length;
      nE += n * MOON_EDGE_FLOATS;
      nV += n * MOON_VERT_FLOATS;
    }
    if (nE) {
      this.index.reserve(c.idx, nI, MIN_ROOM_IDX);
      this.edges.reserve(c.edge, nE, MIN_ROOM_WALLS * MOON_EDGE_FLOATS);
      this.verts.ensure(this.verts.end + nV);
      for (let k = 0; k < p.length; k++) if (!p[k].gone) this.put(c, p[k]);
    }
    p.length = 0;
  }

  /** Close the gaps removed houses left in a chunk: its houses keep their order and their vertices. */
  private compact(c: MoonChunk): void {
    c.compact = false;
    if (!c.recs.size) {
      this.drop(c);
      return;
    }
    this.stats.compactions++;
    const I = this.index.data, E = this.edges.data, i0 = c.idx.start, e0 = c.edge.start;
    let i = 0, e = 0;
    c.x0 = c.y0 = Infinity;
    c.x1 = c.y1 = -Infinity;
    // Packed houses come first in c.recs, in region order, so every copy moves down.
    for (const r of c.recs) {
      if (r.iOff < 0) break;
      const s = r.shape!, iN = s.tri.length, eN = (s.xy.length / 2) * MOON_EDGE_FLOATS;
      if (r.iOff !== i) I.copyWithin(i0 + i, i0 + r.iOff, i0 + r.iOff + iN);
      if (r.eOff !== e) E.copyWithin(e0 + e, e0 + r.eOff, e0 + r.eOff + eN);
      r.iOff = i;
      r.eOff = e;
      i += iN;
      e += eN;
      grow(c, r);
    }
    this.index.mark(i0, i0 + i);
    this.index.zero(i0 + i, i0 + c.idx.len);
    this.edges.mark(e0, e0 + e);
    this.edges.zero(e0 + e, e0 + c.edge.len);
    c.idx.len = i;
    c.edge.len = e;
    c.idx.dead = c.edge.dead = 0;
  }

  private drop(c: MoonChunk): void {
    if (this.byKey.get(c.key) !== c) return;
    this.byKey.delete(c.key);
    this.chunks.splice(this.chunks.indexOf(c), 1);
    this.index.free(c.idx);
    this.edges.free(c.edge);
    c.pending.length = 0;
    this.stats.chunks = this.chunks.length;
  }

  /** Everything anew, relative to a new origin: chunks in key order, each with a quarter more room. */
  private repack(oxWM: number, oyWM: number): void {
    this.oxWM = oxWM;
    this.oyWM = oyWM;
    this.rebuild = false;
    this.stats.rebuilds++;
    const chunks = this.chunks;
    let m = 0;
    for (const c of chunks) {
      if (c.recs.size) chunks[m++] = c;
      else this.byKey.delete(c.key);
    }
    chunks.length = m;
    // Key order runs down each column of chunks, west to east: a view's chunks lie mostly together.
    chunks.sort((a, b) => a.key - b.key);
    let nV = 0, nI = 0, nE = 0;
    for (const c of chunks) {
      let i = 0, walls = 0;
      for (const r of c.recs) {
        const s = r.shape!;
        i += s.tri.length;
        walls += s.xy.length / 2;
      }
      nV += walls * MOON_VERT_FLOATS;
      // Rooms for now (alloc() below takes them, rounded to whole triangles).
      c.idx.cap = 3 * Math.ceil((i + Math.max(MIN_ROOM_IDX, i >> 2)) / 3);
      c.edge.cap = (walls + Math.max(MIN_ROOM_WALLS, walls >> 2)) * MOON_EDGE_FLOATS;
      nI += c.idx.cap;
      nE += c.edge.cap;
    }
    this.verts.reset(nV);
    this.index.reset(nI);
    this.edges.reset(nE);
    for (const c of chunks) {
      this.index.alloc(c.idx, c.idx.cap);
      this.edges.alloc(c.edge, c.edge.cap);
      c.pending.length = 0;
      c.queued = c.compact = false;
      c.x0 = c.y0 = Infinity;
      c.x1 = c.y1 = -Infinity;
      for (const r of c.recs) this.put(c, r);
    }
    this.todo.length = 0;
    this.deadVerts = 0;
    this.stats.chunks = chunks.length;
  }
}

/**
 * The houses you have seen, drawn over the fog. Records stay in WM (float64); the float32 buffers
 * (relative to the fog origin) follow on the next draw, chunk by chunk (see MoonPack): a frame
 * draws only the chunks in view, new houses append to their chunk, removed ones (in bursts, while
 * walking) are zeroed in place and their chunk compacted now and then, and only what changed is
 * uploaded. An origin change repacks everything once.
 */
export class MoonHouses {
  private pack = new MoonPack();
  /** The view, WM, when read off the matrix. */
  private viewWM = new Float64Array(4);

  private gl: WebGL2RenderingContext | null = null;
  private progs: Record<'fill' | 'edge', Program> | null = null;
  private vaoFill: WebGLVertexArrayObject | null = null;
  private vaoEdge: WebGLVertexArrayObject | null = null;
  /**
   * GPU buffers of the vertex, index and wall arenas: their size (elements, as their arena's
   * array), and how far they may hold anything but zeros (past it they are as WebGL made them: 0).
   */
  private bufs: (WebGLBuffer | null)[] = [null, null, null];
  private gpuLen = new Float64Array(3);
  private gpuEnd = new Float64Array(3);
  private broken = false;
  private col: Record<'fill' | 'edge' | 'facade', [number, number, number]>;

  readonly stats: MoonStats = this.pack.stats;

  constructor(private theme: Theme = nightTheme) {
    const s = theme.seen;
    this.col = { fill: hex3(s.fill), edge: hex3(s.edge), facade: hex3(s.facade) };
  }

  /** A house you have seen: `coords` a closed lon/lat outer ring; it fades in from page time `tOn`. */
  add(house: { id: string; coords: ArrayLike<number>; holes?: ArrayLike<number>[] }, tOn: number): void {
    this.pack.add(house, tOn);
  }

  /** A seen house no longer drawn here (it got lit, and the fog draws it gold). */
  remove(id: string): void {
    this.pack.remove(id);
  }

  has(id: string): boolean {
    return this.pack.has(id);
  }

  clear(): void {
    this.pack.clear();
  }

  /** GL objects. Safe to call again: after release() (a lost context) it builds them anew. */
  init(gl: WebGL2RenderingContext): void {
    if (this.gl === gl && this.progs) return;
    this.release();
    this.progs = {
      fill: program(gl, MOON_FILL_VS, MOON_FILL_FS, ['a_pos', 'a_house']),
      edge: program(gl, MOON_EDGE_VS, MOON_EDGE_FS, ['a_corner', 'i_pa', 'i_bn', 'i_house']),
    };
    const vb = gl.createBuffer(), ib = gl.createBuffer(), eb = gl.createBuffer();
    this.bufs = [vb, ib, eb];

    this.vaoFill = gl.createVertexArray();
    gl.bindVertexArray(this.vaoFill);
    gl.bindBuffer(gl.ARRAY_BUFFER, vb);
    const vs = MOON_VERT_FLOATS * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, vs, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, vs, 8);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);

    this.vaoEdge = gl.createVertexArray();
    gl.bindVertexArray(this.vaoEdge);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    // The wall attributes point at each run's first wall when it draws (WebGL2 has no base instance).
    gl.bindBuffer(gl.ARRAY_BUFFER, eb);
    const es = MOON_EDGE_FLOATS * 4;
    for (const [loc, size, off] of [[1, 4, 0], [2, 4, 16], [3, 2, 32]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, es, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
    this.gpuLen.fill(0);
    this.gpuEnd.fill(0);
    this.gl = gl;
  }

  /** Forget every GL object without deleting it (the context is gone); buffers upload again later. */
  release(): void {
    this.gl = null;
    this.progs = null;
    this.vaoFill = this.vaoEdge = null;
    this.bufs = [null, null, null];
    this.gpuLen.fill(0);
    this.gpuEnd.fill(0);
  }

  /**
   * Draw the seen houses in view on screen, after the fog composite, with blending already
   * ONE, ONE_MINUS_SRC_ALPHA (premultiplied) and the drawing buffer's viewport.
   *
   * - `matrix`: local units → clip (FogLayer frame().matrix);
   * - `ox, oy`: the fog origin, MapLibre mercator 0..1 (frame().o.ox / .oy);
   * - `time`: page seconds (pageTime()), the clock of add()'s `tOn`;
   * - `cssPxUnits`: local units per CSS px (frame().cssPxUnits); the zoom is read from it;
   * - `dpr`: device px per CSS px (frame().dpr);
   * - `mask`: the fog's half-resolution mask after shadows (B lantern, A cone), drawn with the
   *   same matrix; null for no facade glow;
   * - `view`: optional, the view in WM [west, north, east, south]; read off `matrix` when absent.
   *
   * Disables face culling, uses texture unit 0 (left active, with nothing bound) and unbinds its
   * VAO; leaves blending as it is. With nothing in view it draws nothing and only unbinds its VAO.
   */
  draw(
    gl: WebGL2RenderingContext, matrix: Float32Array, ox: number, oy: number, time: number,
    cssPxUnits: number, dpr: number, mask: WebGLTexture | null, view?: ArrayLike<number>,
  ): void {
    const st = this.stats;
    st.visible = st.drawn = st.draws = st.uploaded = 0;
    if (!this.ensure(gl)) return;
    const pack = this.pack, oxWM = ox * C, oyWM = oy * C;
    pack.sync(oxWM, oyWM);
    if (!pack.chunks.length) return;
    // Upload what changed (the index buffer belongs to the fill VAO: bind it first).
    gl.bindVertexArray(this.vaoFill);
    this.upload(gl, gl.ARRAY_BUFFER, pack.verts, 0);
    this.upload(gl, gl.ELEMENT_ARRAY_BUFFER, pack.index, 1);
    this.upload(gl, gl.ARRAY_BUFFER, pack.edges, 2);
    pack.select(view ?? (viewFromMatrix(matrix, oxWM, oyWM, this.viewWM) ? this.viewWM : null), MOON_CULL_PX * cssPxUnits);
    if (!pack.nEdge) {
      gl.bindVertexArray(null);
      return;
    }
    const { fill, edge } = this.progs!;
    const s = this.theme.seen;
    // Windings vary (and the map flips y): nothing may be culled.
    gl.disable(gl.CULL_FACE);

    gl.useProgram(fill.p);
    gl.uniformMatrix4fv(fill.u.u_matrix, false, matrix);
    gl.uniform1f(fill.u.u_time, time);
    gl.uniform3fv(fill.u.u_fill, this.col.fill);
    gl.uniform1f(fill.u.u_alpha, s.fillOpacity);
    const fr = pack.fillRuns;
    for (let k = 0; k < pack.nFill; k += 2) gl.drawElements(gl.TRIANGLES, fr[k + 1], gl.UNSIGNED_INT, fr[k] * 4);

    const zoom = Math.log2(C / (512 * cssPxUnits));
    const width = moonEdgePx(zoom) * dpr;
    const glow = width + GLOW_EXTRA_PX * dpr;
    const halo = HALO_PX * dpr;
    gl.useProgram(edge.p);
    gl.bindVertexArray(this.vaoEdge);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, mask);
    const u = edge.u;
    gl.uniform1i(u.u_mask, 0);
    gl.uniform1f(u.u_useMask, mask ? 1 : 0);
    gl.uniformMatrix4fv(u.u_matrix, false, matrix);
    gl.uniform1f(u.u_pxUnits, cssPxUnits / dpr);
    gl.uniform1f(u.u_inner, glow * 0.5 + 1);
    gl.uniform1f(u.u_outer, Math.max(glow * 0.5, halo) + 1);
    gl.uniform1f(u.u_lookPx, LOOK_PX * dpr);
    gl.uniform1f(u.u_time, time);
    gl.uniform1f(u.u_width, width);
    gl.uniform1f(u.u_glowWidth, glow);
    gl.uniform1f(u.u_halo, halo);
    gl.uniform3fv(u.u_edge, this.col.edge);
    gl.uniform1f(u.u_edgeAlpha, s.edgeOpacity);
    gl.uniform3fv(u.u_facade, this.col.facade);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bufs[2]);
    const er = pack.edgeRuns, es = MOON_EDGE_FLOATS * 4;
    for (let k = 0; k < pack.nEdge; k += 2) {
      const at = er[k] * es;
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, es, at);
      gl.vertexAttribPointer(2, 4, gl.FLOAT, false, es, at + 16);
      gl.vertexAttribPointer(3, 2, gl.FLOAT, false, es, at + 32);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, er[k + 1]);
    }
    st.draws = (pack.nFill + pack.nEdge) / 2;
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindVertexArray(null);
  }

  /**
   * Send an arena's changes to its buffer k (bound to `target` here). The buffer is as big as
   * the arena's array and must match it everywhere a run may reach: a new one (WebGL zeroes it)
   * gets [0, end); a repack rewrites [0, end) and zeroes what it left past the end.
   */
  private upload(gl: WebGL2RenderingContext, target: number, a: Arena<Float32Array | Uint32Array>, k: number): void {
    const len = a.data.length;
    if (!a.whole && !a.nDirty && this.gpuLen[k] === len) return;
    gl.bindBuffer(target, this.bufs[k]);
    if (this.gpuLen[k] !== len) {
      gl.bufferData(target, len * 4, gl.DYNAMIC_DRAW);
      this.gpuLen[k] = len;
      this.gpuEnd[k] = 0;
      this.send(gl, target, a, 0, a.end);
      this.gpuEnd[k] = a.end;
    } else if (a.whole) {
      this.send(gl, target, a, 0, Math.max(a.end, this.gpuEnd[k]));
      this.gpuEnd[k] = a.end;
    } else {
      for (let j = 0; j < a.nDirty; j += 2) this.send(gl, target, a, a.dirty[j], a.dirty[j + 1]);
      this.gpuEnd[k] = Math.max(this.gpuEnd[k], a.end);
    }
    a.flushed();
  }

  private send(gl: WebGL2RenderingContext, target: number, a: Arena<Float32Array | Uint32Array>, lo: number, hi: number): void {
    if (hi <= lo) return;
    gl.bufferSubData(target, lo * 4, a.data, lo, hi - lo);
    this.stats.uploaded += (hi - lo) * 4;
  }

  private ensure(gl: WebGL2RenderingContext): boolean {
    if (this.broken || gl.isContextLost()) return false;
    if (this.gl === gl && this.progs) return true;
    try {
      this.init(gl);
      return true;
    } catch (err) {
      console.error('Wanderlight: seen houses disabled', err);
      this.broken = true;
      return false;
    }
  }
}
