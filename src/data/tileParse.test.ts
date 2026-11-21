import { describe, expect, it } from 'vitest';
import { tileToBBox } from '../geo/geo';
import type { Building, Place, WayInput } from '../core/types';
import { decodeTile, encodeTile } from './mvt';
import type { MvtFeatureInput } from './mvt';
import { TILE_LAYERS, classify, clipLine, clipRing, isLandmark, parseTile } from './tileParse';

// A z14 tile over the Jordaan in Amsterdam. One tile unit is about 0.36 m there.
const Z = 14, X = 8414, Y = 5383, EXT = 4096;

type Props = Record<string, string | number | boolean>;
const line = (cls: string, pts: number[], props: Props = {}): MvtFeatureInput => ({
  type: 2,
  props: { class: cls, ...props },
  parts: [pts],
});
const path = (subclass: string, pts: number[], props: Props = {}) => line('path', pts, { subclass, ...props });
/** A transportation_name line. */
const label = (name: string, cls: string, pts: number[], props: Props = {}) => line(cls, pts, { name, ...props });
/** Outer ring: clockwise on screen, so a positive area in tile coordinates (y down). */
const outer = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
/** Hole: the same box the other way round. */
const hole = (x0: number, y0: number, x1: number, y1: number) => [x0, y0, x0, y1, x1, y1, x1, y0, x0, y0];
const building = (rings: number[][], props: Props = {}): MvtFeatureInput => ({ type: 3, props, parts: rings });
/** A named poi point (or multipoint: one [u, v] pair per point). */
const poi = (cls: string, subclass: string, name: string, at: number[], props: Props = {}): MvtFeatureInput => {
  const parts: number[][] = [];
  for (let i = 0; i < at.length; i += 2) parts.push([at[i], at[i + 1]]);
  return { type: 1, props: { class: cls, subclass, name, rank: 10, ...props }, parts };
};

interface Scene {
  roads?: MvtFeatureInput[];
  names?: MvtFeatureInput[];
  buildings?: MvtFeatureInput[];
  pois?: MvtFeatureInput[];
  extent?: number;
}

function tileOf(s: Scene): Uint8Array {
  const extent = s.extent ?? EXT;
  return encodeTile([
    { name: 'water', extent, features: [{ type: 3, parts: [outer(0, 0, 50, 50)] }] },
    { name: 'transportation', extent, features: s.roads ?? [] },
    { name: 'transportation_name', extent, features: s.names ?? [] },
    { name: 'building', extent, features: s.buildings ?? [] },
    { name: 'poi', extent, features: s.pois ?? [] },
  ]);
}
const parse = (s: Scene, x = X, y = Y) => parseTile(decodeTile(tileOf(s), TILE_LAYERS), Z, x, y);

/** A lon/lat point back in tile units, to one decimal. */
function unit(lon: number, lat: number, extent = EXT): [number, number] {
  const n = 2 ** Z;
  const u = (((lon + 180) / 360) * n - X) * extent;
  const v = (((1 - Math.asinh(Math.tan((lat * Math.PI) / 180)) / Math.PI) / 2) * n - Y) * extent;
  return [Math.round(u * 10) / 10, Math.round(v * 10) / 10];
}
const pts = (coords: number[]) => {
  const out: [number, number][] = [];
  for (let i = 0; i < coords.length; i += 2) out.push(unit(coords[i], coords[i + 1]));
  return out;
};
/** A way's two ends in whole tile units. */
const ends = (w: WayInput) => {
  const p = pts(w.coords);
  return [p[0], p[p.length - 1]].map(([u, v]) => [Math.round(u), Math.round(v)]);
};
const byStart = (a: WayInput, b: WayInput) => {
  const [[au, av]] = ends(a), [[bu, bv]] = ends(b);
  return au - bu || av - bv;
};
/** The ends of every edge of one highway class, sorted by where they start. */
const edges = (ways: WayInput[], hw: string) => ways.filter((w) => w.highway === hw).sort(byStart).map(ends);
const namesOf = (ways: WayInput[], hw: string) => ways.filter((w) => w.highway === hw).sort(byStart).map((w) => w.name);

/** Shoelace area of a flat closed ring in tile units. */
const areaOf = (ring: [number, number][]) => {
  let a = 0;
  for (let i = 1; i < ring.length; i++) a += ring[i - 1][0] * ring[i][1] - ring[i][0] * ring[i - 1][1];
  return Math.abs(a / 2);
};
/** Relative difference: lon/lat rounding moves a box side by up to ~0.3 units. */
const rel = (a: number, b: number) => Math.abs(a / b - 1);

