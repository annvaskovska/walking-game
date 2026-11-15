import { describe, expect, it } from 'vitest';
import { metresPerDegree } from '../geo/geo';
import { splitWay } from '../geo/pieces';
import { GridIndex } from '../geo/spatialIndex';
import { Blocks, type Block } from './blocks';
import type { Piece, PieceKind, WayInput } from './types';
import { WalkAlong } from './walkAlong';

const lat0 = 52.37, lon0 = 4.88;
const m = metresPerDegree(lat0);
const lon = (x: number) => lon0 + x / m.lon;
const lat = (y: number) => lat0 + y / m.lat;
const p = (x: number, y: number): [number, number] => [lon(x), lat(y)];

interface WaySpec {
  id: number;
  name?: string | null;
  kind?: PieceKind;
  highway?: string;
  from: [number, number];
  to: [number, number];
  junctionsM?: number[];
}

function way(spec: WaySpec): WayInput {
  return {
    id: spec.id,
    name: spec.name === undefined ? 'Main' : spec.name,
    highway: spec.highway ?? 'residential',
    kind: spec.kind ?? 'road',
    junctionsM: spec.junctionsM,
    coords: [...p(...spec.from), ...p(...spec.to)],
  };
}

function city(specs: WaySpec[]) {
  const index = new GridIndex<Piece>();
  const blocks = new Blocks();
  for (const spec of specs) {
    const w = way(spec);
    const pieces = splitWay(w);
    for (const piece of pieces) index.insert(piece);
    blocks.add(w, pieces);
  }
  return { index, blocks };
}

function walk(
  wa: WalkAlong,
  points: [number, number][],
  radiusM = 12,
): Block[] {
  const out: Block[] = [];
  for (let i = 1; i < points.length; i++) {
    out.push(...wa.add(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], radiusM));
  }
  return out;
}

/** Points along a straight line at `y`, from x=fromM to x=toM in `stepM` steps. */
function east(y: number, fromM: number, toM: number, stepM = 10): [number, number][] {
  const out: [number, number][] = [];
  for (let x = fromM; x < toM; x += stepM) out.push(p(x, y));
  out.push(p(toM, y));
  return out;
}

describe('WalkAlong', () => {
  it('unlocks the whole block once about half of it has been walked', () => {
    const { index, blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const wa = new WalkAlong(blocks, index);
    expect(walk(wa, east(0, 0, 40))).toHaveLength(0);
    const unlocked = walk(wa, east(0, 40, 55));
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0].name).toBe('Main');
    expect(unlocked[0].pieces).toHaveLength(5);
    expect(unlocked[0].lenM).toBeCloseTo(100, 1);
  });

  it('does not light a street it only crosses', () => {
    const { index, blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const wa = new WalkAlong(blocks, index);
    const out = walk(wa, [p(50, -15), p(50, -10), p(50, -5), p(50, 0), p(50, 5), p(50, 10), p(50, 15)]);
    expect(out).toHaveLength(0);
  });

  it('touches only the parallel street it walks on, not the next one over', () => {
    const { index, blocks } = city([
      { id: 1, name: 'Main', from: [0, 0], to: [100, 0] },
      { id: 2, name: 'Other', from: [0, 12], to: [100, 12] },
    ]);
    const wa = new WalkAlong(blocks, index);
    const out = walk(wa, east(0, 0, 60));
    expect(out.map((b) => b.name)).toEqual(['Main']);
    expect(out.some((b) => b.name === 'Other')).toBe(false);
  });

  it('lights the road under a tagged sidewalk, never the sidewalk itself', () => {
    const { index, blocks } = city([
      { id: 1, name: 'Main', from: [0, 0], to: [100, 0] },
      { id: 2, name: null, kind: 'side', highway: 'footway', from: [0, 3], to: [100, 3] },
    ]);
    const wa = new WalkAlong(blocks, index);
    const out = walk(wa, east(3, 0, 60));
    expect(out.map((b) => b.name)).toEqual(['Main']);
  });

  it('treats an untagged footway beside a road as that road’s sidewalk', () => {
    const { index, blocks } = city([
      { id: 1, name: 'Main', from: [0, 0], to: [100, 0] },
      { id: 2, name: null, kind: 'path', highway: 'footway', from: [0, 3], to: [100, 3] },
    ]);
    const wa = new WalkAlong(blocks, index);
    const out = walk(wa, east(0, 0, 60));
    expect(out.map((b) => b.name)).toEqual(['Main']);
  });

  it('lights a path away from the street grid on its own', () => {
    const { index, blocks } = city([
      { id: 1, name: null, kind: 'path', highway: 'footway', from: [0, 50], to: [100, 50] },
    ]);
    const wa = new WalkAlong(blocks, index);
    const out = walk(wa, east(50, 0, 60));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('path');
  });

  it('never counts the same stretch twice when backtracking', () => {
    const { index, blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const wa = new WalkAlong(blocks, index);
    expect(walk(wa, east(0, 0, 30))).toHaveLength(0);
    expect(walk(wa, east(0, 30, 0))).toHaveLength(0);
    expect(walk(wa, east(0, 0, 30))).toHaveLength(0);
    expect(walk(wa, east(0, 30, 45))).toHaveLength(0);
    expect(walk(wa, east(0, 45, 55))).toHaveLength(1);
  });

  it('replays saved segments into the same blocks', () => {
    const { index, blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const points = east(0, 0, 70);
    const segs: number[] = [];
    for (let i = 1; i < points.length; i++) {
      segs.push(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], 12);
    }
    const live = walk(new WalkAlong(blocks, index), points);
    const replayed = new WalkAlong(blocks, index).replay(segs);
    expect(replayed.map((b) => b.id)).toEqual(live.map((b) => b.id));
  });

  it('does not report blocks that are already lit', () => {
    const { index, blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const wa = new WalkAlong(blocks, index, () => true);
    expect(walk(wa, east(0, 0, 60))).toHaveLength(0);
  });

  it('unlocks a short block only after walking along enough of it', () => {
    const { index, blocks } = city([{ id: 1, from: [0, 0], to: [12, 0] }]);
    const wa = new WalkAlong(blocks, index);
    expect(walk(wa, east(0, 0, 6))).toHaveLength(0);
    expect(walk(wa, east(0, 6, 10))).toHaveLength(1);
  });
});
