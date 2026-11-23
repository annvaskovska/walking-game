import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import type { Theme } from '../theme';
import { mercX, mercY } from './fog/geometry';
import { hex3, localMatrix, program, type Program } from './gl';
import { PUCK_FS, PUCK_VS } from './fog/shaders';

export interface PuckState {
  lon: number;
  lat: number;
  /** The pencil he colors with: the one of the street he colored last. */
  tone: number;
}

/** Half-size of the quad the walker is drawn in, CSS px: the pencil, up and right of you, and its shadow. */
const SIZE = 60;

/**
 * You on the map, as Mr Sparkles (ADR 0014): a colored pencil whose lead is where you are, drawn
 * on the GPU in the same frame as the map itself (a DOM marker trails the map by a frame while the
 * camera follows you, which reads as jitter).
 */
export class PuckLayer implements CustomLayerInterface {
  readonly id = 'wl-puck';
  readonly type = 'custom' as const;
  readonly renderingMode = '2d' as const;
  private map: MlMap | null = null;
  private gl: WebGL2RenderingContext | null = null;
  private prog: Program | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private broken = false;
  private state: PuckState | null = null;
  private wood: [number, number, number];
  private ink: [number, number, number];
  private lay: [number, number, number][];
  private press: [number, number, number][];

  constructor(theme: Theme) {
    this.wood = hex3(theme.puck.wood);
    this.ink = hex3(theme.puck.ink);
    this.lay = theme.pencils.map((p) => hex3(p.lay));
    this.press = theme.pencils.map((p) => hex3(p.press));
  }

  set(s: PuckState | null): void {
    this.state = s;
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
  };

  /** GL objects are made here: MapLibre resets its own GL state cache right after an offscreen pass. */
  prerender(gl: WebGL2RenderingContext): void {
    if (this.broken || gl.isContextLost() || (this.gl === gl && this.prog)) return;
    try {
      this.prog = program(gl, PUCK_VS, PUCK_FS, ['a_corner']);
      const buf = gl.createBuffer();
      this.vao = gl.createVertexArray();
      gl.bindVertexArray(this.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      this.gl = gl;
    } catch (e) {
      console.error('Mr Sparkles: walker layer disabled', e);
      this.broken = true;
    }
  }

  render(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput): void {
    const s = this.state;
    if (!s || !this.map || !this.prog || this.gl !== gl || gl.isContextLost()) return;
    const ws = 512 * 2 ** this.map.getZoom();
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
    gl.uniformMatrix4fv(u.u_matrix, false, new Float32Array(m));
    const k = Math.min(this.lay.length - 1, Math.max(0, s.tone | 0));
    gl.uniform1f(u.u_size, SIZE);
    gl.uniform1f(u.u_scale, this.map.getPixelRatio());
    gl.uniform3fv(u.u_lay, this.lay[k]);
    gl.uniform3fv(u.u_press, this.press[k]);
    gl.uniform3fv(u.u_wood, this.wood);
    gl.uniform3fv(u.u_ink, this.ink);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
