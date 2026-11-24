import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import type { Pencil, Theme } from '../theme';
import { mrDocument } from '../ui/art';
import { mercX, mercY } from './fog/geometry';
import { localMatrix, program, type Program } from './gl';

export interface PuckState {
  lon: number;
  lat: number;
  /** His crayon: the one of the street he walks. */
  tone: number;
  /** How worn down he is, 1 new (wearAfter). */
  wear: number;
  /** Where he goes, degrees clockwise from north, or null before he has moved. */
  heading: number | null;
  /** Walking, he colors in, scrubbing left and right; standing still, he holds still. */
  walking: boolean;
}

// As in the design: a 32 × 53.4 CSS px box (his 0 0 60 100 viewBox, fit in), placed 16 px left of
// you and 51.2 px up, so his tip (30, 96) is on you. Lean and stroke turn about that point, the pop
// squashes about 50% 96% of the box.
const W = 32;
const H = 53.4;
const OY = 51.2;
const POP_Y = 0.96 * H;
/** Half-size of the quad he is drawn in, CSS px: room for him leaning, scrubbing and popping. */
const REACH = 64;
/** One stroke of his coloring, left to right or back (ms), and how far his tip goes each way (CSS px). */
const STROKE_MS = 220;
const STROKE_PX = 3;
/** At mid-stroke his top leads the stroke by this much (degrees); he is upright where it turns. */
const STROKE_TILT = 7;
/** He colors while he went at walking pace this recently (ms): a slow frame does not stop him. */
const WALKED_MS = 400;
const POP_MS = 450;
const DEG = Math.PI / 180;

/** CSS cubic-bezier(x1, y1, x2, y2) as a function of progress 0..1. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (x: number) => number {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x) => {
    let lo = 0, hi = 1, t = x;
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2;
      if (at(x1, x2, t) < x) lo = t;
      else hi = t;
    }
    return at(y1, y2, t);
  };
}
const easeInOut = cubicBezier(0.42, 0, 0.58, 1);
const popEase = cubicBezier(0.3, 1.7, 0.5, 1);

/**
 * His coloring stroke at `now` (ms), the way a hand colors in: left, right, left, right across the
 * page, never up and down, so he never seems to hop. Returns how far his tip is right of you (CSS px)
 * and his tilt (degrees, his top to the right): his top leads each stroke, upright where it turns.
 */
export function strokeAt(now: number): [shift: number, tilt: number] {
  const t = (now / STROKE_MS) % 2;
  const ph = t > 1 ? 2 - t : t;
  return [STROKE_PX * (2 * easeInOut(ph) - 1), STROKE_TILT * (t > 1 ? -1 : 1) * Math.sin(Math.PI * ph)];
}

const VS = `#version 300 es
in vec2 a_corner;
uniform mat4 u_matrix;
out vec2 v_px;
void main() {
  v_px = a_corner * ${REACH}.0;
  gl_Position = u_matrix * vec4(v_px, 0.0, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec2 v_px;
uniform sampler2D u_tex;
uniform vec2 u_view;
uniform vec2 u_turn;
uniform float u_shift;
uniform vec2 u_pop;
uniform vec2 u_box;
uniform float u_scale;
out vec4 o;
vec2 rot(vec2 p, vec2 cs) { return vec2(cs.x * p.x - cs.y * p.y, cs.y * p.x + cs.x * p.y); }
void main() {
  // CSS px from his tip on screen, y down: the stroke moves it off you, left and right.
  vec2 d = rot(v_px, u_view) - vec2(u_shift, 0.0);
  // His shadow on the paper: 17 x 5.2 px, 13% black, 1 px below his tip.
  vec2 r = vec2(8.5, 2.6);
  vec2 e = (d - vec2(0.0, 1.0)) / r;
  float edge = (dot(e, e) - 1.0) / max(2.0 * length(e / r), 1e-4);
  float shadow = 0.13 * clamp(0.5 - edge * u_scale, 0.0, 1.0);
  // Him: undo the lean and the stroke's tilt about his tip, then the pop, into his box.
  vec2 v = rot(d, u_turn);
  vec2 q = vec2(${W / 2}.0, ${POP_Y}) + (v + vec2(0.0, ${OY - POP_Y})) / u_pop;
  vec4 c = texture(u_tex, q / u_box);
  o = c + vec4(0.0, 0.0, 0.0, shadow) * (1.0 - c.a);
}`;

/**
 * You on the map, as Mr Sparkles (ADR 0014): the crayon of the design, his tip where you are, in the
 * crayon of the street he colors. His drawing is rasterized into a texture only when his crayon or
 * wear changes; his stroke, lean, pop and shadow are drawn on the GPU in the same frame as the map (a
 * DOM marker trails the map by a frame while the camera follows you, which reads as jitter).
 */
export class PuckLayer implements CustomLayerInterface {
  readonly id = 'wl-puck';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  private map: MlMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private prog: Program | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private tex: WebGLTexture | null = null;
  private broken = false;
  private state: PuckState | null = null;
  private pencils: Pencil[];
  private still = matchMedia('(prefers-reduced-motion: reduce)');
  /** The drawing wanted, the one drawn, and whether it still has to go to the GPU. */
  private want = '';
  private img: HTMLCanvasElement | null = null;
  private box: [number, number] = [W, H];
  private fresh = false;
  private lean = 0;
  private leanTo = 0;
  private snap = true;
  private lastT = 0;
  private walkedAt = -Infinity;
  /** How much he colors, 0..1: eased in and out, so starting and stopping never jolt him. */
  private stroke = 0;
  private popAt = -Infinity;

