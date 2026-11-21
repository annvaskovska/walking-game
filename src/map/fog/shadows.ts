import { EARTH_CIRCUMFERENCE_M, program, type Program } from '../gl';

/**
 * Your light stops at walls: line-of-sight shadows on the GPU, drawn by the fog into its mask
 * right after the lamp. Every wall that faces the light casts a wedge (one instanced quad per
 * wall), and the wedge multiplies the lantern channels (B, A) of the mask down to dark.
 *
 * The look follows the prototype (variant C): light pools in the street, stops at the houses and
 * spills through the gaps between them. A wall's own line stays lit (the shadow starts a step
 * behind it) so the facades facing you catch the light. Where a wall is the outline of its house
 * as the light sees it (a silhouette corner: the next wall turns away) the shadow's side is soft,
 * like the shadow of a lamp of radius `softness`: sharp at the corner, widening behind it, and
 * opening outwards only (the wedge itself is always fully dark, so no light slips between two
 * houses that touch). Where two walls that both face the light meet, the side is a hard cut that
 * both wedges work out from the very same numbers, so they join without a seam.
 *
 * All the maths runs in "local units" relative to the light (small numbers, float32-safe); the
 * walls are packed relative to the fog's origin and re-packed when it moves.
 */

/** The walls the shadows read: the part of core/occluders.ts `Occluders` used here. */
interface Occluders {
  /** Per wall, 8 float64s in WM: ax, ay, bx, by, px, py (corner before a), nx, ny (corner after b). */
  edges: Float64Array;
  n: number;
  /** Bumped whenever the walls change. */
  version: number;
}

/** Floats per wall, packed and in `Occluders.edges`. */
export const EDGE_FLOATS = 8;

/** A wall's own line stays lit: the shadow starts this far behind it (along the light's ray)… */
export const WALL_LIT_M = 0.3;
/** …and is full this far behind it. */
export const WALL_DARK_M = 0.8;
/** Width of a soft shadow side right at its corner (half-width, m), so it never aliases to a line. */
export const APEX_M = 0.1;
/** How far the hard sides of two neighbouring wedges overlap (m), so no pixel falls between them. */
export const SEAM_M = 0.02;
/** A penumbra never opens wider than this half-angle (rad), however close the light is. */
export const MAX_HALF_ANGLE = 0.5;

/**
 * Walls (WM, float64) as float32 instance data in local units around the fog origin (WM):
 * a, b, prev, next per wall, each minus (ox, oy). Writes into `out` when it is big enough.
 */
export function packEdges(edges: ArrayLike<number>, n: number, ox: number, oy: number, out?: Float32Array): Float32Array {
  const len = n * EDGE_FLOATS;
  const o = out && out.length >= len ? out : new Float32Array(len);
  for (let i = 0; i < len; i += 2) {
    o[i] = edges[i] - ox;
    o[i + 1] = edges[i + 1] - oy;
  }
  return o;
}

/** Local units per ground metre at the latitude of a WM y (1 / cos(lat), from the mercator y). */
export const m2uAtWmY = (y: number): number => Math.cosh((0.5 - y / EARTH_CIRCUMFERENCE_M) * 2 * Math.PI);

/**
 * The wedge of one wall. Inputs are light-relative: the light sits at (0, 0).
 *
 * - `lit(x, y)`: does the light see the outside of wall x→y? Every wall calls it for itself and
 *   for both neighbours with the same numbers, so neighbours agree on every corner.
 * - A corner is soft when the neighbouring wall there does not face the light. A neighbour of
 *   zero length (no corner known) counts as a continuation: hard.
 * - The quad covers everything the shadow can darken inside the reach: the wall, the two rays from
 *   the light past its ends (each penumbra's outer edge where soft), out to the reach circle.
 *   Narrow wedges get a trapezoid along those rays; wide ones (the light right at the wall) the
 *   box around what the circle leaves of them.
 */
