import { describe, expect, it } from 'vitest';
import { buildBuildingQuery, buildQuery, kindFromTags, parseBuildings, parseOverpass } from './overpass';

describe('buildQuery', () => {
  it('asks for walkable ways in south,west,north,east order with geometry and node ids', () => {
    const q = buildQuery([4.87, 52.36, 4.89, 52.38]);
    expect(q).toContain('(52.360000,4.870000,52.380000,4.890000)');
    expect(q).toContain('footway');
    expect(q).toContain('residential');
    expect(q).not.toMatch(/motorway|trunk/);
    expect(q).toContain('out body geom');
  });
});

describe('buildBuildingQuery', () => {
  it('asks for building footprints in the same bbox order', () => {
    const q = buildBuildingQuery([4.87, 52.36, 4.89, 52.38]);
    expect(q).toContain('(52.360000,4.870000,52.380000,4.890000)');
    expect(q).toContain('way["building"]');
    expect(q).toContain('out tags geom');
  });
});

describe('kindFromTags', () => {
  it('never lights sidewalks or crossings on their own', () => {
    expect(kindFromTags({ highway: 'footway', footway: 'sidewalk' })).toBe('side');
    expect(kindFromTags({ highway: 'footway', footway: 'crossing' })).toBe('side');
    expect(kindFromTags({ highway: 'path', crossing: 'marked' })).toBe('side');
    expect(kindFromTags({ highway: 'footway', is_sidepath: 'yes' })).toBe('side');
  });

  it('marks ordinary walkways as paths and streets as roads', () => {
    expect(kindFromTags({ highway: 'footway' })).toBe('path');
    expect(kindFromTags({ highway: 'cycleway' })).toBe('path');
    expect(kindFromTags({ highway: 'residential' })).toBe('road');
    expect(kindFromTags({ highway: 'pedestrian' })).toBe('road');
  });
});

describe('parseOverpass', () => {
  it('keeps walkable ways, with names, kinds and geometry', () => {
    const ways = parseOverpass({
      elements: [
        {
          type: 'way', id: 1, tags: { highway: 'residential', name: ' Bloemgracht ' },
          geometry: [{ lat: 52.3741, lon: 4.8801 }, { lat: 52.3745, lon: 4.8812 }],
        },
        { type: 'way', id: 2, tags: { highway: 'footway' }, geometry: [{ lat: 1, lon: 2 }, null, { lat: 1.1, lon: 2.1 }] },
        { type: 'way', id: 3, tags: { highway: 'motorway', name: 'A10' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }] },
        { type: 'way', id: 4, tags: { highway: 'path' }, geometry: [{ lat: 1, lon: 2 }] },
        { type: 'way', id: 6, tags: { highway: 'footway', footway: 'sidewalk' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }] },
        { type: 'way', id: 7, tags: { highway: 'path', footway: 'crossing' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }] },
        { type: 'way', id: 8, tags: { highway: 'pedestrian' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }] },
        { type: 'node', id: 5 },
      ],
    });
    expect(ways).toEqual([
      { id: 1, name: 'Bloemgracht', highway: 'residential', kind: 'road', coords: [4.8801, 52.3741, 4.8812, 52.3745] },
      { id: 2, name: null, highway: 'footway', kind: 'path', coords: [2, 1, 2.1, 1.1] },
      { id: 6, name: null, highway: 'footway', kind: 'side', coords: [2, 1, 3, 1] },
      { id: 7, name: null, highway: 'path', kind: 'side', coords: [2, 1, 3, 1] },
      { id: 8, name: null, highway: 'pedestrian', kind: 'road', coords: [2, 1, 3, 1] },
    ]);
  });

  it('finds the junctions where ways share a node', () => {
    const ways = parseOverpass({
      elements: [
        {
          type: 'way', id: 10, tags: { highway: 'residential' }, nodes: [1, 2, 3],
          geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, { lat: 0, lon: 0.002 }],
        },
        {
          type: 'way', id: 11, tags: { highway: 'residential' }, nodes: [4, 2, 5],
          geometry: [{ lat: -0.001, lon: 0.001 }, { lat: 0, lon: 0.001 }, { lat: 0.001, lon: 0.001 }],
        },
      ],
    });
    expect(ways[0].junctionsM?.[0]).toBeCloseTo(111.2, 1);
    expect(ways[1].junctionsM?.[0]).toBeCloseTo(111.2, 1);
  });

  it('rejects responses that are not Overpass JSON', () => {
    expect(() => parseOverpass({ error: 'x' })).toThrow();
  });
});

describe('parseBuildings', () => {
  it('keeps building footprints, closes rings and skips non-buildings', () => {
    const buildings = parseBuildings({
      elements: [
        {
          type: 'way', id: 100, tags: { building: 'yes' },
          geometry: [
            { lat: 52.37, lon: 4.88 }, { lat: 52.37, lon: 4.881 },
            { lat: 52.371, lon: 4.881 }, { lat: 52.37, lon: 4.88 },
          ],
        },
        {
          type: 'way', id: 101, tags: { building: 'no' },
          geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }, { lat: 1, lon: 1 }],
        },
        {
          type: 'way', id: 102, tags: { highway: 'footway' },
          geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }, { lat: 1, lon: 1 }],
        },
        {
          type: 'way', id: 104, tags: { building: 'apartments' },
          geometry: [{ lat: 1, lon: 1 }, { lat: 1, lon: 2 }, { lat: 2, lon: 2 }, { lat: 2, lon: 1 }],
        },
      ],
    });
    expect(buildings.map((b) => b.id)).toEqual(['b100', 'b104']);
    expect(buildings[1].coords).toHaveLength(10);
    expect(buildings[1].coords.slice(-2)).toEqual([1, 1]);
    expect(buildings[0].bbox).toEqual([4.88, 52.37, 4.881, 52.371]);
  });
});
