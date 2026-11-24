import { describe, expect, it } from 'vitest';
import { MaskMemo, STILL_PX, type MaskInputs } from './maskMemo';

// A flat map 400×300 css px at device pixel ratio 2, painted at 800×600, at zoom 17.
const W = 800, H = 600, WS = 512 * 2 ** 17;
/** Paint pixels a world pixel. */
const PX = 2;

/** World pixels to clip, centred on (cx, cy): what MapLibre hands a flat custom layer. */
function mvp(cx: number, cy: number, zoomScale = 1): Float64Array {
  const sx = ((2 * PX) / W) * zoomScale, sy = ((-2 * PX) / H) * zoomScale;
  return Float64Array.of(sx, 0, 0, 0, 0, sy, 0, 0, 0, 0, 1, 0, -cx * sx, -cy * sy, 0, 1);
}

const C = { x: WS * 0.57, y: WS * 0.33 };

function inputs(o: Partial<MaskInputs> = {}): MaskInputs {
  return { version: 3, t: 10, animUntil: 0, mvp: mvp(C.x, C.y), ws: WS, w: W, h: H, probeX: C.x, probeY: C.y, ...o };
}

function drawnWith(i = inputs()): MaskMemo {
  const m = new MaskMemo();
  m.drawn(i);
  return m;
}

describe('MaskMemo', () => {
  it('draws the first frame, then keeps the paint while nothing changes', () => {
    const m = new MaskMemo();
    expect(m.same(inputs())).toBe(false);
    m.drawn(inputs());
    expect(m.same(inputs({ t: 11 }))).toBe(true);
    expect(m.same(inputs({ t: 500 }))).toBe(true);
  });

  it('draws again when anything in the paint changed', () => {
    expect(drawnWith().same(inputs({ version: 4 }))).toBe(false);
  });

  it('draws while something animates, and once more after it ends', () => {
    const m = drawnWith(inputs({ t: 10, animUntil: 12 }));
    expect(m.same(inputs({ t: 11, animUntil: 12 }))).toBe(false);
    m.drawn(inputs({ t: 11.9, animUntil: 12 }));
    // The last frame drawn was still inside the animation: one more at its end.
    expect(m.same(inputs({ t: 12.1, animUntil: 12 }))).toBe(false);
    m.drawn(inputs({ t: 12.1, animUntil: 12 }));
    expect(m.same(inputs({ t: 13, animUntil: 12 }))).toBe(true);
  });

  it('draws on a zoom, a resize or a lost context', () => {
    expect(drawnWith().same(inputs({ ws: WS * 1.01 }))).toBe(false);
    expect(drawnWith().same(inputs({ mvp: mvp(C.x, C.y, 1.01) }))).toBe(false);
    expect(drawnWith().same(inputs({ w: 801 }))).toBe(false);
    const m = drawnWith();
    m.forget();
    expect(m.same(inputs())).toBe(false);
  });

  it('lets the map pan by less than half a device pixel, counted from the last drawing', () => {
    const step = (STILL_PX / PX) * 0.6;
    const m = drawnWith();
    expect(m.same(inputs({ mvp: mvp(C.x + step, C.y) }))).toBe(true);
    // Two small pans add up: the paint follows once the sum shows.
    expect(m.same(inputs({ mvp: mvp(C.x + 2 * step, C.y) }))).toBe(false);
    expect(m.same(inputs({ mvp: mvp(C.x, C.y - 2 * step) }))).toBe(false);
  });
});