describe('classify', () => {
  it('keeps streets as roads and walkways as paths, pedestrian streets as roads', () => {
    expect(classify({ class: 'minor' })).toEqual({ kind: 'road', hw: 'minor' });
    expect(classify({ class: 'secondary', brunnel: 'bridge', layer: 1 })).toEqual({ kind: 'road', hw: 'secondary' });
    expect(classify({ class: 'trunk' })).toEqual({ kind: 'road', hw: 'trunk' });
    expect(classify({ class: 'track' })).toEqual({ kind: 'road', hw: 'track' });
    expect(classify({ class: 'service', service: 'alley' })).toEqual({ kind: 'road', hw: 'service' });
    expect(classify({ class: 'service', access: 'no', foot: 'yes' })).toEqual({ kind: 'road', hw: 'service' });
    expect(classify({ class: 'path', subclass: 'pedestrian' })).toEqual({ kind: 'road', hw: 'pedestrian' });
    expect(classify({ class: 'path', subclass: 'footway' })).toEqual({ kind: 'path', hw: 'footway' });
    expect(classify({ class: 'path', subclass: 'footway', level: 0 })).toEqual({ kind: 'path', hw: 'footway' });
    expect(classify({ class: 'path', subclass: 'cycleway' })).toEqual({ kind: 'path', hw: 'cycleway' });
    expect(classify({ class: 'path', subclass: 'steps' })).toEqual({ kind: 'path', hw: 'steps' });
    // Piers are mostly private houseboat jetties.
    expect(classify({ class: 'pier' })).toBeNull();
  });

  it('drops tunnels, indoor and underground ways, closed ways, parking aisles, platforms, corridors and motorways', () => {
    const dropped: Props[] = [
      { class: 'minor', brunnel: 'tunnel' },
      { class: 'path', subclass: 'footway', brunnel: 'tunnel' },
      { class: 'path', subclass: 'footway', indoor: 1 },
      { class: 'path', subclass: 'corridor', indoor: true },
      { class: 'path', subclass: 'footway', level: -1 },
      { class: 'path', subclass: 'footway', foot: 'no' },
      { class: 'minor', foot: 'private' },
      { class: 'service', access: 'no' },
      { class: 'minor', access: 'no', foot: 'no' },
      { class: 'service', service: 'parking_aisle' },
      { class: 'service', service: 'driveway' },
      { class: 'path', subclass: 'platform' },
      { class: 'path', subclass: 'corridor' },
      { class: 'path' },
      { class: 'motorway' },
      { class: 'trunk', expressway: 1 },
      { class: 'trunk', ramp: 1 },
      { class: 'rail', subclass: 'rail' },
      { class: 'transit', subclass: 'tram' },
      { class: 'ferry' },
      { class: 'busway' },
      { class: 'minor_construction' },
      {},
    ];
    for (const p of dropped) expect(classify(p), JSON.stringify(p)).toBeNull();
  });
});

describe('isLandmark', () => {
  it('keeps shops, food and drink, street-side services and public buildings', () => {
    const kept: Props[] = [
      { class: 'shop', subclass: 'convenience' },
      { class: 'shop', subclass: 'mall' },
      { class: 'clothing_store', subclass: 'clothes' },
      { class: 'grocery', subclass: 'supermarket' },
      { class: 'bakery', subclass: 'bakery' },
      { class: 'library', subclass: 'books' },
      { class: 'cafe', subclass: 'cafe' },
      { class: 'restaurant', subclass: 'restaurant' },
      { class: 'beer', subclass: 'pub' },
      { class: 'pharmacy', subclass: 'pharmacy' },
      { class: 'bank', subclass: 'bank' },
      { class: 'post', subclass: 'post_office' },
      { class: 'fuel', subclass: 'fuel' },
      { class: 'lodging', subclass: 'hotel' },
      { class: 'school', subclass: 'school' },
      { class: 'school', subclass: 'kindergarten' },
      { class: 'place_of_worship', subclass: 'christian' },
      { class: 'place_of_worship' },
      { class: 'museum', subclass: 'museum' },
      { class: 'cinema', subclass: 'cinema' },
      { class: 'theatre', subclass: 'theatre' },
      { class: 'town_hall', subclass: 'community_centre' },
      { class: 'hospital', subclass: 'hospital' },
      { class: 'park', subclass: 'park' },
      { class: 'railway', subclass: 'station' },
      { class: 'railway', subclass: 'subway' },
      { class: 'bus', subclass: 'bus_station' },
      { class: 'shop', subclass: 'florist', level: 0 },
    ];
    for (const p of kept) expect(isLandmark(p), JSON.stringify(p)).toBe(true);
  });

  it('drops stops, street furniture, offices and what you go to by appointment', () => {
    const dropped: Props[] = [
      { class: 'bus', subclass: 'bus_stop' },
      { class: 'railway', subclass: 'tram_stop' },
      { class: 'entrance', subclass: 'subway_entrance' },
      { class: 'parking', subclass: 'parking' },
      { class: 'bicycle_parking', subclass: 'bicycle_parking' },
      { class: 'bicycle_rental', subclass: 'bicycle_rental' },
      { class: 'information', subclass: 'board' },
      { class: 'toilets', subclass: 'toilets' },
      { class: 'drinking_water', subclass: 'drinking_water' },
      { class: 'atm', subclass: 'atm' },
      { class: 'post', subclass: 'parcel_locker' },
      { class: 'post', subclass: 'post_box' },
      { class: 'fuel', subclass: 'charging_station' },
      { class: 'office', subclass: 'company' },
      { class: 'doctors', subclass: 'doctors' },
      { class: 'dentist', subclass: 'dentist' },
      { class: 'hairdresser', subclass: 'hairdresser' },
      { class: 'shop', subclass: 'beauty' },
      { class: 'shop', subclass: 'massage' },
      { class: 'car', subclass: 'car_repair' },
      { class: 'playground', subclass: 'playground' },
      // Inside a mall or a station: not seen from the street.
      { class: 'shop', subclass: 'newsagent', indoor: 1 },
      { class: 'shop', subclass: 'kiosk', indoor: true },
      {},
    ];
    for (const p of dropped) expect(isLandmark(p), JSON.stringify(p)).toBe(false);
  });
});