export const SHADOW_VS = `#version 300 es
precision highp float;
in vec2 a_corner;
in vec4 i_ab;
in vec4 i_pn;
uniform mat4 u_matrix;
uniform vec2 u_light;
uniform float u_reach;
uniform float u_soft;
uniform float u_apex;
uniform float u_seam;
out vec2 v_p;
flat out vec4 v_u;
flat out vec4 v_k;
flat out vec3 v_n;
const float MAX_SIN = ${Math.sin(MAX_HALF_ANGLE).toFixed(7)};
float cr(vec2 u, vec2 v) { return u.x * v.y - u.y * v.x; }
bool lit(vec2 x, vec2 y) { return cr(y - x, -x) < 0.0; }
// Where the ray o + s d (|d| = 1, s >= 0) leaves the reach circle, if it does.
bool leaves(vec2 o, vec2 d, float r, out vec2 e) {
  float b = dot(o, d), q = b * b - dot(o, o) + r * r;
  float s = -b + sqrt(max(q, 0.0));
  e = o + d * s;
  return q >= 0.0 && s >= 0.0;
}
void main() {
  vec2 A = i_ab.xy - u_light, B = i_ab.zw - u_light;
  vec2 P = i_pn.xy - u_light, N = i_pn.zw - u_light;
  vec2 ab = B - A;
  float l2 = dot(ab, ab);
  float t = clamp(-dot(A, ab) / max(l2, 1e-20), 0.0, 1.0);
  v_p = vec2(0.0);
  v_u = vec4(0.0);
  v_k = vec4(0.0);
  v_n = vec3(0.0);
  if (!lit(A, B) || length(A + ab * t) > u_reach) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float la = length(A), lb = length(B);
  vec2 ua = A / la, ub = B / lb;
  vec2 tw = ab * inversesqrt(l2);
  vec2 n = vec2(-tw.y, tw.x);
  vec2 pa = A - P, bn = N - B;
  bool softA = dot(pa, pa) > 0.0 && !lit(P, A);
  bool softB = dot(bn, bn) > 0.0 && !lit(B, N);
  float sa = softA ? min(u_soft / la, MAX_SIN) : 0.0;
  float sb = softB ? min(u_soft / lb, MAX_SIN) : 0.0;
  float ca = sqrt(1.0 - sa * sa), cb = sqrt(1.0 - sb * sb);
  // Normals of the two rays pointing away from the shadow, and the penumbrae's outer edges.
  vec2 oa = vec2(-ua.y, ua.x), ob = vec2(ub.y, -ub.x);
  vec2 da = ua * ca + oa * sa, db = ub * cb + ob * sb;
  vec2 Oa = A + oa * ((softA ? u_apex : 0.0) + 2.0 * u_seam);
  vec2 Ob = B + ob * ((softB ? u_apex : 0.0) + 2.0 * u_seam);

  // The wedge's frame: m down its middle, mx across it towards b.
  float R = u_reach;
  vec2 m = ua + ub;
  float ml = length(m);
  m = ml > 1e-3 ? m / ml : n;
  vec2 mx = vec2(m.y, -m.x);
  float ya = dot(da, m), yb = dot(db, m);
  float y0 = min(min(dot(A, m), dot(B, m)), min(dot(Oa, m), dot(Ob, m)));
  bool right = a_corner.x > 0.0, far = a_corner.y > 0.0;
  vec2 q;
  if (min(ya, yb) >= 0.5) {
    // Trapezoid between the outer rays, from the wall to the tangent of the reach circle. Before
    // its corner a penumbra's edge runs along the hard ray instead, so each side takes the outer
    // of the two lines at both ends.
    float ka = dot(da, mx) / ya, kb = dot(db, mx) / yb;
    float ha = dot(ua, mx) / dot(ua, m), hb = dot(ub, mx) / dot(ub, m);
    float xa = dot(Oa, mx), xb = dot(Ob, mx), ga0 = y0 - dot(Oa, m), gb0 = y0 - dot(Ob, m);
    float ga1 = R - dot(Oa, m), gb1 = R - dot(Ob, m);
    float xa0 = xa + min(ga0 * ka, ga0 * ha), xb0 = xb + max(gb0 * kb, gb0 * hb);
    float xa1 = xa + min(ga1 * ka, ga1 * ha), xb1 = xb + max(gb1 * kb, gb1 * hb);
    float yn = y0;
    if (xb1 <= xa1) {
      gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
      return;
    }
    if (xb0 < xa0) {
      // The rays cross behind the wall (a long wall seen edge-on): start the quad where they do.
      float f = (xa0 - xb0) / ((xa0 - xb0) + (xb1 - xa1));
      yn = mix(y0, R, f);
      xa0 = xb0 = mix(xa0, xa1, f);
    }
    q = mx * (right ? (far ? xb1 : xb0) : (far ? xa1 : xa0)) + m * (far ? R : yn);
  } else {
    // Box around what the reach circle leaves of a wide wedge.
    vec2 ea, eb;
    bool okA = leaves(Oa, da, R, ea), okB = leaves(Ob, db, R, eb);
    float x0 = okA && dot(ea, m) >= 0.0 ? min(min(dot(A, mx), dot(Oa, mx)), dot(ea, mx)) : -R;
    float x1 = okB && dot(eb, m) >= 0.0 ? max(max(dot(B, mx), dot(Ob, mx)), dot(eb, mx)) : R;
    float y1 = min(y0, min(okA ? dot(ea, m) : y0, okB ? dot(eb, m) : y0));
    q = mx * (right ? min(x1, R) : max(x0, -R)) + m * (far ? R : max(y1, -R));
  }
  v_p = q;
  v_u = vec4(ua, ub);
  v_k = vec4(sa / ca, sb / cb, la, lb);
  v_n = vec3(n, dot(n, A));
  gl_Position = u_matrix * vec4(q, 0.0, 1.0);
}`;

