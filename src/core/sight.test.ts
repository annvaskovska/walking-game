import { describe, expect, it } from 'vitest';
import { bboxOfCoords } from '../geo/geo';
import { wmX, wmY } from '../map/fog/geometry';
import { EARTH_CIRCUMFERENCE_M as C } from '../map/gl';
import { gatherOccluders, houseAt, noOccluders, stepOutside, wmPerMetre } from './occluders';
import { computeSight, newSight, sightDistance, type Sight } from './sight';
import type { Building } from './types';

// A local frame in ground metres (x east, y north) around a spot in Amsterdam, mapped exactly to WM.
const lon0 = 4.88, lat0 = 52.37, m2u = wmPerMetre(lat0), X0 = wmX(lon0), Y0 = wmY(lat0);
const lonOf = (x: number) => ((X0 + x * m2u) / C) * 360 - 180;
const latOf = (y: number) => (2 * Math.atan(Math.exp(Math.PI * (1 - (2 * (Y0 - y * m2u)) / C))) - Math.PI / 2) * (180 / Math.PI);
const ring = (pts: [number, number][]) => [...pts, pts[0]].flatMap(([x, y]) => [lonOf(x), latOf(y)]);
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const house = (id: string, outer: [number, number][]): Building => {
  const coords = ring(outer);
  return { id, coords, bbox: bboxOfCoords(coords) };
};
const wm = (x: number, y: number): [number, number] => [X0 + x * m2u, Y0 - y * m2u];
/** WM angle towards a local direction (east, north). */
const toward = (x: number, y: number) => Math.atan2(-y, x);
const occOf = (bs: Building[]) => gatherOccluders(bs, X0, Y0, 300 * m2u, 1);
/** Free distance in ground metres towards a local point, from the sight's centre. */
const freeM = (s: Sight, x: number, y: number) => sightDistance(s, toward(x, y)) / m2u;
const R = 100 * m2u;