describe('clipLine and clipRing', () => {
  it('keeps every inside run of a line as its own line', () => {
    expect(clipLine([10, 10, 50, 10, 50, 90], 100)).toEqual([[10, 10, 50, 10, 50, 90]]);
    expect(clipLine([-10, 50, 50, 50, 50, -10], 100)).toEqual([[0, 50, 50, 50, 50, 0]]);
    // Out through the right edge and back in.
    expect(clipLine([50, 20, 150, 20, 150, 80, 50, 80], 100)).toEqual([[50, 20, 100, 20], [100, 80, 50, 80]]);
    // Across a corner.
    expect(clipLine([-50, 100, 100, -50], 100)).toEqual([[0, 50, 50, 0]]);
    expect(clipLine([-50, -10, 150, -10], 100)).toEqual([]);
  });

  it('clips a ring to the square', () => {
    expect(clipRing([10, 10, 20, 10, 20, 20], 100)).toEqual([10, 10, 20, 10, 20, 20]);
    expect(clipRing([-50, -50, -10, -50, -10, -10, -50, -10], 100)).toEqual([]);
    const half = clipRing([-50, 10, 50, 10, 50, 30, -50, 30], 100);
    expect(areaOf(pts2(half))).toBeCloseTo(50 * 20);
    expect(Math.min(...half.filter((_, i) => i % 2 === 0))).toBe(0);
    // A ring around the whole tile becomes the tile square.
    expect(areaOf(pts2(clipRing([-10, -10, 110, -10, 110, 110, -10, 110], 100)))).toBeCloseTo(100 * 100);
  });
});

/** A flat open ring as a closed list of points. */
function pts2(flat: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < flat.length; i += 2) out.push([flat[i], flat[i + 1]]);
  if (out.length) out.push(out[0]);
  return out;
}

describe('parseTile junctions', () => {
  it('cuts a main street where a side street ends on it without a shared vertex', () => {
    const { ways } = parse({
      roads: [
        line('secondary', [500, 2000, 3500, 2000]),
        line('minor', [2000, 800, 2000, 2000]), // ends right on the main street
        line('minor', [3000, 3200, 3000, 2001]), // stops a unit short of it
      ],
    });
    expect(edges(ways, 'secondary')).toEqual([
      [[500, 2000], [2000, 2000]],
      [[2000, 2000], [3000, 2000]],
      [[3000, 2000], [3500, 2000]],
    ]);
    expect(edges(ways, 'minor')).toEqual([
      [[2000, 800], [2000, 2000]],
      [[3000, 3200], [3000, 2001]],
    ]);
  });

  it('cuts both streets of an X crossing on the same layer, but not a bridge over a street', () => {
    const flat = parse({ roads: [line('secondary', [500, 2000, 3500, 2000]), line('minor', [2000, 500, 2000, 3500])] });
    expect(edges(flat.ways, 'secondary')).toEqual([[[500, 2000], [2000, 2000]], [[2000, 2000], [3500, 2000]]]);
    expect(edges(flat.ways, 'minor')).toEqual([[[2000, 500], [2000, 2000]], [[2000, 2000], [2000, 3500]]]);

    const bridge = parse({
      roads: [
        line('secondary', [500, 2000, 3500, 2000]),
        line('minor', [2000, 500, 2000, 3500], { brunnel: 'bridge', layer: 1 }),
      ],
    });
    expect(edges(bridge.ways, 'secondary')).toEqual([[[500, 2000], [3500, 2000]]]);
    expect(edges(bridge.ways, 'minor')).toEqual([[[2000, 500], [2000, 3500]]]);
  });

  it('cuts at a shared vertex on the same layer only', () => {
    const main = line('secondary', [500, 2000, 2000, 2000, 3500, 2000]);
    const shared = parse({ roads: [main, line('minor', [2000, 500, 2000, 2000, 2000, 3500])] });
    expect(edges(shared.ways, 'secondary')).toEqual([[[500, 2000], [2000, 2000]], [[2000, 2000], [3500, 2000]]]);
    expect(edges(shared.ways, 'minor')).toEqual([[[2000, 500], [2000, 2000]], [[2000, 2000], [2000, 3500]]]);

    const over = parse({ roads: [main, line('minor', [2000, 500, 2000, 2000, 2000, 3500], { brunnel: 'bridge', layer: 1 })] });
    expect(edges(over.ways, 'secondary')).toHaveLength(1);
    expect(edges(over.ways, 'minor')).toHaveLength(1);
  });

  it('joins a line that ends on a line of another layer, like steps down from a bridge', () => {
    const { ways } = parse({
      roads: [
        line('minor', [500, 2000, 3500, 2000], { brunnel: 'bridge', layer: 1 }),
        path('steps', [2000, 2000, 2000, 2100]),
      ],
    });
    expect(edges(ways, 'minor')).toEqual([[[500, 2000], [2000, 2000]], [[2000, 2000], [3500, 2000]]]);
    expect(edges(ways, 'steps')).toHaveLength(1);
  });

  it('finds junctions between the parts of one merged multipart stroke', () => {
    const { ways } = parse({
      roads: [{ type: 2, props: { class: 'minor' }, parts: [[500, 2000, 3500, 2000], [2000, 800, 2000, 2000]] }],
    });
    expect(edges(ways, 'minor')).toEqual([
      [[500, 2000], [2000, 2000]],
      [[2000, 800], [2000, 2000]],
      [[2000, 2000], [3500, 2000]],
    ]);
  });

  it('cuts a stroke where it loops back and ends on itself', () => {
    // A merged stroke runs up a street, around a block and back onto the street it came along.
    const { ways } = parse({ roads: [line('minor', [2000, 3000, 2000, 1500, 2500, 1500, 2500, 2000, 2000, 2000])] });
    expect(edges(ways, 'minor')).toEqual([
      [[2000, 2000], [2000, 2000]],
      [[2000, 3000], [2000, 2000]],
    ]);
  });

  it('cuts a stroke that passes through the same junction twice', () => {
    const loops = [2000, 2000, 2000, 1000, 3000, 1000, 3000, 2000, 2000, 2000, 1000, 2000, 1000, 3000, 2000, 3000, 2000, 2000];
    const { ways } = parse({ roads: [line('minor', loops)] });
    expect(ways.map((w) => pts(w.coords).map(([u, v]) => [Math.round(u), Math.round(v)]))).toEqual([
      [[2000, 2000], [2000, 1000], [3000, 1000], [3000, 2000], [2000, 2000]],
      [[2000, 2000], [1000, 2000], [1000, 3000], [2000, 3000], [2000, 2000]],
    ]);
    // A closed loop on its own is one edge.
    expect(parse({ roads: [line('minor', loops.slice(0, 10))] }).ways).toHaveLength(1);
  });

  it('cuts a stroke that crosses itself without a shared vertex', () => {
    const { ways } = parse({ roads: [line('minor', [1000, 1000, 3000, 3000, 3000, 1000, 1000, 3000])] });
    expect(ways.map((w) => pts(w.coords).map(([u, v]) => [Math.round(u), Math.round(v)]))).toEqual([
      [[1000, 1000], [2000, 2000]],
      [[2000, 2000], [3000, 3000], [3000, 1000], [2000, 2000]],
      [[2000, 2000], [1000, 3000]],
    ]);
  });

  it('adds no slivers where strokes continue end to end (a street, its bridge, the street again)', () => {
    const { ways } = parse({
      roads: [
        line('minor', [500, 2000, 2000, 2000]),
        line('minor', [2000, 2000, 2400, 2000], { brunnel: 'bridge', layer: 1 }),
        line('minor', [2400, 2000, 3500, 2000]),
      ],
    });
    expect(edges(ways, 'minor')).toEqual([
      [[500, 2000], [2000, 2000]],
      [[2000, 2000], [2400, 2000]],
      [[2400, 2000], [3500, 2000]],
    ]);
  });
});