/**
 * How dark one wall makes a pixel, 0..1, written to alpha; the blending multiplies B and A of the
 * mask by (1 - alpha).
 *
 * - Sides: e is the distance from the ray through a corner (positive inside the wedge), t the
 *   distance past the corner along it. A hard side is a cut (a hair wider than the wedge, so
 *   neighbours overlap). A soft side keeps the whole wedge dark and fades out beyond the ray over
 *   t·tan(half-angle): the penumbra opens outwards only, so two soft corners that meet (a terrace
 *   seen along its party wall) still leave no light between them.
 * - Depth: how far behind the wall the pixel is along the light's ray; outside the wedge (the
 *   penumbra, the seam margin) how far past that ray's corner. So the wall's own line stays lit,
 *   the shadow fades in a step behind it, and a wall seen edge-on darkens nothing in front of it.
 */
export const SHADOW_FS = `#version 300 es
precision highp float;
in vec2 v_p;
flat in vec4 v_u;
flat in vec4 v_k;
flat in vec3 v_n;
uniform float u_apex;
uniform float u_seam;
uniform vec2 u_wall;
out vec4 o;
float cr(vec2 u, vec2 v) { return u.x * v.y - u.y * v.x; }
float side(float e, float t, float k) {
  if (k == 0.0) return e >= -u_seam ? 1.0 : 0.0;
  return smoothstep(-1.0, 0.0, e / (max(t, 0.0) * k + u_apex));
}
void main() {
  vec2 p = v_p;
  float ea = -cr(v_u.xy, p), eb = cr(v_u.zw, p);
  float ta = dot(p, v_u.xy) - v_k.z, tb = dot(p, v_u.zw) - v_k.w;
  float s = side(ea, ta, v_k.x) * side(eb, tb, v_k.y);
  float depth = length(p) * (1.0 - v_n.z / max(dot(p, v_n.xy), 1e-6));
  if (ea < 0.0) depth = ta;
  if (eb < 0.0) depth = ea < 0.0 ? min(depth, tb) : tb;
  o = vec4(0.0, 0.0, 0.0, s * smoothstep(u_wall.x, u_wall.y, depth));
}`;

