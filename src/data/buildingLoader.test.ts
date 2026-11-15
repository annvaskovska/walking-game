import { describe, expect, it } from 'vitest';
import { metresPerDegree } from '../geo/geo';
import { MemoryStorage } from '../platform/storage';
import type { Building } from '../core/types';
import { BuildingLoader } from './buildingLoader';

const lat0 = 52.37, lon0 = 4.88;
const m = metresPerDegree(lat0);
const lon = (x: number) => lon0 + x / m.lon;
const lat = (y: number) => lat0 + y / m.lat;

function house(id: string, x: number, y: number, size = 8): Building {
  return {
    id,
    coords: [
      lon(x), lat(y), lon(x + size), lat(y), lon(x + size), lat(y + size),
      lon(x), lat(y + size), lon(x), lat(y),
    ],
    bbox: [lon(x), lat(y), lon(x + size), lat(y + size)],
  };
}

describe('BuildingLoader', () => {
  it('fetches a cell and hands each new building over once', async () => {
    const b = house('b1', 10, 5);
    const seen = await new Promise<Building[]>((resolve) => {
      const loader = new BuildingLoader(new MemoryStorage(), { onHouses: resolve }, async () => [b]);
      loader.ensureAround(4.8839, 52.3742);
    });
    expect(seen.map((x) => x.id)).toEqual(['b1']);
  });

  it('finds the houses near a line, within the radius', async () => {
    const near = house('near', 10, 5);
    const far = house('far', 10, 60);
    const loader = new BuildingLoader(new MemoryStorage(), { onHouses: () => {} }, async () => [near, far]);
    loader.index.insert(near);
    loader.index.insert(far);
    const line = [lon(0), lat(0), lon(80), lat(0)];
    expect(loader.buildingsNear(line, 30).map((b) => b.id)).toEqual(['near']);
  });
});