describe('parseTile sidewalks and crossings', () => {
  it('drops sidewalks along a road and a short crossing, keeps footways away from roads', () => {
    const { ways } = parse({
      roads: [
        line('minor', [500, 2000, 3500, 2000]),
        path('footway', [600, 2020, 3400, 2020]), // 7 m beside the road: a sidewalk
        path('cycleway', [600, 1975, 3400, 1972]), // 9 m on the other side: a cycle track
        path('footway', [1500, 1965, 1500, 2035]), // 25 m straight across the road: a crossing
        path('footway', [500, 3600, 3500, 3900]), // through a park
        path('footway', [500, 2020, 1500, 2020, 1500, 3500]), // beside the road, then away from it
      ],
    });
    // Only the stretch away from the road is left of the last one.
    expect(edges(ways, 'footway')).toEqual([
      [[500, 3600], [3500, 3900]],
      [[1500, 2020], [1500, 3500]],
    ]);
    expect(edges(ways, 'cycleway')).toEqual([]);
    // Neither the sidewalks nor the crossing cut the road.
    expect(edges(ways, 'minor')).toEqual([[[500, 2000], [3500, 2000]]]);
  });

  it('drops a merged stroke that runs along a road, crosses it and runs back along the far side', () => {
    const { ways } = parse({
      roads: [
        line('minor', [500, 2000, 3500, 2000]),
        path('footway', [600, 2020, 1500, 2020, 1500, 1980, 2500, 1980]),
      ],
    });
    expect(edges(ways, 'footway')).toEqual([]);
    expect(edges(ways, 'minor')).toEqual([[[500, 2000], [3500, 2000]]]);
  });

  it('keeps a park path that briefly passes close to a road', () => {
    const { ways } = parse({
      roads: [
        line('minor', [500, 2000, 3500, 2000]),
        // 3 m of it run 5 m from the road, the rest is far away.
        path('footway', [1000, 3000, 1000, 2015, 1030, 2015, 1030, 3000]),
      ],
    });
    expect(edges(ways, 'footway')).toEqual([[[1000, 3000], [1030, 3000]]]);
  });

  it('keeps a long footway across a road, and cuts both where they cross', () => {
    const { ways } = parse({ roads: [line('minor', [500, 2000, 3500, 2000]), path('footway', [2500, 1700, 2500, 2300])] });
    expect(edges(ways, 'minor')).toEqual([[[500, 2000], [2500, 2000]], [[2500, 2000], [3500, 2000]]]);
    expect(edges(ways, 'footway')).toEqual([[[2500, 1700], [2500, 2000]], [[2500, 2000], [2500, 2300]]]);
  });

  it('keeps footways along a pedestrian street', () => {
    const { ways } = parse({ roads: [path('pedestrian', [500, 2000, 3500, 2000]), path('footway', [600, 2020, 3400, 2020])] });
    expect(edges(ways, 'footway')).toHaveLength(1);
  });

  it('keeps a short alley path linking two parallel streets: it runs across them, not along', () => {
    const { ways } = parse({
      roads: [
        line('minor', [500, 2000, 3500, 2000]),
        line('minor', [500, 2070, 3500, 2070]), // 25 m further
        path('footway', [1500, 2000, 1500, 2070]),
      ],
    });
    expect(edges(ways, 'footway')).toEqual([[[1500, 2000], [1500, 2070]]]);
    expect(edges(ways, 'minor')).toHaveLength(4);
  });
});

