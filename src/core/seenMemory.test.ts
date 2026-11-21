import { describe, expect, it } from 'vitest';
import { bboxOfCoords } from '../geo/geo';
import { wmX, wmY } from '../map/fog/geometry';
import { EARTH_CIRCUMFERENCE_M as C } from '../map/gl';
import { nightTheme } from '../theme';
import { gatherOccluders, wmPerMetre } from './occluders';
import { SeenMemory, type Look } from './seenMemory';
import type { Building, Place } from './types';

// A local frame in ground metres (x east, y north) around a spot in Amsterdam, mapped exactly to WM.
const lon0 = 4.88, lat0 = 52.37, m2u = wmPerMetre(lat0), X0 = wmX(lon0), Y0 = wmY(lat0);
const lonOf = (x: number) => ((X0 + x * m2u) / C) * 360 - 180;
const latOf = (y: number) => (2 * Math.atan(Math.exp(Math.PI * (1 - (2 * (Y0 - y * m2u)) / C))) - Math.PI / 2) * (180 / Math.PI);
const ring = (pts: [number, number][]) => [...pts, pts[0]].flatMap(([x, y]) => [lonOf(x), latOf(y)]);
const rect = (x0: number, y0: number, x1: number, y1: number): [number, number][] => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
const house = (id: string, outer: [number, number][]): Building => {
  const coords = ring(outer);
  return { id, coords, bbox: bboxOfCoords(coords) };
};
const place = (id: string, x: number, y: number): Place => {
  const lon = lonOf(x), lat = latOf(y);
  return { id, name: id, cls: 'shop', rank: 1, lon, lat, bbox: [lon, lat, lon, lat] };
};
const look = (x: number, y: number, heading: number | null, cone = 1): Look => ({ lon: lonOf(x), lat: latOf(y), heading, cone });

// You stand at the origin of an east-west street.
const houses = [
  house('ahead', rect(60, -8, 75, 8)), // 60 m east: in the beam when you face east
  house('hidden', rect(80, -6, 90, 6)), // right behind it
  house('behind', rect(-75, -8, -60, 8)), // 60 m west
  house('near', rect(-10, 20, 10, 30)), // 20 m north, within reach all round
  house('far', rect(-10, 50, 10, 60)), // 50 m north: beyond reach outside the beam
];
const places = [
  place('shop', 64, 0), // inside `ahead`, 4 m behind its facade
  place('deep', 85, 0), // inside `hidden`
  place('kiosk', 15, 10), // in the open, close by
  place('back', -64, 0), // inside `behind`
];
const occOf = () => gatherOccluders(houses, X0, Y0, 160 * m2u, 1);
const ids = (r: { id: string }[]) => r.map((h) => h.id).sort();

describe('SeenMemory.look', () => {
  it('sees the houses and landmarks within reach that sight reaches', () => {
    const m = new SeenMemory(nightTheme);
    const r = m.look(look(0, 0, 90), occOf(), places, 1000);
    expect(ids(r.houses)).toEqual(['ahead', 'near']);
    expect(ids(r.places)).toEqual(['kiosk', 'shop']);
    expect(r.tiles.length).toBeGreaterThan(0);
    expect(r.houses.every((h) => h.seenAt === 1000 && h.coords.length > 0)).toBe(true);
    expect(m.houses.has('ahead')).toBe(true);
    expect(m.places.get('shop')?.seenAt).toBe(1000);
    // Moonlit ground ahead, none behind the houses.
    expect(m.grid.at(X0 + 40 * m2u, Y0)).toBeGreaterThan(0.3);
    expect(m.grid.at(X0 + 78 * m2u, Y0)).toBe(0);
  });

  it('sees only close by without a heading', () => {
    const m = new SeenMemory(nightTheme);
    const r = m.look(look(0, 0, null), occOf(), places, 1);
    expect(ids(r.houses)).toEqual(['near']);
    expect(ids(r.places)).toEqual(['kiosk']);
  });

  it('returns only what is new, and skips a look from the same spot', () => {
    const m = new SeenMemory(nightTheme);
    const occ = occOf();
    m.look(look(0, 0, 90), occ, places, 1);
    const again = m.look(look(0.5, 0.5, 93), occ, places, 2);
    expect(again.tiles).toEqual([]);
    expect(again.houses).toEqual([]);
    const west = m.look(look(0, 0, 270), occ, places, 3);
    expect(ids(west.houses)).toEqual(['behind']);
    expect(ids(west.places)).toEqual(['back']);
    expect(west.tiles.length).toBeGreaterThan(0);
    // Turned 10°: new light, but nothing new to name.
    const turned = m.look(look(0, 0, 280), occ, places, 4);
    expect(turned.tiles.length).toBeGreaterThan(0);
    expect(turned.houses).toEqual([]);
  });

  it('does not see again what was loaded', () => {
    const m = new SeenMemory(nightTheme);
    m.loadHouses([{ ...houses[0], seenAt: 5 }]);
    m.loadPlaces([{ ...places[0], seenAt: 5 }]);
    const r = m.look(look(0, 0, 90), occOf(), places, 9);
    expect(ids(r.houses)).toEqual(['near']);
    expect(ids(r.places)).toEqual(['kiosk']);
  });

  it('steps out of a house GPS put you in', () => {
    const m = new SeenMemory(nightTheme);
    // 1 m inside the south wall of `near`: you are on the street in front of it.
    const r = m.look(look(0, 21, 90), occOf(), places, 1);
    expect(ids(r.houses)).toContain('near');
    expect(m.grid.at(X0, Y0 - 10 * m2u)).toBeGreaterThan(0.5);
    expect(m.grid.at(X0, Y0 - 25 * m2u)).toBe(0);
  });
});
