import { describe, expect, it } from 'vitest';
import { metresPerDegree } from '../geo/geo';
import { splitWay } from '../geo/pieces';
import { GridIndex } from '../geo/spatialIndex';
import { piecesNearSegment, piecesNearTrack } from './lighting';
import { Progress } from './progress';
import type { Piece, WayInput } from './types';

const lat0 = 52.37, lon0 = 4.88;
const m = metresPerDegree(lat0);
const lon = (x: number) => lon0 + x / m.lon;
const lat = (y: number) => lat0 + y / m.lat;
const way = (id: number, name: string | null, pts: [number, number][]): WayInput => ({
  id, name, highway: 'residential', coords: pts.flatMap(([x, y]) => [lon(x), lat(y)]),
});

/** A little grid: Main (y=0), Side (x=100, going north), Far (y=200), an unnamed path (y=20). */
function city() {
  const idx = new GridIndex<Piece>();
  for (const w of [
    way(1, 'Main', [[0, 0], [200, 0]]),
    way(2, 'Side', [[100, 0], [100, 200]]),
    way(3, 'Far', [[0, 200], [200, 200]]),
    way(4, null, [[0, 20], [60, 20]]),
  ]) {
    for (const p of splitWay(w)) idx.insert(p);
  }
  return idx;
}

describe('piecesNearSegment', () => {
  it('lights the pieces along the walked segment, within the radius', () => {
    const idx = city();
    const hits = piecesNearSegment(idx, lon(10), lat(3), lon(70), lat(3), 12);
    const ids = hits.map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['1:0', '1:1', '1:2', '1:3']));
    expect(ids.some((id) => id.startsWith('3:'))).toBe(false);
    // the unnamed path 17 m away is outside a 12 m radius…
    expect(ids.some((id) => id.startsWith('4:'))).toBe(false);
    // …but inside a 25 m one (weak accuracy)
    const wide = piecesNearSegment(idx, lon(10), lat(3), lon(70), lat(3), 25).map((p) => p.id);
    expect(wide.some((id) => id.startsWith('4:'))).toBe(true);
  });

  it('touches only the first piece of a crossing street', () => {
    const idx = city();
    const ids = piecesNearSegment(idx, lon(80), lat(0), lon(120), lat(0), 12).map((p) => p.id);
    expect(ids).toContain('2:0');
    expect(ids).not.toContain('2:1');
  });
});

describe('piecesNearTrack', () => {
  it('replays a recorded track once streets arrive', () => {
    const idx = city();
    const segs = [lon(95), lat(10), lon(98), lat(60), 12, lon(98), lat(60), lon(101), lat(120), 12];
    const ids = piecesNearTrack(idx, segs).map((p) => p.id);
    expect(ids).toEqual(expect.arrayContaining(['2:0', '2:1', '2:2', '2:3', '2:4', '2:5']));
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('Progress', () => {
  it('reports new pieces and first-time streets, counting visits once per walk', () => {
    const idx = city();
    const prog = new Progress();
    const main = idx.query([lon(-1), lat(-1), lon(39), lat(1)]).filter((p) => p.name === 'Main');
    expect(main.length).toBe(2);

    const r1 = prog.apply(main, 'walk-1', 1000);
    expect(r1.newPieces).toHaveLength(2);
    expect(r1.newStreets).toEqual(['Main']);
    expect(prog.streetsMet).toBe(1);
    expect(prog.litLenM).toBeCloseTo(40, 0);

    const again = prog.apply(main, 'walk-1', 2000);
    expect(again.changed).toHaveLength(0);
    expect(prog.lit.get(main[0].id)!.visits).toBe(1);

    const r2 = prog.apply(main, 'walk-2', 3000);
    expect(r2.newPieces).toHaveLength(0);
    expect(r2.newStreets).toEqual([]);
    expect(r2.changed).toHaveLength(2);
    expect(prog.lit.get(main[0].id)!.visits).toBe(2);
    expect(prog.lit.get(main[0].id)!.litAt).toBe(1000);
  });

  it('counts unnamed pieces as paths, not streets', () => {
    const idx = city();
    const prog = new Progress();
    const path = [...idx.values()].filter((p) => p.way === 4);
    const r = prog.apply(path, 'w', 1);
    expect(r.newPieces.length).toBe(path.length);
    expect(r.newStreets).toEqual([]);
    expect(prog.streetsMet).toBe(0);
    expect(prog.pathPiecesLit).toBe(path.length);
  });

  it('reloads saved records', () => {
    const idx = city();
    const a = new Progress();
    a.apply(idx.values(), 'w', 5);
    const b = new Progress();
    b.load(a.lit.values());
    expect(b.piecesLit).toBe(a.piecesLit);
    expect(b.streetsMet).toBe(3);
    expect(b.litLenM).toBeCloseTo(a.litLenM, 6);
  });
});
