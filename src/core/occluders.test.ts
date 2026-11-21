import { describe, expect, it } from 'vitest';
import { bboxOfCoords } from '../geo/geo';
import { GridIndex } from '../geo/spatialIndex';
import { wmX, wmY } from '../map/fog/geometry';
import { EARTH_CIRCUMFERENCE_M as C } from '../map/gl';
import { gatherOccluders, houseAt, OccluderCache, stepOutside, wmPerMetre, type Occluders } from './occluders';
import type { Building } from './types';

// A local frame in ground metres (x east, y north) around a spot in Amsterdam, mapped exactly to WM.
const lon0 = 4.88, lat0 = 52.37, m2u = wmPerMetre(lat0), X0 = wmX(lon0), Y0 = wmY(lat0);
const lonOf = (x: number) => ((X0 + x * m2u) / C) * 360 - 180;
const latOf = (y: number) => (2 * Math.atan(Math.exp(Math.PI * (1 - (2 * (Y0 - y * m2u)) / C))) - Math.PI / 2) * (180 / Math.PI);
const ring = (pts: [number, number][]) => [...pts, pts[0]].flatMap(([x, y]) => [lonOf(x), latOf(y)]);
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
function house(id: string, outer: [number, number][], holes: [number, number][][] = []): Building {
  const coords = ring(outer);
  const b: Building = { id, coords, bbox: bboxOfCoords(coords) };
  if (holes.length) b.holes = holes.map(ring);
  return b;
}
/** WM of a local point. */
const wm = (x: number, y: number): [number, number] => [X0 + x * m2u, Y0 - y * m2u];
const index = (bs: Building[]) => {
  const g = new GridIndex<Building>();
  for (const b of bs) g.insert(b);
  return g;
};
const edgesOf = (occ: Occluders, k: number) => {
  const out: number[][] = [];
  for (let e = occ.houseStart[k]; e < occ.houseStart[k + 1]; e++) out.push([...occ.edges.subarray(e * 8, e * 8 + 8)]);
  return out;
};
const cross = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => (bx - ax) * (py - ay) - (by - ay) * (px - ax);

describe('gatherOccluders', () => {
  it('drops the closing point and turns every ring so the inside is where cross > 0', () => {
    const cw = house('cw', [[10, 0], [10, 10], [20, 10], [20, 0]]);
    const ccw = house('ccw', rect(-20, 0, -10, 10));
    const [cx, cy] = wm(0, 0);
    const occ = gatherOccluders([cw, ccw], cx, cy, 100 * m2u, 1);
    expect(occ.houses.map((h) => h.id)).toEqual(['cw', 'ccw']);
    expect(occ.n).toBe(8);
    expect([...occ.houseStart]).toEqual([0, 4, 8]);
    expect([...occ.owner]).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    for (const [k, mid] of [[0, wm(15, 5)], [1, wm(-15, 5)]] as const) {
      for (const [ax, ay, bx, by] of edgesOf(occ, k)) expect(cross(ax, ay, bx, by, mid[0], mid[1])).toBeGreaterThan(0);
    }
  });

  it('chains each wall to the corners before and after it', () => {
    const occ = gatherOccluders([house('a', [[0, 0], [12, 0], [12, 6], [5, 9], [0, 6]])], ...wm(0, 0), 100 * m2u, 1);
    const es = edgesOf(occ, 0);
    expect(es).toHaveLength(5);
    for (let i = 0; i < es.length; i++) {
      const prev = es[(i + es.length - 1) % es.length], next = es[(i + 1) % es.length];
      expect([es[i][4], es[i][5]]).toEqual([prev[0], prev[1]]);
      expect([es[i][6], es[i][7]]).toEqual([next[2], next[3]]);
      expect([es[i][2], es[i][3]]).toEqual([next[0], next[1]]);
    }
  });

  it('runs courtyard rings the other way round', () => {
    const b = house('yard', rect(0, 0, 30, 30), [rect(10, 10, 20, 20)]);
    const occ = gatherOccluders([b], ...wm(0, 0), 100 * m2u, 1);
    expect(occ.n).toBe(8);
    const [yx, yy] = wm(15, 15); // in the courtyard: open air
    const es = edgesOf(occ, 0);
    for (const [ax, ay, bx, by] of es.slice(4)) {
      expect(cross(ax, ay, bx, by, yx, yy)).toBeLessThan(0);
      // Just past the wall, away from the courtyard: inside the building.
      const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = mx - yx, dy = my - yy, l = Math.hypot(dx, dy);
      expect(cross(ax, ay, bx, by, mx + dx / l, my + dy / l)).toBeGreaterThan(0);
    }
    expect(occ.rings[0]).toHaveLength(2);
  });

  it('keeps only walls within the radius, and a box per house', () => {
    const long = house('long', rect(-300, 20, 300, 30));
    const occ = gatherOccluders([long, house('far', rect(500, 0, 510, 10))], ...wm(0, 0), 50 * m2u, 1);
    expect(occ.houses.map((h) => h.id)).toEqual(['long']);
    // The two long walls come within 50 m; the short ends 300 m away do not.
    expect(occ.n).toBe(2);
    const [x0, y0] = wm(-300, 30), [x1, y1] = wm(300, 20);
    expect(occ.hbox[0]).toBeCloseTo(x0, 6);
    expect(occ.hbox[1]).toBeCloseTo(y0, 6);
    expect(occ.hbox[2]).toBeCloseTo(x1, 6);
    expect(occ.hbox[3]).toBeCloseTo(y1, 6);
  });
});

