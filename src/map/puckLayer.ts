import type { CustomLayerInterface, CustomRenderMethodInput, Map as MlMap } from 'maplibre-gl';
import type { Theme } from '../theme';
import { mercX, mercY } from './fog/geometry';
import { pageTime } from './fog/fogLayer';
import { hex3, localMatrix, program, type Program } from './gl';
import { PUCK_FS, PUCK_VS } from './fog/shaders';

export interface PuckState {
  lon: number;
  lat: number;
  heading: number | null;
  cone: number;
}

/** Half-size of the quad the walker is drawn in, CSS px. */
const SIZE = 26;

/**
 * You on the map, drawn on the GPU in the same frame as the map itself (a DOM marker trails the
 * map by a frame while the camera follows you, which reads as jitter).
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
  private col: Record<'core' | 'ring' | 'glow', [number, number, number]>;

  constructor(theme: Theme) {
    this.col = { core: hex3(theme.puck.core), ring: hex3(theme.puck.ring), glow: hex3(theme.puck.glow) };
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
      console.error('Wanderlight: walker layer disabled', e);
      this.broken = true;
    }
  }

  render(gl: WebGL2RenderingContext, opts: CustomRenderMethodInput): void {
    const s = this.state;
    if (!s || !this.map || !this.prog || this.gl !== gl || gl.isContextLost()) return;
    const ws = 512 * 2 ** this.map.getZoom();
    // One unit = one CSS pixel, centred on you.
    const m = localMatrix(opts.modelViewProjectionMatrix, ws, mercX(s.lon), mercY(s.lat), ws);
    const h = ((s.heading ?? 0) * Math.PI) / 180;
    const u = this.prog.u;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.enable(gl.BLEND);
    gl.blendEquation(gl.FUNC_ADD);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.prog.p);
    gl.bindVertexArray(this.vao);
    gl.uniformMatrix4fv(u.u_matrix, false, new Float32Array(m));
    gl.uniform1f(u.u_size, SIZE);
    gl.uniform1f(u.u_time, pageTime());
    gl.uniform2f(u.u_dir, Math.sin(h), -Math.cos(h));
    gl.uniform1f(u.u_cone, s.heading === null ? 0 : s.cone);
    gl.uniform1f(u.u_scale, this.map.getPixelRatio());
    gl.uniform3fv(u.u_core, this.col.core);
    gl.uniform3fv(u.u_ring, this.col.ring);
    gl.uniform3fv(u.u_glow, this.col.glow);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }
}
