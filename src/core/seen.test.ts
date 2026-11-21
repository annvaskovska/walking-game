import { describe, expect, it } from 'vitest';
import { bboxOfCoords } from '../geo/geo';
import { wmX, wmY } from '../map/fog/geometry';
import { EARTH_CIRCUMFERENCE_M as C } from '../map/gl';
import { gatherOccluders, noOccluders, wmPerMetre } from './occluders';
import { SEEN_TEXEL as T, SEEN_TILE, SeenGrid, type LightShape } from './seen';
import { computeSight } from './sight';
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
const RAD = Math.PI / 180;
const light = (o: Partial<LightShape> = {}): LightShape => ({
  lantern: 40 * m2u, cone: 110 * m2u, dir: 0, inner: 19 * RAD, outer: 38 * RAD, coneOn: 0, ...o,
});
/** Paint from local spot (x, y) with these walls. */
function paintFrom(g: SeenGrid, x: number, y: number, bs: Building[], l: LightShape) {
  const vx = X0 + x * m2u, vy = Y0 - y * m2u;
  const occ = bs.length ? gatherOccluders(bs, vx, vy, 200 * m2u, 1) : noOccluders(vx, vy, 1);
  return g.paint(computeSight(vx, vy, occ, 114 * m2u), l);
}
/** Seen value at a local point. */
const at = (g: SeenGrid, x: number, y: number) => g.at(X0 + x * m2u, Y0 - y * m2u);