describe('OccluderCache', () => {
  const houses = index([house('a', rect(10, -5, 20, 5)), house('b', rect(-60, -5, -50, 5))]);

  it('keeps the same walls while you stay within the slack', () => {
    const cache = new OccluderCache({ radiusM: 100, slackM: 25 });
    const a = cache.around(lonOf(0), latOf(0), houses, 1);
    expect(a.version).toBe(1);
    expect(a.n).toBe(8);
    expect(a.radius).toBeCloseTo(125 * m2u, 6);
    expect(cache.around(lonOf(20), latOf(0), houses, 1)).toBe(a);
    const b = cache.around(lonOf(30), latOf(0), houses, 1);
    expect(b).not.toBe(a);
    expect(b.version).toBe(2);
  });

  it('gathers again when the houses changed', () => {
    const cache = new OccluderCache();
    const a = cache.around(lonOf(0), latOf(0), houses, 1);
    houses.insert(house('c', rect(0, 10, 10, 20)));
    const b = cache.around(lonOf(0), latOf(0), houses, 2);
    expect(b.version).toBe(a.version + 1);
    expect(b.houses.map((h) => h.id).sort()).toEqual(['a', 'b', 'c']);
  });
});

describe('stepOutside', () => {
  const occ = gatherOccluders(
    [house('a', rect(0, 0, 20, 10)), house('b', rect(18, 0, 40, 10)), house('yard', rect(100, 0, 130, 30), [rect(110, 10, 120, 20)])],
    ...wm(0, 0), 300 * m2u, 1,
  );

  it('leaves you be when you are outside', () => {
    const [x, y] = wm(-3, 5);
    expect(stepOutside(occ, x, y, m2u)).toEqual([x, y]);
    const [yx, yy] = wm(115, 15);
    expect(stepOutside(occ, yx, yy, m2u)).toEqual([yx, yy]);
  });

  it('steps out past the nearest wall', () => {
    const [x, y] = stepOutside(occ, ...wm(5, 8), m2u);
    expect(houseAt(occ, x, y)).toBe(-1);
    const [ex, ey] = wm(5, 10.6);
    expect(x).toBeCloseTo(ex, 6);
    expect(y).toBeCloseTo(ey, 6);
  });

  it('steps out of overlapping houses too', () => {
    // Nearest wall of `a` is its east end at 20 m, which is still inside `b`.
    const [x, y] = stepOutside(occ, ...wm(19.5, 5), m2u);
    expect(houseAt(occ, x, y)).toBe(-1);
  });

  it('steps from the building into its courtyard when that is nearer', () => {
    const [x, y] = stepOutside(occ, ...wm(109, 15), m2u);
    expect(houseAt(occ, x, y)).toBe(-1);
    const [ex] = wm(110.6, 15);
    expect(x).toBeCloseTo(ex, 6);
  });
});
