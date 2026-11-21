import { describe, expect, it } from 'vitest';
import type { Building, Place } from '../core/types';
import { StreetGraph } from './graph';

const place = (id: string, lon: number, lat: number, cls = 'cafe'): Place => ({
  id, name: id, cls, rank: 10, lon, lat, bbox: [lon, lat, lon, lat],
});
const house = (id: string, lon: number, lat: number): Building => {
  const coords = [lon, lat, lon + 1e-4, lat, lon + 1e-4, lat + 1e-4, lon, lat];
  return { id, coords, bbox: [lon, lat, lon + 1e-4, lat + 1e-4] };
};
const around = (lon: number, lat: number, d = 5e-4): [number, number, number, number] => [lon - d, lat - d, lon + d, lat + d];
const ids = (ps: Place[]) => ps.map((p) => p.id).sort();

describe('StreetGraph places', () => {
  it('adds the landmarks with their tile and drops them with it', () => {
    const g = new StreetGraph();
    g.addTile('14/1/1', [], [house('h1', 4.88, 52.37)], [place('a', 4.88, 52.37), place('b', 4.881, 52.371)]);
    g.addTile('14/2/1', [], [], [place('c', 4.9, 52.37)]);
    expect(g.places.size).toBe(3);
    expect(ids(g.places.query(around(4.88, 52.37)))).toEqual(['a']);
    expect(ids(g.places.query([4.879, 52.369, 4.902, 52.372]))).toEqual(['a', 'b', 'c']);

    const v = g.version;
    g.removeTile('14/1/1');
    expect(g.version).toBeGreaterThan(v);
    expect(g.places.size).toBe(1);
    expect(g.places.query(around(4.88, 52.37))).toEqual([]);
    expect(g.houses.size).toBe(0);
    expect(ids([...g.places.values()])).toEqual(['c']);
    g.removeTile('14/2/1');
    expect(g.places.size).toBe(0);
  });

  it('bumps the version when a tile brings landmarks, and takes tiles without them', () => {
    const g = new StreetGraph();
    const v = g.version;
    g.addTile('14/1/1', [], [], [place('a', 4.88, 52.37)]);
    expect(g.version).toBe(v + 1);
    g.addTile('14/2/1', [], []);
    expect(g.version).toBe(v + 2);
    expect(g.places.size).toBe(1);
    // A tile already loaded adds nothing.
    g.addTile('14/1/1', [], [], [place('z', 4.88, 52.37)]);
    expect(g.version).toBe(v + 2);
    expect(g.places.has('z')).toBe(false);
  });

  it('keeps a place another tile still holds', () => {
    const g = new StreetGraph();
    const p = place('twice', 4.88, 52.37);
    g.addTile('14/1/1', [], [], [p]);
    g.addTile('14/2/1', [], [], [{ ...p }]);
    g.removeTile('14/2/1');
    expect(g.places.get('twice')).toBe(p);
    g.removeTile('14/1/1');
    expect(g.places.size).toBe(0);
  });
});