describe('SeenGrid.paint', () => {
  it('paints the four tiles around a tile corner', () => {
    const g = new SeenGrid();
    const cx = Math.round(X0 / (T * SEEN_TILE)) * T * SEEN_TILE, cy = Math.round(Y0 / (T * SEEN_TILE)) * T * SEEN_TILE;
    const occ = noOccluders(cx, cy, 1);
    const changed = g.paint(computeSight(cx, cy, occ, 20 * m2u), light({ lantern: 10 * m2u }));
    expect(changed).toHaveLength(4);
    expect(new Set(changed.map((t) => t.key)).size).toBe(4);
    expect(g.tiles.size).toBe(4);
    for (const [dx, dy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) expect(g.at(cx + dx * 3 * m2u, cy + dy * 3 * m2u)).toBeGreaterThan(0.9);
  });

  it('fades like the lantern and the cone of the prototype', () => {
    const g = new SeenGrid();
    paintFrom(g, 0, 0, [], light({ coneOn: 1 }));
    expect(at(g, 0, 0)).toBeGreaterThan(0.98);
    expect(at(g, 0, 20)).toBeCloseTo(0.92, 1);
    expect(at(g, -30, 0)).toBeCloseTo(1.84 * 0.25, 1);
    expect(at(g, 0, -41)).toBe(0);
    // Ahead: the cone, 0.72 at 0.45 of its reach, fading out between 19° and 38° off the beam.
    expect(at(g, 49.5, 0)).toBeCloseTo(0.72, 1);
    const off = (deg: number, r: number) => at(g, Math.cos(deg * RAD) * r, Math.sin(deg * RAD) * r);
    expect(off(10, 60)).toBeCloseTo(((1 - 60 / 110) * 0.72) / 0.55, 1);
    expect(off(28.5, 60)).toBeCloseTo((((1 - 60 / 110) * 0.72) / 0.55) * 0.5, 1);
    expect(off(45, 60)).toBe(0);
    expect(at(g, 112, 0)).toBe(0);
  });

  it('paints nothing ahead when the cone is off', () => {
    const g = new SeenGrid();
    paintFrom(g, 0, 0, [], light({ coneOn: 0 }));
    expect(at(g, 30, 0)).toBeGreaterThan(0);
    expect(at(g, 45, 0)).toBe(0);
  });

  it('stops at walls', () => {
    const g = new SeenGrid();
    const wall = house('a', rect(10, -5, 20, 5));
    paintFrom(g, 0, 0, [wall], light());
    expect(at(g, 8, 0)).toBeGreaterThan(0.5);
    expect(at(g, 15, 0)).toBe(0); // inside the house
    expect(at(g, 25, 0)).toBe(0); // behind it
    expect(at(g, 30, 3)).toBe(0);
    expect(at(g, 25, 15)).toBeGreaterThan(0); // beside it
    expect(at(g, -20, 0)).toBeGreaterThan(0);
    // Every texel the light reached is in front of the wall.
    for (let y = -4.5; y <= 4.5; y += 0.5) for (let x = 10.4; x < 39; x += 0.5) expect(at(g, x, y)).toBe(0);
  });

  it('only ever brightens: painting twice is the max of both', () => {
    const walls = [house('a', rect(10, -5, 20, 5)), house('b', rect(-15, 12, 5, 30))];
    const la = light({ coneOn: 1, dir: 0.3 }), lb = light({ coneOn: 0.6, dir: 2.2 });
    const ga = new SeenGrid(), gb = new SeenGrid(), gab = new SeenGrid();
    paintFrom(ga, 0, 0, walls, la);
    paintFrom(gb, 14, 9, walls, lb);
    paintFrom(gab, 0, 0, walls, la);
    const before = new Map([...gab.tiles].map(([k, t]) => [k, t.data.slice()]));
    paintFrom(gab, 14, 9, walls, lb);
    for (const [k, t] of gab.tiles) {
      const a = ga.tiles.get(k)?.data, b = gb.tiles.get(k)?.data, old = before.get(k);
      const want = new Uint8Array(t.data.length);
      for (let i = 0; i < want.length; i++) want[i] = Math.max(a?.[i] ?? 0, b?.[i] ?? 0);
      expect(t.data).toEqual(want);
      if (old) expect(old.every((v, i) => t.data[i] >= v)).toBe(true);
    }
  });
});

describe('SeenGrid bookkeeping', () => {
  it('bumps the version of changed tiles and hands them out once for saving', () => {
    const g = new SeenGrid();
    const first = paintFrom(g, 0, 0, [], light({ coneOn: 1 }));
    expect(first.length).toBeGreaterThan(0);
    const versions = new Map(first.map((t) => [t.key, t.version]));
    expect(g.dirtyCount).toBe(first.length);
    expect(g.takeDirty().map((t) => t.key).sort()).toEqual([...versions.keys()].sort());
    expect(g.takeDirty()).toEqual([]);
    // The same look again adds nothing.
    expect(paintFrom(g, 0, 0, [], light({ coneOn: 1 }))).toEqual([]);
    for (const t of g.tiles.values()) expect(t.version).toBe(versions.get(t.key));
    expect(g.dirtyCount).toBe(0);
    // A step on: only what got brighter changes.
    const next = paintFrom(g, 5, 0, [], light({ coneOn: 1 }));
    expect(next.length).toBeGreaterThan(0);
    for (const t of next) expect(t.version).toBe((versions.get(t.key) ?? 1) + 1);
  });

  it('loads saved tiles back', () => {
    const g = new SeenGrid();
    paintFrom(g, 0, 0, [house('a', rect(10, -5, 20, 5))], light({ coneOn: 1, dir: 1 }));
    const saved = g.takeDirty().map((t) => ({ key: t.key, data: t.data.slice() }));
    const h = new SeenGrid();
    h.load([...saved, { key: 'nonsense', data: new Uint8Array(4) }, { key: '16/1/2', data: new Uint8Array(65536) }]);
    expect(h.tiles.size).toBe(saved.length);
    expect(h.dirtyCount).toBe(0);
    for (const s of saved) expect(h.tiles.get(s.key)?.data).toEqual(s.data);
    for (let y = -50; y <= 50; y += 3.7) for (let x = -50; x <= 120; x += 4.1) expect(at(h, x, y)).toBe(at(g, x, y));
  });
});
