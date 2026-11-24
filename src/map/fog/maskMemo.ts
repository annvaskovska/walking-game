/**
 * Standing still, the crayon's paint pass (every walked street, house, trail and canal in view)
 * comes out the same frame after frame (ADR 0008). This remembers what it was last drawn from, so
 * a frame that would draw it the same keeps it and spends nothing on it. The composite on top
 * still runs every frame the map draws.
 *
 * "The same" allows what no one can see: the map panned by under half a device pixel. GPS keeps
 * nudging a walker who stands still by millimetres, and the camera on him with it: drawing on
 * every nudge would never rest.
 */

/** How far the picture may move before the paint is drawn again, in its pixels (device pixels). */
export const STILL_PX = 0.5;

/** What the paint would be drawn from this frame. */
export interface MaskInputs {
  /** Bumped by every change of what goes into the paint: streets, houses, steps, water, its size. */
  version: number;
  /** Page time (s), and until when something in it animates. */
  t: number;
  animUntil: number;
  /** The map's matrix (world pixels to clip) and the world's size in pixels (the zoom). */
  mvp: ArrayLike<number>;
  ws: number;
  /** The paint's size in pixels. */
  w: number;
  h: number;
  /** Where to measure a pan (world pixels): the middle of the view. */
  probeX: number;
  probeY: number;
}

export class MaskMemo {
  private version = -1;
  private t = 0;
  private ws = 0;
  private w = 0;
  private h = 0;
  private readonly mvp = new Float64Array(16);

  /** Would drawing the paint now give what it already holds? */
  same(i: MaskInputs): boolean {
    if (this.version < 0 || i.version !== this.version) return false;
    // Drawn while something still animated: once more, at its end.
    if (this.t < i.animUntil) return false;
    if (i.ws !== this.ws || i.w !== this.w || i.h !== this.h) return false;
    const m = i.mvp, d = this.mvp;
    // Zoomed, turned or resized. (Column 2 only scales heights, and the crayon is flat.)
    for (let k = 0; k < 8; k++) if (m[k] !== d[k]) return false;
    // Panned: how far the middle of the view moved on screen.
    return this.shift(d, m, i.probeX, i.probeY) <= STILL_PX;
  }

  /** The paint was drawn from `i`. */
  drawn(i: MaskInputs): void {
    this.version = i.version;
    this.t = i.t;
    this.ws = i.ws;
    this.w = i.w;
    this.h = i.h;
    for (let k = 0; k < 16; k++) this.mvp[k] = i.mvp[k];
  }

  /** The paint is gone (a lost context): draw it on the next frame. */
  forget(): void {
    this.version = -1;
  }

  /** Pixels a point (x, y) moved between matrix ma and matrix mb. */
  private shift(ma: ArrayLike<number>, mb: ArrayLike<number>, x: number, y: number): number {
    const wa = ma[3] * x + ma[7] * y + ma[15];
    const wb = mb[3] * x + mb[7] * y + mb[15];
    const dx = (mb[0] * x + mb[4] * y + mb[12]) / wb - (ma[0] * x + ma[4] * y + ma[12]) / wa;
    const dy = (mb[1] * x + mb[5] * y + mb[13]) / wb - (ma[1] * x + ma[5] * y + ma[13]) / wa;
    // Clip space spans 2 across the paint.
    return Math.hypot((dx * this.w) / 2, (dy * this.h) / 2);
  }
}
