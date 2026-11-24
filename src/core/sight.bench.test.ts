import { describe, expect, it } from 'vitest';
import { bboxOfCoords, bearingDeg, distanceM } from '../geo/geo';
import { GridIndex } from '../geo/spatialIndex';
import { SIM_ROUTE } from '../platform/simRoute';
import { wmX, wmY } from '../map/fog/geometry';
import { nightTheme } from '../theme';
import { OccluderCache, stepOutside, wmPerMetre } from './occluders';
import { SeenGrid, type LightShape } from './seen';
import { SeenMemory } from './seenMemory';
import { computeSight, newSight } from './sight';
import type { Building } from './types';

/**
 * How long a look takes: the walls, the sight and the paint at 20 spots along the demo walk,
 * between made-up houses. Prints the timings.
 */
const RAD = Math.PI / 180;
/** The demo walk as [lon, lat] points. */
const TRUTH = Array.from({ length: SIM_ROUTE.length / 2 }, (_, i) => [SIM_ROUTE[2 * i], SIM_ROUTE[2 * i + 1]]);

/** Made-up houses: a 12 m square every 20 m across the box around the demo walk, as flat closed rings. */
function madeUpHouses(): number[][] {
  const [w, s, e, n] = bboxOfCoords(SIM_ROUTE);
  const dLat = 1 / 111_320, dLon = dLat / Math.cos(s * RAD);
  const out: number[][] = [];
  for (let lat = s; lat < n; lat += 20 * dLat) {
    for (let lon = w; lon < e; lon += 20 * dLon) {
      const x = lon + 12 * dLon, y = lat + 12 * dLat;
      out.push([lon, lat, x, lat, x, y, lon, y, lon, lat]);
    }
  }
  return out;
}

describe('sight benchmark', () => {
  it('looks in a few milliseconds', () => {
    const houses = new GridIndex<Building>();
    madeUpHouses().forEach((coords, i) => houses.insert({ id: `h${i}`, coords, bbox: bboxOfCoords(coords) }));

    // 20 spots evenly along the walk, facing the way it goes.
    const legs = TRUTH.slice(1).map((p, i) => distanceM(TRUTH[i][0], TRUTH[i][1], p[0], p[1]));
    const total = legs.reduce((a, b) => a + b, 0);
    const spots: { lon: number; lat: number; heading: number }[] = [];
    for (let k = 0; k < 20; k++) {
      let d = ((k + 0.5) * total) / 20, i = 0;
      while (d > legs[i]) d -= legs[i++];
      const [a, b] = [TRUTH[i], TRUTH[i + 1]], f = d / legs[i];
      spots.push({ lon: a[0] + (b[0] - a[0]) * f, lat: a[1] + (b[1] - a[1]) * f, heading: bearingDeg(a[0], a[1], b[0], b[1]) });
    }

    const { fog } = nightTheme;
    const cache = new OccluderCache();
    const sight = newSight(4096);
    const ms = { gather: 0, sight: 0, paint: 0, repaint: 0, look: 0 };
    let edges = 0, nHouses = 0, rays = 0;
    const rounds = 6;
    for (let round = 0; round < rounds; round++) {
      // The first rounds warm up the JIT; the last one is measured.
      const measure = round === rounds - 1;
      const grid = new SeenGrid();
      const memory = new SeenMemory(nightTheme);
      for (const p of spots) {
        const t0 = performance.now();
        // A new houses version forces a fresh gather at every spot.
        const occ = cache.around(p.lon, p.lat, houses, round * 100 + spots.indexOf(p));
        const m2u = wmPerMetre(p.lat);
        const [x, y] = stepOutside(occ, wmX(p.lon), wmY(p.lat), m2u);
        const light: LightShape = {
          lantern: fog.lanternM * m2u, cone: fog.coneM * m2u, inner: fog.coneInnerDeg * RAD, outer: fog.coneHalfDeg * RAD,
          dir: Math.atan2(-Math.cos(p.heading * RAD), Math.sin(p.heading * RAD)), coneOn: 1,
        };
        const t = performance.now();
        computeSight(x, y, occ, (fog.coneM + 4) * m2u, sight);
        const t1 = performance.now();
        grid.paint(sight, light);
        const t2 = performance.now();
        grid.paint(sight, light);
        const t3 = performance.now();
        memory.look({ lon: p.lon, lat: p.lat, heading: p.heading, cone: 1 }, occ, [], 0);
        const t4 = performance.now();
        if (!measure) continue;
        ms.gather += t - t0;
        ms.sight += t1 - t;
        ms.paint += t2 - t1;
        ms.repaint += t3 - t2;
        ms.look += t4 - t3;
        edges += occ.n;
        nHouses += occ.houses.length;
        rays += sight.n;
      }
    }
    const n = spots.length, f = (v: number) => (v / n).toFixed(3);
    console.log(
      `sight bench, per look over ${n} spots: gather ${f(ms.gather)} ms, sight ${f(ms.sight)} ms, paint ${f(ms.paint)} ms (again ${f(ms.repaint)} ms), ` +
        `full look ${f(ms.look)} ms; ${Math.round(edges / n)} walls of ${Math.round(nHouses / n)} houses gathered, ${Math.round(rays / n)} rays`,
    );
    expect(rays).toBeGreaterThan(0);
  });
});
