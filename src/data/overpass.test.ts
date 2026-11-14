import { describe, expect, it } from 'vitest';
import { buildQuery, parseOverpass } from './overpass';

describe('buildQuery', () => {
  it('asks for walkable ways in south,west,north,east order with geometry', () => {
    const q = buildQuery([4.87, 52.36, 4.89, 52.38]);
    expect(q).toContain('(52.360000,4.870000,52.380000,4.890000)');
    expect(q).toContain('footway');
    expect(q).toContain('residential');
    expect(q).not.toMatch(/motorway|trunk/);
    expect(q).toContain('out tags geom');
  });
});

describe('parseOverpass', () => {
  it('keeps walkable ways with names and geometry', () => {
    const ways = parseOverpass({
      elements: [
        {
          type: 'way', id: 1, tags: { highway: 'residential', name: ' Bloemgracht ' },
          geometry: [{ lat: 52.3741, lon: 4.8801 }, { lat: 52.3745, lon: 4.8812 }],
        },
        { type: 'way', id: 2, tags: { highway: 'footway' }, geometry: [{ lat: 1, lon: 2 }, null, { lat: 1.1, lon: 2.1 }] },
        { type: 'way', id: 3, tags: { highway: 'motorway', name: 'A10' }, geometry: [{ lat: 1, lon: 2 }, { lat: 1, lon: 3 }] },
        { type: 'way', id: 4, tags: { highway: 'path' }, geometry: [{ lat: 1, lon: 2 }] },
        { type: 'node', id: 5 },
      ],
    });
    expect(ways).toEqual([
      { id: 1, name: 'Bloemgracht', highway: 'residential', coords: [4.8801, 52.3741, 4.8812, 52.3745] },
      { id: 2, name: null, highway: 'footway', coords: [2, 1, 2.1, 1.1] },
    ]);
  });

  it('rejects responses that are not Overpass JSON', () => {
    expect(() => parseOverpass({ error: 'x' })).toThrow();
  });
});
