import { describe, expect, it } from 'vitest';
import { metresPerDegree } from '../geo/geo';
import { splitWay } from '../geo/pieces';
import { GridIndex } from '../geo/spatialIndex';
import { buildBlocks } from './blocks';
import { Progress, toStoredHouse } from './progress';
import type { Building, LitHouse, Piece, WayInput } from './types';

const lat0 = 52.37, lon0 = 4.88;
const m = metresPerDegree(lat0);
const lon = (x: number) => lon0 + x / m.lon;
const lat = (y: number) => lat0 + y / m.lat;
const way = (id: number, name: string | null, pts: [number, number][], kind: WayInput['kind'] = 'road'): WayInput => ({
  id, name, highway: kind === 'road' ? 'residential' : 'footway', kind,
  coords: pts.flatMap(([x, y]) => [lon(x), lat(y)]),
});

/** A little grid: Main (y=0), Side (x=100, going north), Far (y=200), an unnamed path (y=20). */
function city(): GridIndex<Piece> {
  const idx = new GridIndex<Piece>();
  for (const w of [
    way(1, 'Main', [[0, 0], [200, 0]]),
    way(2, 'Side', [[100, 0], [100, 200]]),
    way(3, 'Far', [[0, 200], [200, 200]]),
    way(4, null, [[0, 20], [60, 20]], 'path'),
  ]) {
    for (const p of splitWay(w)) idx.insert(p);
  }
  return idx;
}

function ring(x: number, y: number, size: number): number[] {
  return [
    lon(x), lat(y),
    lon(x + size), lat(y),
    lon(x + size), lat(y + size),
    lon(x), lat(y + size),
    lon(x), lat(y),
  ];
}

describe('Progress', () => {
  it('reports new pieces and first-time streets, counting visits once per walk', () => {
    const idx = city();
    const prog = new Progress();
    const main = idx.query([lon(-1), lat(-1), lon(39), lat(1)]).filter((p) => p.name === 'Main');
    expect(main).toHaveLength(2);

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

  it('reloads saved records and gives old records without a kind a sensible one', () => {
    const idx = city();
    const a = new Progress();
    a.apply(idx.values(), 'w', 5);
    const b = new Progress();
    b.load(a.lit.values());
    expect(b.piecesLit).toBe(a.piecesLit);
    expect(b.streetsMet).toBe(3);
    expect(b.litLenM).toBeCloseTo(a.litLenM, 6);

    const old = [...a.lit.values()].find((r) => r.way === 4)!;
    const legacy = { ...old } as Partial<typeof old>;
    delete legacy.kind;
    const c = new Progress();
    c.load([legacy as typeof old]);
    expect(c.lit.get(old.id)!.kind).toBe('path');
  });

  it('lights a whole block and its houses exactly once', () => {
    const w = way(9, 'Blockska', [[0, 0], [100, 0]]);
    const pieces = splitWay(w);
    const [block] = buildBlocks(w, pieces);
    const houses: Building[] = [
      { id: 'b1', coords: ring(10, 5, 8), bbox: [lon(10), lat(5), lon(18), lat(13)] },
      { id: 'b2', coords: ring(60, -13, 8), bbox: [lon(60), lat(-13), lon(68), lat(-5)] },
    ];
    const prog = new Progress();
    const r = prog.applyBlock(block, houses, 'w', 1000);
    expect(r.newPieces).toHaveLength(5);
    expect(r.newStreets).toEqual(['Blockska']);
    expect(r.newHouses.map((h) => h.id)).toEqual(['b1', 'b2']);
    expect(prog.housesLit).toBe(2);
    expect(prog.isBlockLit(block)).toBe(true);

    const again = prog.applyBlock(block, houses, 'w', 2000);
    expect(again.newPieces).toHaveLength(0);
    expect(again.newHouses).toHaveLength(0);
    expect(prog.housesLit).toBe(2);
  });

  it('recognises blocks that were already fully lit before they were loaded', () => {
    const w = way(10, 'Old', [[0, 0], [40, 0]]);
    const pieces = splitWay(w);
    const [block] = buildBlocks(w, pieces);
    const prog = new Progress();
    prog.apply(pieces.slice(0, 1), 'w', 1);
    expect(prog.isBlockLit(block)).toBe(false);
    prog.apply(pieces.slice(1), 'w', 2);
    expect(prog.isBlockLit(block)).toBe(true);
  });

  it('reloads saved houses and strips their drawing cache when saving', () => {
    const h: LitHouse = {
      id: 'b7', coords: ring(0, 0, 5), bbox: [lon(0), lat(0), lon(5), lat(5)],
      litAt: 10, block: 3, merc: new Float64Array([1, 2]),
    };
    const prog = new Progress();
    prog.loadHouses([h]);
    expect(prog.housesLit).toBe(1);
    expect(prog.houses.get('b7')?.block).toBe(3);
    expect(toStoredHouse(h).merc).toBeUndefined();
  });
});