describe('parseTile names', () => {
  it('names each edge of a merged stroke on its own, and the cross street keeps its name', () => {
    const { ways } = parse({
      roads: [line('secondary', [500, 2000, 3500, 2000]), line('minor', [2000, 500, 2000, 3500])],
      names: [
        // Name lines have their own vertices, a unit or two off the street.
        label('Haarlemmerstraat', 'secondary', [480, 2001, 1200, 2002, 2000, 2001]),
        label('Haarlemmerdijk', 'secondary', [2000, 2001, 2900, 1999, 3520, 2000]),
        label('Prinsengracht', 'minor', [2001, 480, 2002, 3520]),
      ],
    });
    expect(namesOf(ways, 'secondary')).toEqual(['Haarlemmerstraat', 'Haarlemmerdijk']);
    expect(namesOf(ways, 'minor')).toEqual(['Prinsengracht', 'Prinsengracht']);
  });

  it('does not hand a cross street name to a short block between two named cross streets', () => {
    const cross = [
      line('minor', [1500, 1500, 1500, 2500]),
      line('minor', [1560, 1500, 1560, 2500]), // 22 m further
    ];
    const crossNames = [
      label('Eerste Tuindwarsstraat', 'minor', [1500, 1480, 1500, 2520]),
      label('Tweede Tuindwarsstraat', 'minor', [1560, 1480, 1560, 2520]),
    ];
    const along = (ways: WayInput[]) =>
      ways.filter((w) => ends(w).every(([, v]) => v === 2000)).sort(byStart).map((w) => w.name);
    const across = (ways: WayInput[]) =>
      ways.filter((w) => !ends(w).every(([, v]) => v === 2000)).sort(byStart).map((w) => w.name);

    const unnamed = parse({ roads: [line('minor', [500, 2000, 3500, 2000]), ...cross], names: crossNames });
    expect(along(unnamed.ways)).toEqual([null, null, null]);
    expect(across(unnamed.ways)).toEqual([
      'Eerste Tuindwarsstraat',
      'Eerste Tuindwarsstraat',
      'Tweede Tuindwarsstraat',
      'Tweede Tuindwarsstraat',
    ]);

    const named = parse({
      roads: [line('minor', [500, 2000, 3500, 2000]), ...cross],
      names: [...crossNames, label('Westerstraat', 'minor', [500, 2001, 3500, 2001])],
    });
    expect(along(named.ways)).toEqual(['Westerstraat', 'Westerstraat', 'Westerstraat']);
  });

  it('matches names by class, by subclass for paths, and only close by', () => {
    const { ways } = parse({
      roads: [
        path('pedestrian', [500, 1000, 3500, 1000]),
        line('tertiary', [500, 2000, 3500, 2000]),
        path('footway', [500, 3000, 3500, 3000]),
        line('minor', [500, 3800, 3500, 3800]),
      ],
      names: [
        label('Lindengracht', 'path', [500, 1001, 3500, 1001], { subclass: 'pedestrian' }),
        label('Bloemgracht', 'minor', [500, 2001, 3500, 2001]), // another class than the street
        label('Groenpad', 'path', [500, 3001, 3500, 3001], { subclass: 'cycleway' }), // another subclass
        label('Egelantiersgracht', 'minor', [500, 3810, 3500, 3810]), // 3.6 m off: too far
      ],
    });
    expect(ways.find((w) => w.highway === 'pedestrian')).toMatchObject({ name: 'Lindengracht', kind: 'road' });
    expect(namesOf(ways, 'tertiary')).toEqual([null]);
    expect(namesOf(ways, 'footway')).toEqual([null]);
    expect(namesOf(ways, 'minor')).toEqual([null]);
  });

  it('needs the name line along at least half of the edge', () => {
    const { ways } = parse({
      roads: [line('minor', [1000, 2000, 2000, 2000]), line('minor', [1000, 3000, 2000, 3000])],
      names: [
        label('Lijnbaansgracht', 'minor', [1000, 2001, 1300, 2001]), // the first 30 %
        label('Marnixstraat', 'minor', [1000, 3001, 1600, 3001]), // the first 60 %
      ],
    });
    expect(namesOf(ways, 'minor')).toEqual([null, 'Marnixstraat']);
  });

  it('ignores a name line that crosses the edge at an angle, like a bridge passing over it', () => {
    const { ways } = parse({
      roads: [
        line('minor', [1000, 2000, 1030, 2000]), // an 11 m stub
        line('minor', [515, 1500, 1515, 2500], { brunnel: 'bridge', layer: 1 }),
      ],
      names: [label('Torensluis', 'minor', [515, 1500, 1515, 2500], { brunnel: 'bridge', layer: 1 })],
    });
    const stub = ways.find((w) => ends(w)[0][0] === 1000)!;
    expect(stub.name).toBeNull();
    expect(ways.filter((w) => w.name === 'Torensluis')).toHaveLength(1);
  });
});

