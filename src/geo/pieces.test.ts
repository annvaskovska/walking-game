import { describe, expect, it } from 'vitest';
import { metresPerDegree, polylineLengthM } from './geo';
import { isStreet, splitWay } from './pieces';
import type { WayInput } from '../core/types';

const lat0 = 52.37, lon0 = 4.88;
const m = metresPerDegree(lat0);
const pt = (x: number, y: number) => [lon0 + x / m.lon, lat0 + y / m.lat];

function way(id: number, pts: number[][], name: string | null = 'Teststraat'): WayInput {
  return { id, name, highway: 'residential', coords: pts.flat() };
}

describe('splitWay', () => {
  it('cuts a 100 m street into five ~20 m pieces with stable ids', () => {
    const pieces = splitWay(way(42, [pt(0, 0), pt(100, 0)]));
    expect(pieces.map((p) => p.id)).toEqual(['42:0', '42:1', '42:2', '42:3', '42:4']);
    for (const p of pieces) expect(p.len).toBeCloseTo(20, 0);
    expect(pieces.every((p) => p.name === 'Teststraat')).toBe(true);
  });

  it('keeps the total length and joins pieces end to start', () => {
    const w = way(7, [pt(0, 0), pt(37, 0), pt(37, 41), pt(90, 60)]);
    const pieces = splitWay(w);
    const total = polylineLengthM(w.coords);
    expect(pieces.reduce((s, p) => s + p.len, 0)).toBeCloseTo(total, 3);
    for (let i = 1; i < pieces.length; i++) {
      const prev = pieces[i - 1].coords, cur = pieces[i].coords;
      expect(cur[0]).toBeCloseTo(prev[prev.length - 2], 6);
      expect(cur[1]).toBeCloseTo(prev[prev.length - 1], 6);
    }
    for (const p of pieces) {
      expect(polylineLengthM(p.coords)).toBeCloseTo(p.len, 0);
    }
  });

  it('keeps bends inside a piece', () => {
    // An 18 m L-shaped way is a single piece that keeps its corner vertex.
    const pieces = splitWay(way(1, [pt(0, 0), pt(10, 0), pt(10, 8)]));
    expect(pieces).toHaveLength(1);
    expect(pieces[0].coords.length).toBe(6);
  });

  it('is deterministic', () => {
    const w = way(9, [pt(0, 0), pt(55, 12), pt(130, -4)]);
    expect(splitWay(w)).toEqual(splitWay(w));
  });

  it('gives short ways a single piece and skips degenerate ones', () => {
    expect(splitWay(way(3, [pt(0, 0), pt(4, 0)]))).toHaveLength(1);
    expect(splitWay({ id: 4, name: null, highway: 'path', coords: pt(0, 0) })).toHaveLength(0);
  });

  it('computes bboxes that contain the geometry', () => {
    for (const p of splitWay(way(5, [pt(0, 0), pt(60, 30)]))) {
      for (let i = 0; i < p.coords.length; i += 2) {
        expect(p.coords[i]).toBeGreaterThanOrEqual(p.bbox[0]);
        expect(p.coords[i]).toBeLessThanOrEqual(p.bbox[2]);
        expect(p.coords[i + 1]).toBeGreaterThanOrEqual(p.bbox[1]);
        expect(p.coords[i + 1]).toBeLessThanOrEqual(p.bbox[3]);
      }
    }
  });
});

describe('isStreet', () => {
  it('treats named ways as streets and unnamed ones as paths', () => {
    expect(isStreet({ name: 'Bloemgracht' })).toBe(true);
    expect(isStreet({ name: null })).toBe(false);
  });
});
