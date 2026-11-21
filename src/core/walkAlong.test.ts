import { describe, expect, it } from 'vitest';
import { metresPerDegree } from '../geo/geo';
import { splitWay } from '../geo/pieces';
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
}

function way(spec: WaySpec): WayInput {
  return {
    id: `w${spec.id}`,
    name: spec.name === undefined ? 'Main' : spec.name,
    highway: spec.highway ?? 'residential',
    kind: spec.kind ?? 'road',
    coords: [...p(...spec.from), ...p(...spec.to)],
  };
}

function city(specs: WaySpec[]) {
  const blocks = new Blocks();
  for (const spec of specs) {
    const w = way(spec);
    blocks.add(w, splitWay(w));
  }
  return { blocks };
}

/** Walk the points; returns the blocks completed. */
function walk(wa: WalkAlong, points: [number, number][], radiusM = 12): Block[] {
  return walkAll(wa, points, radiusM).blocks;
}

function walkAll(wa: WalkAlong, points: [number, number][], radiusM = 12): { blocks: Block[]; pieces: Piece[] } {
  const out = { blocks: [] as Block[], pieces: [] as Piece[] };
  for (let i = 1; i < points.length; i++) {
    const w = wa.add(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], radiusM);
    out.blocks.push(...w.blocks);
    out.pieces.push(...w.pieces);
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
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const wa = new WalkAlong(blocks);
    expect(walk(wa, east(0, 0, 40))).toHaveLength(0);
    const unlocked = walk(wa, east(0, 40, 55));
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0].name).toBe('Main');
    expect(unlocked[0].pieces).toHaveLength(5);
    expect(unlocked[0].lenM).toBeCloseTo(100, 1);
  });

  it('does not light a street it only crosses', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const wa = new WalkAlong(blocks);
    const out = walk(wa, [p(50, -15), p(50, -10), p(50, -5), p(50, 0), p(50, 5), p(50, 10), p(50, 15)]);
    expect(out).toHaveLength(0);
  });

  it('touches only the parallel street it walks on, not the next one over', () => {
    const { blocks } = city([
      { id: 1, name: 'Main', from: [0, 0], to: [100, 0] },
      { id: 2, name: 'Other', from: [0, 12], to: [100, 12] },
    ]);
    const wa = new WalkAlong(blocks);
    const out = walk(wa, east(0, 0, 60));
    expect(out.map((b) => b.name)).toEqual(['Main']);
    expect(out.some((b) => b.name === 'Other')).toBe(false);
  });

  it('lights the road under a tagged sidewalk, never the sidewalk itself', () => {
    const { blocks } = city([
      { id: 1, name: 'Main', from: [0, 0], to: [100, 0] },
      { id: 2, name: null, kind: 'side', highway: 'footway', from: [0, 3], to: [100, 3] },
    ]);
    const wa = new WalkAlong(blocks);
    const out = walk(wa, east(3, 0, 60));
    expect(out.map((b) => b.name)).toEqual(['Main']);
  });

  it('treats an untagged footway beside a road as that road’s sidewalk', () => {
    const { blocks } = city([
      { id: 1, name: 'Main', from: [0, 0], to: [100, 0] },
      { id: 2, name: null, kind: 'path', highway: 'footway', from: [0, 3], to: [100, 3] },
    ]);
    const wa = new WalkAlong(blocks);
    const out = walk(wa, east(0, 0, 60));
    expect(out.map((b) => b.name)).toEqual(['Main']);
  });

  it('lights a path away from the street grid on its own', () => {
    const { blocks } = city([
      { id: 1, name: null, kind: 'path', highway: 'footway', from: [0, 50], to: [100, 50] },
    ]);
    const wa = new WalkAlong(blocks);
    const out = walk(wa, east(50, 0, 60));
    expect(out).toHaveLength(1);
    expect(out[0].kind).toBe('path');
  });

  it('never counts the same stretch twice when backtracking', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const wa = new WalkAlong(blocks);
    expect(walk(wa, east(0, 0, 30))).toHaveLength(0);
    expect(walk(wa, east(0, 30, 0))).toHaveLength(0);
    expect(walk(wa, east(0, 0, 30))).toHaveLength(0);
    expect(walk(wa, east(0, 30, 45))).toHaveLength(0);
    expect(walk(wa, east(0, 45, 55))).toHaveLength(1);
  });

  it('replays saved segments into the same blocks', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const points = east(0, 0, 70);
    const segs: number[] = [];
    for (let i = 1; i < points.length; i++) {
      segs.push(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], 12);
    }
    const live = walk(new WalkAlong(blocks), points);
    const replayed = new WalkAlong(blocks).replay(segs);
    expect(replayed.blocks.map((b) => b.id)).toEqual(live.map((b) => b.id));
    // The pieces walked before the block completed come with the block, not twice.
    expect(replayed.pieces).toHaveLength(0);
  });

  it('lights the pieces walked in a block that is not complete', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const wa = new WalkAlong(blocks);
    // 30 m of a 100 m block: the first piece is walked whole, the second by half.
    const out = walkAll(wa, east(0, 0, 30, 5));
    expect(out.blocks).toHaveLength(0);
    expect(out.pieces.map((q) => q.idx)).toEqual([0, 1]);
    // Walking the same stretch again reports nothing new.
    expect(walkAll(wa, east(0, 30, 0, 5)).pieces).toHaveLength(0);
  });

  it('does not light a piece only brushed at its end', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const out = walkAll(new WalkAlong(blocks), east(0, 0, 24, 4));
    expect(out.pieces.map((q) => q.idx)).toEqual([0]);
  });

  it('loses nothing where two pieces meet', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const wa = new WalkAlong(blocks);
    // Steps of 10 m that straddle every 20 m piece end: 5 m on each side.
    const out = walkAll(wa, east(0, 5, 45));
    expect(out.pieces.map((q) => q.idx)).toEqual([0, 1]);
    expect(walk(wa, east(0, 45, 55))).toHaveLength(1);
  });

  it('lights a piece walked on the sidewalk, 9 m from the street line', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const out = walkAll(new WalkAlong(blocks), east(9, 0, 30, 5), 15);
    expect(out.pieces.map((q) => q.idx)).toEqual([0, 1]);
  });

  it('lights no piece of a street it only crosses', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const out = walkAll(new WalkAlong(blocks), [p(50, -15), p(51, -9), p(50, -3), p(51, 3), p(50, 9), p(51, 15)]);
    expect(out.pieces).toHaveLength(0);
    expect(out.blocks).toHaveLength(0);
  });

  it('replays saved segments into the same pieces', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const points = east(0, 0, 30, 5);
    const segs: number[] = [];
    for (let i = 1; i < points.length; i++) {
      segs.push(points[i - 1][0], points[i - 1][1], points[i][0], points[i][1], 12);
    }
    const live = walkAll(new WalkAlong(blocks), points);
    const replayed = new WalkAlong(blocks).replay(segs);
    expect(replayed.pieces.map((q) => q.id)).toEqual(live.pieces.map((q) => q.id));
  });

  it('does not report blocks that are already lit', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [100, 0] }]);
    const wa = new WalkAlong(blocks, () => true);
    expect(walk(wa, east(0, 0, 60))).toHaveLength(0);
  });

  it('unlocks a short block only after walking along enough of it', () => {
    const { blocks } = city([{ id: 1, from: [0, 0], to: [12, 0] }]);
    const wa = new WalkAlong(blocks);
    expect(walk(wa, east(0, 0, 6))).toHaveLength(0);
    expect(walk(wa, east(0, 6, 10))).toHaveLength(1);
  });
});