describe('parseTile clipping', () => {
  it('clips lines to the tile square and drops what lies in the buffer', () => {
    const { ways } = parse({
      roads: [
        line('minor', [3000, 1000, 4160, 1000]), // leaves through the east edge
        line('minor', [-60, 500, -10, 3000]), // only in the buffer
        line('tertiary', [100, 4000, 2000, 4150, 3900, 4000]), // out through the south edge and back
      ],
    });
    expect(edges(ways, 'minor')).toEqual([[[3000, 1000], [4096, 1000]]]);
    expect(edges(ways, 'tertiary')).toEqual([
      [[100, 4000], [1316, 4096]],
      [[2684, 4096], [3900, 4000]],
    ]);
  });

  it('clips building rings to the tile and drops those in the buffer', () => {
    const { houses } = parse({
      buildings: [building([outer(-30, 100, 40, 160)]), building([outer(-60, 200, -10, 260)])],
    });
    expect(houses).toHaveLength(1);
    const ring = pts(houses[0].coords);
    expect(Math.min(...ring.map(([u]) => u))).toBeCloseTo(0, 0);
    expect(Math.max(...ring.map(([u]) => u))).toBeCloseTo(40, 0);
    expect(rel(areaOf(ring), 40 * 60)).toBeLessThan(0.03);
  });

  it('ignores polygons and points in the transportation layer', () => {
    const { ways } = parse({
      roads: [
        { type: 3, props: { class: 'path', subclass: 'pedestrian' }, parts: [outer(1000, 1000, 1400, 1400)] },
        { type: 3, props: { class: 'pier' }, parts: [outer(2000, 1000, 2100, 1600)] },
        { type: 1, props: { class: 'minor' }, parts: [[500, 500]] },
      ],
    });
    expect(ways).toEqual([]);
  });
});

describe('parseTile houses', () => {
  it('keeps courtyards as holes, skips hide_3d parts and specks', () => {
    const { houses } = parse({
      buildings: [
        building([outer(1000, 1000, 1200, 1200), hole(1050, 1050, 1100, 1100)]),
        building([outer(1300, 1000, 1400, 1100)], { hide_3d: true }),
        building([outer(1500, 1000, 1504, 1004)]), // 2 m²
        building([outer(1600, 1000, 1606, 1006)]), // 5 m²
        // One multipolygon, two houses; the hole belongs to the second.
        building([outer(2000, 1000, 2100, 1100), outer(2200, 1000, 2300, 1100), hole(2220, 1020, 2240, 1040)]),
      ],
    });
    expect(houses.map((h) => h.id)).toEqual([
      'h8414.5383.550.550',
      'h8414.5383.802.502',
      'h8414.5383.1025.525',
      'h8414.5383.1125.525',
    ]);
    const [court, small, plain, withHole] = houses;
    expect(court.holes).toHaveLength(1);
    const h = court.holes![0];
    expect(h.slice(0, 2)).toEqual(h.slice(-2)); // closed
    expect(rel(areaOf(pts(h)), 50 * 50)).toBeLessThan(0.03);
    expect(rel(areaOf(pts(court.coords)), 200 * 200)).toBeLessThan(0.03);
    expect(court.coords.slice(0, 2)).toEqual(court.coords.slice(-2));
    expect(small.holes).toBeUndefined();
    expect(plain.holes).toBeUndefined();
    expect(withHole.holes).toHaveLength(1);
    for (const b of houses) {
      const [w, s, e, n] = b.bbox;
      for (let i = 0; i < b.coords.length; i += 2) {
        expect(b.coords[i]).toBeGreaterThanOrEqual(w);
        expect(b.coords[i]).toBeLessThanOrEqual(e);
        expect(b.coords[i + 1]).toBeGreaterThanOrEqual(s);
        expect(b.coords[i + 1]).toBeLessThanOrEqual(n);
      }
    }
  });
});

/** A small neighbourhood with a bit of everything, some of it in the tile buffer. */
const town: Scene = {
  roads: [
    line('secondary', [-40, 2000, 2000, 2000, 4140, 2010]),
    line('minor', [2000, -50, 2000, 2000]),
    line('minor', [3000, 2005, 3010, 4150]),
    line('minor', [1000, 4130, 1000, 2000], { brunnel: 'bridge', layer: 1 }),
    path('footway', [100, 2020, 1900, 2020]),
    path('footway', [200, 3000, 1500, 3300, 1600, 3900]),
    path('steps', [2600, 2100, 2600, 2900]),
    path('pedestrian', [2200, 3000, 3900, 3100]),
    { type: 2, props: { class: 'path', subclass: 'cycleway' }, parts: [[500, 500, 1500, 600], [1500, 600, 1700, 1500]] },
  ],
  names: [
    label('Westerstraat', 'secondary', [-40, 2001, 4140, 2011]),
    label('Tichelstraat', 'minor', [2001, -50, 2001, 2000]),
    label('Karthuizersstraat', 'path', [2200, 3001, 3900, 3101], { subclass: 'pedestrian' }),
  ],
  buildings: [
    building([outer(-30, 100, 40, 160)]),
    building([outer(4050, 4050, 4200, 4200), hole(4080, 4080, 4120, 4120)]),
    building([outer(2100, 2100, 2300, 2400), hole(2150, 2150, 2250, 2300)]),
    building([outer(500, 3500, 520, 3530)]),
  ],
};

