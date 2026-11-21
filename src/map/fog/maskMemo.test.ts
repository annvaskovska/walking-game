import { describe, expect, it } from 'vitest';
import { MaskMemo, STILL_DEG, STILL_PX, type MaskInputs } from './maskMemo';

// A flat map 800×600 css px over half-resolution masks of 400×300, at zoom 17.
const W = 800, H = 600, WS = 512 * 2 ** 17;
/** Mask pixels in world pixels: the masks are half the screen. */
const PX = 2;

/** World pixels to clip, centred on (cx, cy): what MapLibre hands a flat custom layer. */
function mvp(cx: number, cy: number, zoomScale = 1): Float64Array {
  const sx = (2 / W) * zoomScale, sy = (-2 / H) * zoomScale;
  return Float64Array.of(sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, -cx * sx, -cy * sy, 0, 1);
}

const C = { x: WS * 0.57, y: WS * 0.33 };

function inputs(o: Partial<MaskInputs> = {}): MaskInputs {
  return {
    version: 3, t: 10, animUntil: 0, mvp: mvp(C.x, C.y), ws: WS, w: W / 2, h: H / 2,
    light: { x: C.x, y: C.y, heading: 90, cone: 1 }, probeX: C.x, probeY: C.y, ...o,
  };
}

function drawnWith(i = inputs(), pending = false): MaskMemo {
  const m = new MaskMemo();
  m.drawn(i, pending);
  return m;
}

describe('MaskMemo', () => {
  it('draws the first frame, then keeps the masks while nothing changes', () => {
    const m = new MaskMemo();
    expect(m.same(inputs())).toBe(false);
    m.drawn(inputs(), false);
    expect(m.same(inputs({ t: 11 }))).toBe(true);
    expect(m.same(inputs({ t: 500 }))).toBe(true);
  });

  it('draws again when anything in the masks changed', () => {
    expect(drawnWith().same(inputs({ version: 4 }))).toBe(false);
  });

  it('draws while something animates, and once more after it ends', () => {
    const m = drawnWith(inputs({ t: 10, animUntil: 12 }));
    expect(m.same(inputs({ t: 11, animUntil: 12 }))).toBe(false);
    m.drawn(inputs({ t: 11.9, animUntil: 12 }), false);
    // The last frame drawn was still inside the animation: one more at its end.
    expect(m.same(inputs({ t: 12.1, animUntil: 12 }))).toBe(false);
    m.drawn(inputs({ t: 12.1, animUntil: 12 }), false);
    expect(m.same(inputs({ t: 13, animUntil: 12 }))).toBe(true);
  });

  it('draws again while tiles wait for their upload', () => {
    const m = drawnWith(inputs(), true);
    expect(m.same(inputs({ t: 11 }))).toBe(false);
    m.drawn(inputs({ t: 11 }), false);
    expect(m.same(inputs({ t: 12 }))).toBe(true);
  });

  it('draws on a zoom, a resize or a lost context', () => {
    expect(drawnWith().same(inputs({ ws: WS * 1.01 }))).toBe(false);
    expect(drawnWith().same(inputs({ mvp: mvp(C.x, C.y, 1.01) }))).toBe(false);
    expect(drawnWith().same(inputs({ w: 401 }))).toBe(false);
    const m = drawnWith();
    m.forget();
    expect(m.same(inputs())).toBe(false);
  });

  it('lets the map pan by less than a quarter of a mask pixel, counted from the last drawing', () => {
    const step = STILL_PX * PX * 0.6;
    const m = drawnWith();
    expect(m.same(inputs({ mvp: mvp(C.x + step, C.y) }))).toBe(true);
    // Two small pans add up: the masks follow once the sum shows.
    expect(m.same(inputs({ mvp: mvp(C.x + 2 * step, C.y) }))).toBe(false);
    expect(m.same(inputs({ mvp: mvp(C.x, C.y - 2 * step) }))).toBe(false);
  });

  it('lets you move by less than a quarter of a mask pixel', () => {
    const near = STILL_PX * PX * 0.8, far = STILL_PX * PX * 1.2;
    const at = (dx: number) => inputs({ light: { x: C.x + dx, y: C.y, heading: 90, cone: 1 } });
    expect(drawnWith().same(at(near))).toBe(true);
    expect(drawnWith().same(at(far))).toBe(false);
  });

  it('lets the beam turn by a sliver, and ignores the heading once the beam is out', () => {
    const look = (heading: number | null, cone = 1) => inputs({ light: { x: C.x, y: C.y, heading, cone } });
    expect(drawnWith().same(look(90 + STILL_DEG * 0.9))).toBe(true);
    expect(drawnWith().same(look(90 - STILL_DEG * 1.5))).toBe(false);
    // Across north.
    expect(drawnWith(look(359.95)).same(look(0.05))).toBe(true);
    expect(drawnWith(look(359)).same(look(1))).toBe(false);
    // The beam fading in or out.
    expect(drawnWith().same(look(90, 0.98))).toBe(false);
    // No beam: where it would point does not matter.
    expect(drawnWith(look(90, 0)).same(look(250, 0))).toBe(true);
    expect(drawnWith(look(null, 1)).same(look(null, 0.5))).toBe(true);
    expect(drawnWith(look(null, 1)).same(look(90, 1))).toBe(false);
  });

  it('draws when your light comes or goes', () => {
    expect(drawnWith().same(inputs({ light: null }))).toBe(false);
    expect(drawnWith(inputs({ light: null })).same(inputs())).toBe(false);
    expect(drawnWith(inputs({ light: null })).same(inputs({ light: null, t: 30 }))).toBe(true);
  });
});
