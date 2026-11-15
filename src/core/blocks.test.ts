import { describe, expect, it } from 'vitest';
import { metresPerDegree } from '../geo/geo';
import { splitWay } from '../geo/pieces';
import { Blocks, buildBlocks } from './blocks';
import type { WayInput } from './types';

const lat0 = 52.37, lon0 = 4.88;
const m = metresPerDegree(lat0);
const pt = (x: number, y: number) => [lon0 + x / m.lon, lat0 + y / m.lat];

function way(lengthM: number, extra: Partial<WayInput> = {}): WayInput {
  return {
    id: 1,
    name: 'Wolska',
    highway: 'secondary',
    kind: 'road',
    coords: [pt(0, 0), pt(lengthM, 0)].flat(),
    ...extra,
  };
}

describe('buildBlocks', () => {
  it('keeps a way without junctions as one block', () => {
    const w = way(100);
    const blocks = buildBlocks(w, splitWay(w));
    expect(blocks).toHaveLength(1);
    expect(blocks[0].id).toBe('1:0-4');
    expect(blocks[0].lenM).toBeCloseTo(100, 1);
    expect(blocks[0].name).toBe('Wolska');
    expect(blocks[0].kind).toBe('road');
    expect(blocks[0].coords.length).toBeGreaterThanOrEqual(4);
  });

  it('cuts at junctions, between pieces', () => {
    const w = way(200, { junctionsM: [40, 100] });
    const blocks = buildBlocks(w, splitWay(w));
    expect(blocks.map((b) => b.id)).toEqual(['1:0-1', '1:2-4', '1:5-9']);
    expect(blocks.map((b) => Math.round(b.lenM))).toEqual([40, 60, 100]);
  });

  it('snaps a junction inside a piece to the nearest piece boundary', () => {
    const w = way(100, { junctionsM: [39] });
    const blocks = buildBlocks(w, splitWay(w));
    expect(blocks.map((b) => b.id)).toEqual(['1:0-1', '1:2-4']);
  });

  it('caps a long junction-free stretch so it unlocks in stages', () => {
    const w = way(400);
    const blocks = buildBlocks(w, splitWay(w), { maxBlockLengthM: 160 });
    expect(blocks).toHaveLength(3);
    for (const b of blocks) expect(b.lenM).toBeLessThanOrEqual(160.001);
    expect(blocks.reduce((s, b) => s + b.lenM, 0)).toBeCloseTo(400, 1);
  });

  it('joins piece geometries end to end without repeating vertices', () => {
    const w = way(60);
    const pieces = splitWay(w);
    const [block] = buildBlocks(w, pieces);
    expect(block.coords).toHaveLength(pieces.length * 4 - (pieces.length - 1) * 2);
    expect(block.coords[0]).toBeCloseTo(pieces[0].coords[0], 9);
    expect(block.coords[block.coords.length - 1]).toBeCloseTo(pieces[pieces.length - 1].coords.at(-1)!, 9);
  });
});

describe('Blocks', () => {
  it('indexes blocks by id and by piece, and adds each way once', () => {
    const w = way(200, { junctionsM: [40, 100] });
    const pieces = splitWay(w);
    const blocks = new Blocks();
    const added = blocks.add(w, pieces);
    expect(added).toHaveLength(3);
    expect(blocks.size).toBe(3);
    expect(blocks.get(added[1].id)).toBe(added[1]);
    expect(blocks.blockOf(pieces[7].id)?.id).toBe('1:5-9');
    expect(blocks.add(w, pieces)).toEqual([]);
    expect(blocks.size).toBe(3);
    expect([...blocks.values()]).toHaveLength(3);
  });
});