/**
 * Casts the shadows. The fog owns one: `setOccluders` whenever the walls around you change,
 * `init`/`release` with its GL objects, and `draw` inside its mask pass right after the lamp.
 */
export class ShadowCaster {
  /** Instances submitted by the last draw (walls facing away collapse on the GPU). */
  readonly stats = { instances: 0, uploads: 0 };

  private occ: Occluders | null = null;
  private packedOcc: Occluders | null = null;
  private packedVersion = -1;
  private packedOx = NaN;
  private packedOy = NaN;
  private data = new Float32Array(0);
  private count = 0;
  private dirty = true;

  private gl: WebGL2RenderingContext | null = null;
  private prog: Program | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private quad: WebGLBuffer | null = null;
  private inst: WebGLBuffer | null = null;
  private gpuFloats = 0;
  private mat = new Float32Array(16);

  /** Walls to cast shadows from; re-packed on the next draw when they or the origin changed. */
  setOccluders(occ: Occluders | null): void {
    this.occ = occ;
  }

  /** Create the GL objects (again after a lost context, once `release` forgot the old ones). */
  init(gl: WebGL2RenderingContext): void {
    if (this.gl && this.prog && !this.gl.isContextLost()) this.destroy(this.gl);
    this.release();
    this.prog = program(gl, SHADOW_VS, SHADOW_FS, ['a_corner', 'i_ab', 'i_pn']);
    this.gl = gl;
    this.quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.inst = gl.createBuffer();
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
    for (const [loc, off] of [[1, 0], [2, 16]]) {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 4, gl.FLOAT, false, EDGE_FLOATS * 4, off);
      gl.vertexAttribDivisor(loc, 1);
    }
    gl.bindVertexArray(null);
  }

  /** Forget the GL objects without deleting them (they died with the context). */
  release(): void {
    this.gl = null;
    this.prog = null;
    this.vao = null;
    this.quad = this.inst = null;
    this.gpuFloats = 0;
    this.dirty = true;
  }

  private destroy(gl: WebGL2RenderingContext): void {
    if (this.prog) gl.deleteProgram(this.prog.p);
    gl.deleteVertexArray(this.vao);
    gl.deleteBuffer(this.quad);
    gl.deleteBuffer(this.inst);
  }

  /**
   * Darken the lantern channels (B, A) of the bound mask behind every wall facing the light.
   * `matrix`: local units → clip (FogLayer frame().matrix); `ox, oy`: the fog origin in WM;
   * `light`: light position in local units; `reach`: light reach in local units (where the lamp
   * has faded to nothing: nothing past it is drawn); `softness`: lampRadiusM * m2u.
   *
   * Leaves behind: blending on with blendEquation(MAX) and blendFunc(ONE, ONE) (the fog's mask
   * pass, as the lamp found it), colorMask all true, no VAO bound, its own program in use, and
   * on frames that uploaded walls ARRAY_BUFFER bound to its instance buffer. Expects CULL_FACE
   * off (the fog turns it off). Draws nothing and touches no state before `init`, without walls
   * or with no reach.
   */
  draw(
    gl: WebGL2RenderingContext, matrix: Float32Array, ox: number, oy: number,
    light: ArrayLike<number>, reach: number, softness: number,
  ): void {
    this.stats.instances = 0;
    const occ = this.occ, p = this.prog;
    if (!p || this.gl !== gl || !occ || occ.n <= 0 || !(reach > 0)) return;
    if (occ !== this.packedOcc || occ.version !== this.packedVersion || ox !== this.packedOx || oy !== this.packedOy) {
      const len = occ.n * EDGE_FLOATS;
      // Grow by doubling, so a gather that grows a little does not reallocate every time.
      if (this.data.length < len) this.data = new Float32Array(Math.max(len, this.data.length * 2));
      packEdges(occ.edges, occ.n, ox, oy, this.data);
      this.count = occ.n;
      this.packedOcc = occ;
      this.packedVersion = occ.version;
      this.packedOx = ox;
      this.packedOy = oy;
      this.dirty = true;
    }
    if (this.dirty) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.inst);
      if (this.gpuFloats < this.data.length) {
        gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.DYNAMIC_DRAW);
        this.gpuFloats = this.data.length;
      } else {
        gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data, 0, this.count * EDGE_FLOATS);
      }
      this.dirty = false;
      this.stats.uploads++;
    }

    // Local units → clip, moved to the light: the shader only ever sees small numbers, and the
    // two wedges meeting at a corner rasterise the same pixel to the same position.
    const lx = light[0], ly = light[1], m = this.mat;
    for (let i = 0; i < 12; i++) m[i] = matrix[i];
    for (let r = 0; r < 4; r++) m[12 + r] = matrix[r] * lx + matrix[4 + r] * ly + matrix[12 + r];
    const m2u = m2uAtWmY(oy);
    const u = p.u;
    gl.useProgram(p.p);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(u.u_matrix, false, m);
    gl.uniform2f(u.u_light, lx, ly);
    gl.uniform1f(u.u_reach, reach);
    gl.uniform1f(u.u_soft, Math.max(0, softness));
    gl.uniform1f(u.u_apex, APEX_M * m2u);
    gl.uniform1f(u.u_seam, SEAM_M * m2u);
    gl.uniform2f(u.u_wall, WALL_LIT_M * m2u, WALL_DARK_M * m2u);

    gl.enable(gl.BLEND);
    gl.colorMask(false, false, true, true);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.ZERO, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.count);
    this.stats.instances = this.count;

    gl.colorMask(true, true, true, true);
    gl.blendEquation(gl.MAX);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.bindVertexArray(null);
  }
}

