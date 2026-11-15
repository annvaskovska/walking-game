import { describe, expect, it } from 'vitest';
import {
  cellKey, distanceM, expandBBox, lonLatToTile, metresPerDegree, parseCellKey, pointSegmentDist2,
  polylineDistanceM, projectOnPolylineM, segmentSegmentDist, segmentToPolylineM, tileToBBox, toMercator,
} from './geo';

describe('distanceM', () => {
  it('measures one degree of latitude as ~111 km', () => {
    expect(distanceM(0, 0, 0, 1)).toBeCloseTo(111_195, -1);
  });
  it('shrinks longitude with latitude', () => {
    expect(distanceM(4.88, 52.37, 4.89, 52.37)).toBeCloseTo(678.9, 0);
  });
  it('is zero for the same point', () => {
    expect(distanceM(4.88, 52.37, 4.88, 52.37)).toBe(0);
  });
});

describe('point to segment', () => {
  it('projects onto the middle of a segment', () => {
    expect(Math.sqrt(pointSegmentDist2(5, 3, 0, 0, 10, 0))).toBeCloseTo(3);
  });
  it('clamps to the nearest endpoint', () => {
    expect(Math.sqrt(pointSegmentDist2(-3, 4, 0, 0, 10, 0))).toBeCloseTo(5);
    expect(Math.sqrt(pointSegmentDist2(14, 3, 0, 0, 10, 0))).toBeCloseTo(5);
  });
  it('handles a zero-length segment', () => {
    expect(Math.sqrt(pointSegmentDist2(3, 4, 1, 1, 1, 1))).toBeCloseTo(Math.hypot(2, 3));
  });
});

describe('segment to segment', () => {
  it('is zero when segments cross', () => {
    expect(segmentSegmentDist(0, 0, 10, 10, 0, 10, 10, 0)).toBe(0);
  });
  it('is the gap between parallel segments', () => {
    expect(segmentSegmentDist(0, 0, 10, 0, 0, 7, 10, 7)).toBeCloseTo(7);
  });
  it('uses endpoints for disjoint collinear segments', () => {
    expect(segmentSegmentDist(0, 0, 10, 0, 13, 0, 20, 0)).toBeCloseTo(3);
  });
});

describe('segmentToPolylineM', () => {
  const lat = 52.37;
  const m = metresPerDegree(lat);
  const east = (x: number) => 4.88 + x / m.lon;
  const north = (y: number) => lat + y / m.lat;

  it('finds a parallel street 15 m away', () => {
    const street = [east(0), north(15), east(40), north(15)];
    expect(segmentToPolylineM(east(5), north(0), east(30), north(0), street)).toBeCloseTo(15, 1);
  });
  it('is zero when the walk crosses the street', () => {
    const street = [east(10), north(-20), east(10), north(20)];
    expect(segmentToPolylineM(east(0), north(0), east(20), north(0), street)).toBe(0);
  });
  it('checks every vertex of a bent street', () => {
    const street = [east(100), north(100), east(100), north(8), east(200), north(8)];
    expect(segmentToPolylineM(east(90), north(0), east(150), north(0), street)).toBeCloseTo(8, 1);
  });
});

describe('projectOnPolylineM', () => {
  const lat = 52.37;
  const m = metresPerDegree(lat);
  const east = (x: number) => 4.88 + x / m.lon;
  const north = (y: number) => lat + y / m.lat;

  it('returns the lateral distance and how far along the nearest point is', () => {
    const street = [east(0), north(0), east(100), north(0)];
    const p = projectOnPolylineM(east(30), north(7), street);
    expect(p.distM).toBeCloseTo(7, 1);
    expect(p.alongM).toBeCloseTo(30, 1);
  });

  it('clamps to the ends of the line', () => {
    const street = [east(0), north(0), east(100), north(0)];
    const before = projectOnPolylineM(east(-10), north(4), street);
    expect(before.alongM).toBe(0);
    expect(before.distM).toBeCloseTo(Math.hypot(10, 4), 1);
    const after = projectOnPolylineM(east(120), north(0), street);
    expect(after.alongM).toBeCloseTo(100, 1);
  });

  it('measures along the bends of a polyline', () => {
    const street = [east(0), north(0), east(10), north(0), east(10), north(10)];
    const p = projectOnPolylineM(east(15), north(5), street);
    expect(p.alongM).toBeCloseTo(15, 1);
    expect(p.distM).toBeCloseTo(5, 1);
  });
});

describe('polylineDistanceM', () => {
  const lat = 52.37;
  const m = metresPerDegree(lat);
  const east = (x: number) => 4.88 + x / m.lon;
  const north = (y: number) => lat + y / m.lat;

  it('is the gap between parallel lines', () => {
    const a = [east(0), north(0), east(40), north(0)];
    const b = [east(0), north(15), east(40), north(15)];
    expect(polylineDistanceM(a, b)).toBeCloseTo(15, 1);
  });

  it('is zero when the lines cross', () => {
    const a = [east(0), north(0), east(40), north(0)];
    const b = [east(20), north(-10), east(20), north(10)];
    expect(polylineDistanceM(a, b)).toBe(0);
  });
});

describe('expandBBox', () => {
  it('grows by roughly the given metres', () => {
    const b = expandBBox([4.88, 52.37, 4.88, 52.37], 100);
    expect(distanceM(b[0], 52.37, b[2], 52.37)).toBeCloseTo(200, 0);
    expect(distanceM(4.88, b[1], 4.88, b[3])).toBeCloseTo(200, 0);
  });
});

describe('tiles', () => {
  it('round-trips a point through its z15 tile', () => {
    const { x, y } = lonLatToTile(4.8839, 52.3742, 15);
    const [w, s, e, n] = tileToBBox(x, y, 15);
    expect(4.8839).toBeGreaterThanOrEqual(w);
    expect(4.8839).toBeLessThan(e);
    expect(52.3742).toBeGreaterThanOrEqual(s);
    expect(52.3742).toBeLessThan(n);
  });
  it('formats and parses cell keys', () => {
    expect(parseCellKey(cellKey(15, 16828, 10770))).toEqual({ z: 15, x: 16828, y: 10770 });
  });
  it('matches MapLibre mercator conventions', () => {
    const m = toMercator([0, 0, 180, 0]);
    expect(m[0]).toBeCloseTo(0.5);
    expect(m[1]).toBeCloseTo(0.5);
    expect(m[2]).toBeCloseTo(1);
  });
});
