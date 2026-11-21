/**
 * Standing still, the fog's masks (your lit streets, your light and its shadows, the seen memory
 * in view) come out the same frame after frame. This remembers what they were last drawn from,
 * so a frame that would draw them the same keeps them and spends nothing on them. The composite
 * on top still runs every frame, for the drifting mist.
 *
 * "The same" allows what no one can see: the map panned or you moved by under half a screen
 * pixel (a quarter of a pixel of the half-resolution masks), and the beam turned by a sliver of
 * its soft sides. GPS keeps nudging a walker who stands still by millimetres, and a compass
 * held in the hand trembles: drawing on every nudge would never rest.
 */

/** How far the picture may move before the masks are drawn again, in mask pixels (half a screen pixel). */
export const STILL_PX = 0.25;
/** How far the beam may turn before it is drawn again, in degrees (its soft sides span 19°). */
export const STILL_DEG = 0.2;

/** Your light, in world pixels at this zoom. */
export interface MaskLight {
  x: number;
  y: number;
  heading: number | null;
  cone: number;
}

/** What the masks would be drawn from this frame. */
export interface MaskInputs {
  /** Bumped by every change of what goes into the masks: streets, houses, walls, seen tiles, targets. */
  version: number;
  /** Page time (s), and until when something in the masks animates. */
  t: number;
  animUntil: number;
  /** The map's matrix (world pixels to clip) and the world's size in pixels (the zoom). */
  mvp: ArrayLike<number>;
  ws: number;
  /** The masks' size in pixels. */
  w: number;
  h: number;
  light: MaskLight | null;
  /** Where to measure a pan when there is no light (world pixels): the middle of the view. */
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
  private lit = false;
  private x = 0;
  private y = 0;
  private heading = 0;
  private cone = 0;
  private pending = false;

  /** Would drawing the masks now give what they already hold? */
  same(i: MaskInputs): boolean {
    if (this.version < 0 || i.version !== this.version || this.pending) return false;
    // Drawn while something still animated: once more, at its end.
    if (this.t < i.animUntil) return false;
    if (i.ws !== this.ws || i.w !== this.w || i.h !== this.h) return false;
    const m = i.mvp, d = this.mvp;
    // Zoomed, turned or resized. (Column 2 only scales heights, and the fog is flat.)
    for (let k = 0; k < 8; k++) if (m[k] !== d[k]) return false;
    const l = i.light;
    if (!l !== !this.lit) return false;
    // Panned: how far a point moved on screen, at you or else in the middle of the view.
    const px = l ? l.x : i.probeX, py = l ? l.y : i.probeY;
    if (this.shift(d, px, py, m, px, py) > STILL_PX) return false;
    if (!l) return true;
    // You moved: how far, on screen now.
    if (this.shift(m, this.x, this.y, m, l.x, l.y) > STILL_PX) return false;
    // With no heading there is no beam, whatever its strength.
    const cone = l.heading === null ? 0 : l.cone;
    if (cone !== this.cone) return false;
    return cone === 0 || turnDeg(l.heading!, this.heading) <= STILL_DEG;
  }

  /** The masks were drawn from `i`; `pending`: some of it waits to arrive, so draw again. */
  drawn(i: MaskInputs, pending: boolean): void {
    this.version = i.version;
    this.t = i.t;
    this.ws = i.ws;
    this.w = i.w;
    this.h = i.h;
    for (let k = 0; k < 16; k++) this.mvp[k] = i.mvp[k];
    const l = i.light;
    this.lit = l !== null;
    if (l) {
      this.x = l.x;
      this.y = l.y;
      this.heading = l.heading ?? 0;
      this.cone = l.heading === null ? 0 : l.cone;
    }
    this.pending = pending;
  }

  /** The masks are gone (a lost context): draw them on the next frame. */
  forget(): void {
    this.version = -1;
  }

  /** Mask pixels between point a under matrix ma and point b under matrix mb. */
  private shift(ma: ArrayLike<number>, ax: number, ay: number, mb: ArrayLike<number>, bx: number, by: number): number {
    const wa = ma[3] * ax + ma[7] * ay + ma[15];
    const wb = mb[3] * bx + mb[7] * by + mb[15];
    const dx = (mb[0] * bx + mb[4] * by + mb[12]) / wb - (ma[0] * ax + ma[4] * ay + ma[12]) / wa;
    const dy = (mb[1] * bx + mb[5] * by + mb[13]) / wb - (ma[1] * ax + ma[5] * ay + ma[13]) / wa;
    // Clip space spans 2 across the masks.
    return Math.hypot((dx * this.w) / 2, (dy * this.h) / 2);
  }
}

/** The smaller angle between two headings, degrees. */
function turnDeg(a: number, b: number): number {
  return Math.abs(((((a - b) % 360) + 540) % 360) - 180);
}
