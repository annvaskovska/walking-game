import { describe, expect, it } from 'vitest';
import { HOUSE_FLOATS, RIB_FLOATS, makeOrigin, miter, pushHouse, sweepTime, type Mesh } from './geometry';

describe('sweepTime', () => {
  // He is 30 m along, walking 1.5 m/s; the crayon catches up at 50 m/s.
  const s = { fromM: 0, headM: 30, mps: 1.5, t0: 100 };

  it('colors fast up to him, then keeps his pace', () => {
    expect(sweepTime(s, 0, 50)).toBe(100);
    expect(sweepTime(s, 25, 50)).toBeCloseTo(100.5);
    expect(sweepTime(s, 45, 50)).toBeCloseTo(110);
  });

  it('colors from the end he walked in from', () => {
    expect(sweepTime({ ...s, fromM: 80 }, 55, 50)).toBeCloseTo(100.5);
  });
});

describe('miter', () => {
  it('pushes a right-angle corner out along its bisector, far enough for both edges', () => {
    const [mx, my] = miter(0, 0, 10, 0, 10, 10);
    expect(mx).toBeCloseTo(-1);
    expect(my).toBeCloseTo(1);
  });

  it('ends a line square', () => {
    const [mx, my] = miter(NaN, NaN, 0, 0, 10, 0);
    expect(mx).toBeCloseTo(0);
    expect(my).toBeCloseTo(1);
  });
});

describe('pushHouse', () => {
  const o = makeOrigin(4.88, 52.37);
  const u = 2.4;
  // A 10 m house in Amsterdam, as lon/lat.
  const dLon = 10 / (111_320 * Math.cos((52.37 * Math.PI) / 180)), dLat = 10 / 110_574;
  const house = (id: string) => ({ id, coords: [4.88, 52.37, 4.88 + dLon, 52.37, 4.88 + dLon, 52.37 + dLat, 4.88, 52.37 + dLat, 4.88, 52.37] });

  it('hatches the footprint off register, under an outline on the same shape', () => {
    const fill: Mesh = { v: [], i: [] }, rib: Mesh = { v: [], i: [] };
    expect(pushHouse(fill, rib, o, u, house('a'), 5, 3)).toBe(true);
    expect(fill.i).toHaveLength(6);
    const [x, y, , , tOn, strokes, tone] = fill.v;
    expect([tOn, tone]).toEqual([5, 3]);
    // About one stroke every 0.8 units across a box some 7-9 units on a side.
    expect(strokes).toBeGreaterThan(8);
    expect(strokes).toBeLessThan(16);
    // The outline's first corner is the fill's: both shifted 0.42 to 0.92 units.
    expect(rib.v[0]).toBeCloseTo(x);
    expect(rib.v[1]).toBeCloseTo(y);
    const shift = Math.abs(x) / u;
    expect(shift).toBeGreaterThanOrEqual(0.42);
    expect(shift).toBeLessThanOrEqual(0.92);
  });

  it('keeps each house its own hatch, the same on every load', () => {
    const run = (id: string) => {
      const fill: Mesh = { v: [], i: [] }, rib: Mesh = { v: [], i: [] };
      pushHouse(fill, rib, o, u, house(id), 0, 0);
      return { v: fill.v.slice(0, HOUSE_FLOATS), ribs: rib.v.length / RIB_FLOATS };
    };
    expect(run('a')).toEqual(run('a'));
    expect(run('a').v).not.toEqual(run('b').v);
  });
});