describe('parseTile ids', () => {
  it('gives the same ways and houses, ids included, every time the tile is parsed', () => {
    const a = parse(town);
    const b = parse(town);
    expect(a.ways.length).toBeGreaterThan(8);
    expect(b).toEqual(a);
    for (const w of a.ways) expect(w.id).toMatch(/^8414\.5383\.[0-9a-z]+(\.\d+)?$/);
    for (const h of a.houses) expect(h.id).toMatch(/^h8414\.5383\.\d+\.\d+(\.\d+)?$/);
  });

  it('keeps the ids of edges whose geometry did not change', () => {
    const before = parse(town);
    // A far-away footway, listed first, changes nothing about the other edges.
    const after = parse({ ...town, roads: [path('footway', [3200, 600, 3900, 700]), ...town.roads!] });
    const ids = new Set(after.ways.map((w) => w.id));
    for (const w of before.ways) expect(ids.has(w.id), w.id).toBe(true);
    expect(after.ways).toHaveLength(before.ways.length + 1);
  });

  it('makes ids unique within the tile, even for duplicate geometry', () => {
    const { ways, houses } = parse({
      ...town,
      roads: [...town.roads!, path('footway', [3200, 600, 3900, 700]), path('footway', [3200, 600, 3900, 700])],
      buildings: [...town.buildings!, building([outer(3000, 500, 3100, 600)]), building([outer(3000, 500, 3100, 600)])],
    });
    expect(new Set(ways.map((w) => w.id)).size).toBe(ways.length);
    expect(new Set(houses.map((h) => h.id)).size).toBe(houses.length);
    const dupes = ways.filter((w) => w.highway === 'footway' && ends(w)[0][0] === 3200);
    expect(dupes.map((w) => w.id)).toEqual([dupes[0].id, `${dupes[0].id}.1`]);
    const twins = houses.filter((h) => h.id.startsWith('h8414.5383.1525.275'));
    expect(twins.map((h) => h.id)).toEqual(['h8414.5383.1525.275', 'h8414.5383.1525.275.1']);
  });
});

describe('parseTile coordinates', () => {
  const allCoords = (r: { ways: WayInput[]; houses: Building[] }) => [
    ...r.ways.map((w) => w.coords),
    ...r.houses.flatMap((h) => [h.coords, ...(h.holes ?? [])]),
  ];

  it('returns lon/lat rounded to 1e-6, inside the tile bbox', () => {
    const r = parse(town);
    const [w, s, e, n] = tileToBBox(X, Y, Z);
    const eps = 1e-6;
    let count = 0;
    for (const c of allCoords(r)) {
      for (let i = 0; i < c.length; i += 2) {
        count++;
        expect(c[i]).toBeGreaterThanOrEqual(w - eps);
        expect(c[i]).toBeLessThanOrEqual(e + eps);
        expect(c[i + 1]).toBeGreaterThanOrEqual(s - eps);
        expect(c[i + 1]).toBeLessThanOrEqual(n + eps);
        expect(Math.round(c[i] * 1e6) / 1e6).toBe(c[i]);
        expect(Math.round(c[i + 1] * 1e6) / 1e6).toBe(c[i + 1]);
      }
    }
    expect(count).toBeGreaterThan(40);
  });

  it('maps the tile corners onto the corners of its bbox', () => {
    const { ways } = parse({ roads: [line('minor', [-20, -20, 4116, 4116])] });
    const [w, s, e, n] = tileToBBox(X, Y, Z);
    expect(ways).toHaveLength(1);
    const c = ways[0].coords;
    const off = [c[0] - w, c[1] - n, c[c.length - 2] - e, c[c.length - 1] - s];
    for (const d of off) expect(Math.abs(d)).toBeLessThanOrEqual(5e-7 + 1e-12);
  });

  it('reads a tile with another extent the same way', () => {
    const exact: Scene = {
      roads: [
        line('secondary', [500, 2000, 3500, 2000]),
        line('minor', [2000, 800, 2000, 2000]),
        line('minor', [3000, 500, 3000, 3500]),
        path('footway', [600, 2020, 2900, 2020]),
        path('footway', [500, 3600, 3500, 3900]),
      ],
      names: [label('Westerstraat', 'secondary', [500, 2001, 3500, 2001]), label('Tichelstraat', 'minor', [2001, 800, 2001, 2000])],
      buildings: [building([outer(1000, 1000, 1200, 1200), hole(1050, 1050, 1100, 1100)])],
    };
    const double = (f: MvtFeatureInput): MvtFeatureInput => ({ ...f, parts: f.parts.map((p) => p.map((v) => v * 2)) });
    const a = parse(exact);
    const b = parse({
      roads: exact.roads!.map(double),
      names: exact.names!.map(double),
      buildings: exact.buildings!.map(double),
      extent: 2 * EXT,
    });
    const strip = (r: { ways: WayInput[]; houses: Building[] }) => ({
      ways: r.ways.map(({ name, highway, kind, coords }) => ({ name, highway, kind, coords })),
      houses: r.houses.map(({ coords, holes }) => ({ coords, holes })),
    });
    expect(a.ways).toHaveLength(7);
    expect(strip(b)).toEqual(strip(a));
  });
});