// ---- CPU twin of the shaders, for tests and the demo's read-outs -------------------------------

/** What SHADOW_VS works out for one wall: light-relative, the light at (0, 0). */
export interface Wedge {
  /** Unit rays from the light through a and b. */
  ua: [number, number];
  ub: [number, number];
  /** tan of the penumbra half-angle at a and b (0: hard side). */
  ka: number;
  kb: number;
  /** Distance from the light to a and b. */
  la: number;
  lb: number;
  /** Normal of the wall into its house, and the light's distance from the wall's line. */
  n: [number, number];
  h: number;
  /** The quad, light-relative, in triangle-strip order: a near, b near, a far, b far. */
  quad: [number, number, number, number, number, number, number, number];
}

const cr = (ux: number, uy: number, vx: number, vy: number) => ux * vy - uy * vx;
const lit = (xx: number, xy: number, yx: number, yy: number) => cr(yx - xx, yy - xy, -xx, -xy) < 0;
const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * The wedge of wall `k` of packed local `edges` for a light at (lx, ly), or null when the wall
 * casts nothing (faces away, or lies beyond the reach). Mirrors SHADOW_VS line by line.
 */
export function wedgeOf(
  edges: ArrayLike<number>, k: number, lx: number, ly: number, reach: number, soft: number, m2u: number,
): Wedge | null {
  const o = k * EDGE_FLOATS;
  const Ax = edges[o] - lx, Ay = edges[o + 1] - ly, Bx = edges[o + 2] - lx, By = edges[o + 3] - ly;
  const Px = edges[o + 4] - lx, Py = edges[o + 5] - ly, Nx = edges[o + 6] - lx, Ny = edges[o + 7] - ly;
  const abx = Bx - Ax, aby = By - Ay, l2 = abx * abx + aby * aby;
  const t = Math.min(1, Math.max(0, -(Ax * abx + Ay * aby) / Math.max(l2, 1e-20)));
  if (!lit(Ax, Ay, Bx, By) || Math.hypot(Ax + abx * t, Ay + aby * t) > reach) return null;
  const la = Math.hypot(Ax, Ay), lb = Math.hypot(Bx, By);
  const uax = Ax / la, uay = Ay / la, ubx = Bx / lb, uby = By / lb;
  const il = 1 / Math.sqrt(l2), twx = abx * il, twy = aby * il;
  const nx = -twy, ny = twx;
  const pax = Ax - Px, pay = Ay - Py, bnx = Nx - Bx, bny = Ny - By;
  const softA = pax * pax + pay * pay > 0 && !lit(Px, Py, Ax, Ay);
  const softB = bnx * bnx + bny * bny > 0 && !lit(Bx, By, Nx, Ny);
  const maxSin = Math.sin(MAX_HALF_ANGLE);
  const sa = softA ? Math.min(soft / la, maxSin) : 0, sb = softB ? Math.min(soft / lb, maxSin) : 0;
  const ca = Math.sqrt(1 - sa * sa), cb = Math.sqrt(1 - sb * sb);
  const oax = -uay, oay = uax, obx = uby, oby = -ubx;
  const dax = uax * ca + oax * sa, day = uay * ca + oay * sa;
  const dbx = ubx * cb + obx * sb, dby = uby * cb + oby * sb;
  const apex = APEX_M * m2u, seam = SEAM_M * m2u;
  const offA = (softA ? apex : 0) + 2 * seam, offB = (softB ? apex : 0) + 2 * seam;
  const Oax = Ax + oax * offA, Oay = Ay + oay * offA, Obx = Bx + obx * offB, Oby = By + oby * offB;

  const R = reach;
  let mxv = uax + ubx, myv = uay + uby;
  const ml = Math.hypot(mxv, myv);
  if (ml > 1e-3) {
    mxv /= ml;
    myv /= ml;
  } else {
    mxv = nx;
    myv = ny;
  }
  const xx = myv, xy = -mxv; // across the wedge, towards b
  const dotM = (x: number, y: number) => x * mxv + y * myv;
  const dotX = (x: number, y: number) => x * xx + y * xy;
  const ya = dotM(dax, day), yb = dotM(dbx, dby);
  const y0 = Math.min(dotM(Ax, Ay), dotM(Bx, By), dotM(Oax, Oay), dotM(Obx, Oby));
  let xa0: number, xb0: number, xa1: number, xb1: number, yn: number, yf: number;
  if (Math.min(ya, yb) >= 0.5) {
    const ka = dotX(dax, day) / ya, kb = dotX(dbx, dby) / yb;
    const ha = dotX(uax, uay) / dotM(uax, uay), hb = dotX(ubx, uby) / dotM(ubx, uby);
    const xa = dotX(Oax, Oay), xb = dotX(Obx, Oby), ga0 = y0 - dotM(Oax, Oay), gb0 = y0 - dotM(Obx, Oby);
    const ga1 = R - dotM(Oax, Oay), gb1 = R - dotM(Obx, Oby);
    xa0 = xa + Math.min(ga0 * ka, ga0 * ha);
    xb0 = xb + Math.max(gb0 * kb, gb0 * hb);
    xa1 = xa + Math.min(ga1 * ka, ga1 * ha);
    xb1 = xb + Math.max(gb1 * kb, gb1 * hb);
    yn = y0;
    yf = R;
    if (xb1 <= xa1) return null;
    if (xb0 < xa0) {
      const f = (xa0 - xb0) / (xa0 - xb0 + (xb1 - xa1));
      yn = y0 + (R - y0) * f;
      xa0 = xb0 = xa0 + (xa1 - xa0) * f;
    }
  } else {
    const leaves = (ox: number, oy: number, dx: number, dy: number): [number, number] | null => {
      const b = ox * dx + oy * dy, q = b * b - (ox * ox + oy * oy) + R * R;
      const s = -b + Math.sqrt(Math.max(q, 0));
      return q >= 0 && s >= 0 ? [ox + dx * s, oy + dy * s] : null;
    };
    const ea = leaves(Oax, Oay, dax, day), eb = leaves(Obx, Oby, dbx, dby);
    const x0 = ea && dotM(ea[0], ea[1]) >= 0 ? Math.min(dotX(Ax, Ay), dotX(Oax, Oay), dotX(ea[0], ea[1])) : -R;
    const x1 = eb && dotM(eb[0], eb[1]) >= 0 ? Math.max(dotX(Bx, By), dotX(Obx, Oby), dotX(eb[0], eb[1])) : R;
    const y1 = Math.min(y0, ea ? dotM(ea[0], ea[1]) : y0, eb ? dotM(eb[0], eb[1]) : y0);
    xa0 = xa1 = Math.max(x0, -R);
    xb0 = xb1 = Math.min(x1, R);
    yn = Math.max(y1, -R);
    yf = R;
  }
  const pt = (x: number, y: number): [number, number] => [xx * x + mxv * y, xy * x + myv * y];
  const [q0x, q0y] = pt(xa0, yn), [q1x, q1y] = pt(xb0, yn), [q2x, q2y] = pt(xa1, yf), [q3x, q3y] = pt(xb1, yf);
  return {
    ua: [uax, uay], ub: [ubx, uby], ka: sa / ca, kb: sb / cb, la, lb, n: [nx, ny], h: nx * Ax + ny * Ay,
    quad: [q0x, q0y, q1x, q1y, q2x, q2y, q3x, q3y],
  };
}