describe('computeSight', () => {
  it('sees all round with no walls', () => {
    const s = computeSight(X0, Y0, noOccluders(X0, Y0, 1), R);
    expect(s.n).toBe(240);
    for (let i = 1; i < s.n; i++) expect(s.ang[i]).toBeGreaterThan(s.ang[i - 1]);
    expect(s.ang[0]).toBeGreaterThan(-Math.PI);
    expect(s.ang[s.n - 1]).toBeLessThanOrEqual(Math.PI);
    for (let i = 0; i < s.n; i++) {
      expect(s.dist[i]).toBe(R);
      expect(s.hit[i]).toBe(-1);
    }
    for (const a of [-Math.PI, -1, 0, 2, Math.PI, 7]) expect(sightDistance(s, a)).toBeCloseTo(R, 9);
  });

  it('stops at a wall, not beside it', () => {
    const occ = occOf([house('a', rect(20, -5, 30, 5))]);
    const s = computeSight(X0, Y0, occ, R);
    expect(freeM(s, 1, 0)).toBeCloseTo(20, 6);
    expect(freeM(s, 20, 4)).toBeCloseTo(Math.hypot(20, 4), 3);
    expect(freeM(s, 1, 1)).toBeCloseTo(100, 6);
    expect(freeM(s, -1, 0)).toBeCloseTo(100, 6);
    // Just past its corner the ray slips by.
    expect(freeM(s, 20, 5.05)).toBeCloseTo(100, 3);
    expect(freeM(s, 20, 4.95)).toBeCloseTo(Math.hypot(20, 4.95), 2);
  });

  it('only counts walls within the radius', () => {
    const occ = occOf([house('a', rect(20, -5, 30, 5))]);
    const s = computeSight(X0, Y0, occ, 15 * m2u);
    expect(s.n).toBe(240);
    expect(freeM(s, 1, 0)).toBeCloseTo(15, 6);
  });

  it('sees far along a street, not through the houses beside it', () => {
    const houses: Building[] = [];
    for (let x = -150; x < 150; x += 20) {
      houses.push(house(`n${x}`, rect(x, 7, x + 20, 25)));
      houses.push(house(`s${x}`, rect(x, -25, x + 20, -7)));
    }
    const occ = occOf(houses);
    const s = computeSight(...wm(3, 0), occ, R);
    expect(freeM(s, 1, 0)).toBeCloseTo(100, 6);
    expect(freeM(s, -1, 0)).toBeCloseTo(100, 6);
    expect(freeM(s, 0, 1)).toBeCloseTo(7, 3);
    expect(freeM(s, 0, -1)).toBeCloseTo(7, 3);
    // Up the street at a slant: stopped by the facades, at the right spot.
    for (const [dx, dy] of [[30, 15], [-60, 10], [80, -9], [5, -40]]) {
      const t = 7 / Math.abs(dy);
      expect(freeM(s, dx, dy)).toBeCloseTo(Math.hypot(dx * t, dy * t), 2);
    }
    // Along the street every ray ends within the street or at the radius.
    for (let i = 0; i < s.n; i++) {
      const d = s.dist[i] / m2u, y = -Math.sin(s.ang[i]) * d;
      expect(Math.abs(y)).toBeLessThanOrEqual(7 + 1e-6);
    }
  });

  it('lets a ray through a narrow gap between two corners', () => {
    const occ = occOf([house('n', rect(10, 0.5, 20, 10)), house('s', rect(10, -10, 20, -0.5)), house('back', rect(60, -20, 70, 20))]);
    const s = computeSight(X0, Y0, occ, R);
    expect(freeM(s, 1, 0)).toBeCloseTo(60, 3);
    for (let i = 0; i < s.n; i++) if (Math.abs(s.ang[i]) < 0.02) expect(occ.houses[s.hit[i]].id).toBe('back');
    expect(freeM(s, 10, 3)).toBeCloseTo(Math.hypot(10, 3), 3);
  });

  it('reports the house each ray stops at', () => {
    const occ = occOf([house('east', rect(20, -5, 30, 5)), house('west', rect(-30, -5, -20, 5)), house('north', rect(-5, 40, 5, 50))]);
    const s = computeSight(X0, Y0, occ, R);
    const hitAt = (a: number) => {
      let best = 0;
      for (let i = 1; i < s.n; i++) if (Math.abs(s.ang[i] - a) < Math.abs(s.ang[best] - a)) best = i;
      return s.hit[best] < 0 ? null : occ.houses[s.hit[best]].id;
    };
    expect(hitAt(toward(1, 0))).toBe('east');
    expect(hitAt(toward(-1, 0.01))).toBe('west');
    expect(hitAt(toward(-1, -0.01))).toBe('west');
    expect(hitAt(toward(0, 1))).toBe('north');
    expect(hitAt(toward(0, -1))).toBe(null);
    // West straddles ±PI: both sides of the seam agree.
    expect(sightDistance(s, Math.PI)).toBeCloseTo(20 * m2u, 3);
    expect(sightDistance(s, -Math.PI + 1e-9)).toBeCloseTo(20 * m2u, 3);
    expect(sightDistance(s, 3 * Math.PI)).toBeCloseTo(20 * m2u, 3);
  });

  it('sees out of a house GPS put you in, once stepped outside', () => {
    const occ = occOf([house('in', rect(-10, -10, 10, 2)), house('across', rect(-10, 15, 10, 30))]);
    const [x, y] = stepOutside(occ, X0, Y0, m2u);
    expect(houseAt(occ, x, y)).toBe(-1);
    const s = computeSight(x, y, occ, R);
    // Out of the north wall (2 m away): the street ahead, the house across, and your own wall behind.
    expect(freeM(s, 0, 1)).toBeCloseTo(15 - 2.6, 3);
    expect(freeM(s, 0, -1)).toBeCloseTo(0.6, 3);
    expect(freeM(s, 1, 0)).toBeCloseTo(100, 6);
  });

  it('reuses the arrays it is given', () => {
    const occ = occOf([house('a', rect(20, -5, 30, 5))]);
    const out = newSight(4096);
    const ang = out.ang;
    expect(computeSight(X0, Y0, occ, R, out)).toBe(out);
    expect(out.ang).toBe(ang);
    const n = out.n;
    computeSight(...wm(1, 1), occ, R, out);
    expect(out.ang).toBe(ang);
    expect(out.n).toBe(n);
  });
});
