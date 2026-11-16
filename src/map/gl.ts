/** Small WebGL2 helpers shared by the fog and the walker layers. */

export interface Program {
  p: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

function shader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
    const log = gl.getShaderInfoLog(s);
    gl.deleteShader(s);
    throw new Error(`Shader failed to compile: ${log}`);
  }
  return s;
}

/** Compile and link; attribute i of `attribs` is bound to location i. */
export function program(gl: WebGL2RenderingContext, vs: string, fs: string, attribs: string[]): Program {
  const p = gl.createProgram()!;
  const v = shader(gl, gl.VERTEX_SHADER, vs);
  const f = shader(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(p, v);
  gl.attachShader(p, f);
  attribs.forEach((a, i) => gl.bindAttribLocation(p, i, a));
  gl.linkProgram(p);
  gl.deleteShader(v);
  gl.deleteShader(f);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS) && !gl.isContextLost()) {
    throw new Error(`Shader failed to link: ${gl.getProgramInfoLog(p)}`);
  }
  const u: Program['u'] = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    if (info) u[info.name.replace(/\[0\]$/, '')] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

/** A float or index array that only grows, mirrored to a GPU buffer (appends upload only the tail). */
export class GrowBuffer<T extends Float32Array | Uint32Array> {
  data: T;
  length = 0;
  private uploaded = 0;
  private gpuCapacity = 0;
  buffer: WebGLBuffer | null = null;

  constructor(private make: (n: number) => T, initial = 1024) {
    this.data = make(initial);
  }

  push(values: ArrayLike<number>): void {
    const need = this.length + values.length;
    if (need > this.data.length) {
      let cap = this.data.length * 2;
      while (cap < need) cap *= 2;
      const next = this.make(cap);
      next.set(this.data.subarray(0, this.length));
      this.data = next;
    }
    this.data.set(values, this.length);
    this.length = need;
  }

  clear(): void {
    this.length = 0;
    this.uploaded = 0;
  }

  /** Forget the GPU side (after the context was lost). */
  lose(): void {
    this.buffer = null;
    this.uploaded = 0;
    this.gpuCapacity = 0;
  }

  /** Upload what changed. The buffer must be bindable to `target` right now (bind the VAO first for indices). */
  sync(gl: WebGL2RenderingContext, target: number): void {
    if (!this.buffer) this.buffer = gl.createBuffer();
    gl.bindBuffer(target, this.buffer);
    if (this.gpuCapacity < this.data.length) {
      gl.bufferData(target, this.data, gl.DYNAMIC_DRAW);
      this.gpuCapacity = this.data.length;
      this.uploaded = this.length;
    } else if (this.uploaded < this.length) {
      gl.bufferSubData(target, this.uploaded * 4, this.data, this.uploaded, this.length - this.uploaded);
      this.uploaded = this.length;
    }
  }
}

export const EARTH_CIRCUMFERENCE_M = 40_075_016.686;

/** Column-major 4x4 multiply in float64: out = a * b. */
export function mul(a: ArrayLike<number>, b: ArrayLike<number>): Float64Array {
  const o = new Float64Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      o[c * 4 + r] =
        a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return o;
}

/** General 4x4 inverse (column-major), or null when singular. */
export function invert(m: ArrayLike<number>): Float64Array | null {
  const [a00, a01, a02, a03, a10, a11, a12, a13, a20, a21, a22, a23, a30, a31, a32, a33] = Array.from(m);
  const b00 = a00 * a11 - a01 * a10, b01 = a00 * a12 - a02 * a10, b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11, b04 = a01 * a13 - a03 * a11, b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30, b07 = a20 * a32 - a22 * a30, b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31, b10 = a21 * a33 - a23 * a31, b11 = a22 * a33 - a23 * a32;
  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (!det) return null;
  det = 1 / det;
  return Float64Array.of(
    (a11 * b11 - a12 * b10 + a13 * b09) * det,
    (a02 * b10 - a01 * b11 - a03 * b09) * det,
    (a31 * b05 - a32 * b04 + a33 * b03) * det,
    (a22 * b04 - a21 * b05 - a23 * b03) * det,
    (a12 * b08 - a10 * b11 - a13 * b07) * det,
    (a00 * b11 - a02 * b08 + a03 * b07) * det,
    (a32 * b02 - a30 * b05 - a33 * b01) * det,
    (a20 * b05 - a22 * b02 + a23 * b01) * det,
    (a10 * b10 - a11 * b08 + a13 * b06) * det,
    (a01 * b08 - a00 * b10 - a03 * b06) * det,
    (a30 * b04 - a31 * b02 + a33 * b00) * det,
    (a21 * b02 - a20 * b04 - a23 * b00) * det,
    (a11 * b07 - a10 * b09 - a12 * b06) * det,
    (a00 * b09 - a01 * b07 + a02 * b06) * det,
    (a31 * b01 - a30 * b03 - a32 * b00) * det,
    (a20 * b03 - a21 * b01 + a22 * b00) * det,
  );
}

/**
 * The matrix from local units (mercator metres east/south of an origin given in MapLibre's 0..1
 * mercator space) to clip space. Composed in float64, so the GPU only ever sees small numbers and
 * a street draws without jitter at any zoom.
 */
export function localMatrix(mvp: ArrayLike<number>, worldSize: number, ox: number, oy: number, unitsPerWorld = EARTH_CIRCUMFERENCE_M): Float64Array {
  const k = worldSize / unitsPerWorld;
  const ts = Float64Array.of(k, 0, 0, 0, 0, k, 0, 0, 0, 0, 1, 0, ox * worldSize, oy * worldSize, 0, 1);
  return mul(mvp, ts);
}

/** '#rrggbb' as linear-ish 0..1 floats (sRGB values used as is, like the rest of the map). */
export function hex3(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