describe('parseTile places', () => {
  const street: Scene = {
    pois: [
      poi('cafe', 'cafe', 'Cafe Walvis', [1000, 1000]),
      poi('shop', 'convenience', 'Spar', [1200, 1000], { rank: 3 }),
      poi('place_of_worship', 'christian', 'Noorderkerk', [2000, 1500], { rank: 1, 'name:latin': 'Noorderkerk', 'name:en': 'North Church' }),
      poi('shop', 'gift', 'Магазин', [2100, 1500], { 'name:latin': 'Magazin' }),
      // Not landmarks, unnamed, or not a point.
      poi('bus', 'bus_stop', 'Westermarkt', [1100, 1000]),
      poi('shop', 'beauty', 'Nails', [1300, 1000]),
      poi('cafe', 'cafe', '', [1400, 1000]),
      poi('cafe', 'cafe', '   ', [1450, 1000]),
      { type: 1, props: { class: 'cafe', subclass: 'cafe', rank: 1 }, parts: [[1500, 1000]] },
      { type: 2, props: { class: 'park', subclass: 'park', name: 'A line' }, parts: [[100, 100, 900, 100]] },
      { type: 3, props: { class: 'park', subclass: 'park', name: 'A polygon' }, parts: [outer(100, 200, 900, 900)] },
    ],
  };
  const byName = (ps: Place[]) => [...ps].sort((a, b) => a.name.localeCompare(b.name));

  it('keeps named landmark points with their class and rank, at their spot', () => {
    const { places } = parse(street);
    expect(byName(places).map((p) => [p.name, p.cls, p.rank])).toEqual([
      ['Cafe Walvis', 'cafe', 10],
      ['Magazin', 'shop', 10],
      ['Noorderkerk', 'place_of_worship', 1],
      ['Spar', 'shop', 3],
    ]);
    const walvis = places.find((p) => p.name === 'Cafe Walvis')!;
    expect(unit(walvis.lon, walvis.lat)).toEqual([1000, 1000]);
    expect(walvis.bbox).toEqual([walvis.lon, walvis.lat, walvis.lon, walvis.lat]);
    const [w, s, e, n] = tileToBBox(X, Y, Z);
    for (const p of places) {
      expect(p.lon).toBeGreaterThan(w);
      expect(p.lon).toBeLessThan(e);
      expect(p.lat).toBeGreaterThan(s);
      expect(p.lat).toBeLessThan(n);
    }
  });

  it('makes ids from class, name and spot to about a metre, the same in every tile and extent', () => {
    const { places } = parse(street);
    for (const p of places) {
      expect(p.id).toBe(`p:${p.cls}:${p.name}:${Math.round(p.lon * 1e5)}:${Math.round(p.lat * 1e5)}`);
    }
    const double = (f: MvtFeatureInput): MvtFeatureInput => ({ ...f, parts: f.parts.map((q) => q.map((v) => v * 2)) });
    const again = parse({ pois: street.pois!.map(double), extent: 2 * EXT });
    expect(again.places.map((p) => p.id)).toEqual(places.map((p) => p.id));
    // Other features coming and going leave them alone.
    const more = parse({ ...town, pois: [poi('bakery', 'bakery', 'Bbrood', [3000, 3000]), ...street.pois!] });
    expect(more.places.map((p) => p.id)).toEqual([expect.stringMatching(/^p:bakery:Bbrood:/), ...places.map((p) => p.id)]);
  });

  it('takes every point of a multipoint and drops repeats of the same place', () => {
    const { places } = parse({
      pois: [
        poi('fast_food', 'fast_food', 'Putka', [500, 500, 3500, 3500]),
        poi('fast_food', 'fast_food', 'Putka', [500, 500]),
        poi('bakery', 'bakery', 'Putka', [500, 500]),
      ],
    });
    expect(places.map((p) => [p.cls, unit(p.lon, p.lat)])).toEqual([
      ['fast_food', [500, 500]],
      ['fast_food', [3500, 3500]],
      ['bakery', [500, 500]],
    ]);
    expect(new Set(places.map((p) => p.id)).size).toBe(3);
  });

  it('leaves the points in the buffer to the neighbouring tile, so each place is in one tile', () => {
    const edge: Scene = {
      pois: [
        poi('cafe', 'cafe', 'West', [-10, 2000]),
        poi('cafe', 'cafe', 'North', [2000, -1]),
        poi('cafe', 'cafe', 'Corner', [0, 0]),
        poi('cafe', 'cafe', 'East edge', [EXT, 2000]),
        poi('cafe', 'cafe', 'South edge', [2000, EXT]),
        poi('cafe', 'cafe', 'Far', [EXT + 60, EXT + 60]),
      ],
    };
    expect(parse(edge).places.map((p) => p.name)).toEqual(['Corner']);
    // The tile to the east has the point on the shared edge, under the same id as anywhere.
    const east = parse({ pois: [poi('cafe', 'cafe', 'East edge', [0, 2000])] }, X + 1, Y).places;
    expect(east).toHaveLength(1);
    expect(east[0].lon).toBeCloseTo(tileToBBox(X, Y, Z)[2], 6);
    expect(east[0].id).toBe(`p:cafe:East edge:${Math.round(east[0].lon * 1e5)}:${Math.round(east[0].lat * 1e5)}`);
  });

  it('returns no places for a tile without a poi layer', () => {
    const layers = decodeTile(tileOf(town), TILE_LAYERS);
    layers.delete('poi');
    const r = parseTile(layers, Z, X, Y);
    expect(r.places).toEqual([]);
    expect(r.ways.length).toBeGreaterThan(8);
  });
});