  constructor(theme: Theme) {
    this.pencils = theme.pencils;
  }

  set(s: PuckState | null): void {
    if (s?.walking) this.walkedAt = performance.now();
    if (!s) this.snap = true;
    this.state = s;
  }

  /** A new street: he pops (squashes and springs back). */
  pop(): void {
    this.popAt = performance.now();
  }

  /** Is he in motion that needs every frame drawn (a pop)? */
  animating(now: number): boolean {
    return now - this.popAt < POP_MS && !this.still.matches;
  }

  onAdd(map: MlMap): void {
    this.map = map;
    map.getCanvas().addEventListener('webglcontextlost', this.onLost);
  }

  onRemove(map: MlMap): void {
    map.getCanvas().removeEventListener('webglcontextlost', this.onLost);
    this.map = null;
    this.onLost();
  }

  private onLost = () => {
    this.gl = null;
    this.prog = null;
    this.vao = null;
    this.tex = null;
    this.fresh = !!this.img;
  };

  /** Rasterizes him at the canvas' device scale; the old drawing stays up until this one is ready. */
  private async draw(key: string, wear: number, c: Pencil, s: number): Promise<void> {
    const img = new Image();
    // The viewBox fits the box's width; the box is a little taller, so it sits centred, as in the design.
    const fit = W / 0.6;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(mrDocument(wear, c, W * s, fit * s));
    try {
      await img.decode();
    } catch {
      return;
    }
    if (key !== this.want) return;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(W * s);
    cv.height = Math.ceil(H * s);
    cv.getContext('2d')?.drawImage(img, 0, ((H - fit) / 2) * s, W * s, fit * s);
    this.img = cv;
    this.box = [cv.width / s, cv.height / s];
    this.fresh = true;
    this.map?.triggerRepaint();
  }

  /** GL objects are made here: MapLibre resets its own GL state cache right after an offscreen pass. */
  prerender(gl: WebGL2RenderingContext): void {
    if (this.broken || gl.isContextLost()) return;
    if (this.gl !== gl || !this.prog) {
      try {
        this.prog = program(gl, VS, FS, ['a_corner']);
        const buf = gl.createBuffer();
        this.vao = gl.createVertexArray();
        gl.bindVertexArray(this.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindVertexArray(null);
        this.tex = null;
        this.fresh = !!this.img;
        this.gl = gl;
      } catch (e) {
        console.error('Mr Sparkles: walker layer disabled', e);
        this.broken = true;
        return;
      }
    }
    if (this.fresh && this.img) {
      this.tex ??= gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, this.tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.img);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      this.fresh = false;
    }
  }

  render(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput): void {
    const s = this.state;
    const map = this.map;
    if (!s || !map || !this.prog || this.gl !== gl || gl.isContextLost()) return;
    const scale = map.getPixelRatio();
    const k = Math.min(this.pencils.length - 1, Math.max(0, s.tone | 0));
    const key = `${s.wear} ${k} ${scale}`;
    if (key !== this.want) {
      this.want = key;
      void this.draw(key, s.wear, this.pencils[k], scale);
    }
    if (!this.tex) return;

    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - this.lastT) / 1000));
    this.lastT = now;
    const bearing = map.getBearing();
    // He leans 15° toward where he goes on screen, eased.
    if (s.heading !== null) this.leanTo = 15 * Math.sin((s.heading - bearing) * DEG);
    this.lean = this.snap ? this.leanTo : this.lean + (this.leanTo - this.lean) * (1 - Math.exp(-dt * 6));
    // Walking, he colors in (strokeAt), eased in and out.
    const strokeTo = now - this.walkedAt < WALKED_MS && !this.still.matches ? 1 : 0;
    this.stroke = this.snap ? strokeTo : this.stroke + (strokeTo - this.stroke) * (1 - Math.exp(-dt * 10));
    this.snap = false;
    const [x, a] = strokeAt(now);
    const shift = this.stroke * x;
    const tilt = this.stroke * a;
    // The pop: scale(1.3, .78) back to none over 0.45 s.
    const p = (now - this.popAt) / POP_MS;
    const e = p < 1 && !this.still.matches ? popEase(Math.max(0, p)) : 1;
    const turn = -(this.lean + tilt) * DEG;

    const ws = 512 * 2 ** map.getZoom();
    // One unit = one CSS pixel, centred on you.
    const m = localMatrix(opts.modelViewProjectionMatrix, ws, mercX(s.lon), mercY(s.lat), ws);
    const u = this.prog.u;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog.p);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.uniform1i(u.u_tex, 0);
    gl.uniformMatrix4fv(u.u_matrix, false, new Float32Array(m));
    gl.uniform2f(u.u_view, Math.cos(-bearing * DEG), Math.sin(-bearing * DEG));
    gl.uniform2f(u.u_turn, Math.cos(turn), Math.sin(turn));
    gl.uniform1f(u.u_shift, shift);
    gl.uniform2f(u.u_pop, 1.3 - 0.3 * e, 0.78 + 0.22 * e);
    gl.uniform2f(u.u_box, this.box[0], this.box[1]);
    gl.uniform1f(u.u_scale, scale);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