/** How dark wedge `w` makes the light-relative point (x, y), 0..1. Mirrors SHADOW_FS. */
export function shadowAt(w: Wedge, x: number, y: number, m2u: number): number {
  const apex = APEX_M * m2u, seam = SEAM_M * m2u;
  const side = (e: number, t: number, k: number) =>
    k === 0 ? (e >= -seam ? 1 : 0) : smoothstep(-1, 0, e / (Math.max(t, 0) * k + apex));
  const ea = -cr(w.ua[0], w.ua[1], x, y), eb = cr(w.ub[0], w.ub[1], x, y);
  const ta = x * w.ua[0] + y * w.ua[1] - w.la, tb = x * w.ub[0] + y * w.ub[1] - w.lb;
  const s = side(ea, ta, w.ka) * side(eb, tb, w.kb);
  let depth = Math.hypot(x, y) * (1 - w.h / Math.max(x * w.n[0] + y * w.n[1], 1e-6));
  if (ea < 0) depth = ta;
  if (eb < 0) depth = ea < 0 ? Math.min(depth, tb) : tb;
  return s * smoothstep(WALL_LIT_M * m2u, WALL_DARK_M * m2u, depth);
}

/** Is the light-relative point inside the wedge's quad (with a little slack)? */
export function inQuad(w: Wedge, x: number, y: number, slack = 1e-6): boolean {
  const q = w.quad;
  // Strip order a-near, b-near, a-far, b-far → polygon a-near, b-near, b-far, a-far.
  const poly = [q[0], q[1], q[2], q[3], q[6], q[7], q[4], q[5]];
  let pos = false, neg = false;
  for (let i = 0; i < 4; i++) {
    const ax = poly[i * 2], ay = poly[i * 2 + 1];
    const bx = poly[((i + 1) % 4) * 2], by = poly[((i + 1) % 4) * 2 + 1];
    const ex = bx - ax, ey = by - ay, len = Math.hypot(ex, ey);
    if (len < 1e-12) continue;
    const c = cr(ex, ey, x - ax, y - ay) / len;
    if (c > slack) pos = true;
    if (c < -slack) neg = true;
  }
  return !(pos && neg);
}
