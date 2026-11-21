import { GridIndex } from '../geo/spatialIndex';
import { wmX, wmY } from '../map/fog/geometry';
import type { Theme } from '../theme';
import { stepOutside, wmPerMetre, type Occluders } from './occluders';
import { SeenGrid, type LightShape, type SeenTile } from './seen';
import { computeSight, newSight, sightDistance, type Sight } from './sight';
import type { Place, SeenHouse, SeenPlace } from './types';

/** One look around: where you stand, where you face (null: no heading), the cone's strength 0..1. */
export interface Look {
  lon: number;
  lat: number;
  heading: number | null;
  cone: number;
}

export interface LookResult {
  tiles: SeenTile[];
  houses: SeenHouse[];
  places: SeenPlace[];
}

const RAD = Math.PI / 180;
const PI = Math.PI;
const TAU = 2 * PI;
/** A ray counts as "in the beam" this far past the cone's inner half-angle. */
const BEAM_SLACK = 9 * RAD;
/** Landmarks sit inside the house the ray stopped at: they count this far behind its wall (m). */
const PLACE_BEHIND_M = 12;
/** Sight reaches a little past the light, so walls at its very edge still stop it (m). */
const SIGHT_SLACK_M = 4;
/** A look this close to the last one (m, degrees, cone strength) adds nothing new. */
const SAME_SPOT_M = 1.5;
const SAME_HEADING = 6 * RAD;
const SAME_CONE = 0.1;
/** The cone counts as "on" for seen houses from this strength. */
const CONE_ON = 0.5;
/** What a look that adds nothing returns (shared, frozen: do not change it). */
const NOTHING: LookResult = { tiles: [], houses: [], places: [] };
Object.freeze(NOTHING.tiles);
Object.freeze(NOTHING.houses);
Object.freeze(NOTHING.places);
Object.freeze(NOTHING);

const wrap = (a: number): number => {
  let d = a % TAU;
  if (d > PI) d -= TAU;
  else if (d < -PI) d += TAU;
  return d;
};

/** What one look adds to what you have seen: tiles of the seen raster, houses and landmarks. */
export class SeenMemory {
  readonly grid = new SeenGrid();
  readonly houses = new GridIndex<SeenHouse>();
  readonly places = new GridIndex<SeenPlace>();
  private readonly sight: Sight = newSight(4096);
  private readonly light: LightShape = { lantern: 0, cone: 0, dir: 0, inner: 0, outer: 0, coneOn: 0 };
  private last = { x: Number.NaN, y: Number.NaN, heading: null as number | null, cone: 0, version: -1 };

  constructor(private readonly theme: Theme) {}

  loadHouses(r: Iterable<SeenHouse>): void {
    for (const h of r) this.houses.insert(h);
  }

  loadPlaces(r: Iterable<SeenPlace>): void {
    for (const p of r) this.places.insert(p);
  }

  /** The sight of the last look that was not skipped (WM units), e.g. for debugging overlays. */
  get lastSight(): Sight {
    return this.sight;
  }

  /**
   * See from a spot: steps out of a house if inside one, computes the sight over `occ`, paints
   * the grid, and returns houses hit within reach (theme.seen.beamM inside the cone,
   * aroundM elsewhere) and landmarks within reach whose spot is visible or just behind the wall
   * the ray stopped at (shops sit inside houses). Skips looks that add nothing new (same spot
   * within ~1.5 m and heading within ~6°). What it returns is already stored here.
   */
  look(l: Look, occ: Occluders, places: Iterable<Place>, now: number): LookResult {
    const { fog, seen } = this.theme;
    const m2u = wmPerMetre(l.lat);
    const [x, y] = stepOutside(occ, wmX(l.lon), wmY(l.lat), m2u);
    const coneOn = l.heading === null ? 0 : Math.max(0, Math.min(1, l.cone));
    if (this.same(x, y, l.heading, coneOn, occ.version, m2u)) return NOTHING;
    this.last.x = x;
    this.last.y = y;
    this.last.heading = l.heading;
    this.last.cone = coneOn;
    this.last.version = occ.version;

    const light = this.light;
    light.lantern = fog.lanternM * m2u;
    light.cone = fog.coneM * m2u;
    light.inner = fog.coneInnerDeg * RAD;
    light.outer = fog.coneHalfDeg * RAD;
    light.dir = l.heading === null ? 0 : Math.atan2(-Math.cos(l.heading * RAD), Math.sin(l.heading * RAD));
    light.coneOn = coneOn;
    const beam = coneOn >= CONE_ON;
    const reachM = coneOn > 0 ? Math.max(fog.coneM, seen.beamM) : Math.max(fog.lanternM, seen.aroundM);
    const s = computeSight(x, y, occ, (reachM + SIGHT_SLACK_M) * m2u, this.sight);
    const tiles = this.grid.paint(s, light);

    const beamU = seen.beamM * m2u, aroundU = seen.aroundM * m2u, beamHalf = light.inner + BEAM_SLACK;
    const reachAt = (a: number): number => (beam && Math.abs(wrap(a - light.dir)) < beamHalf ? beamU : aroundU);
    const houses: SeenHouse[] = [];
    for (let i = 0; i < s.n; i++) {
      const k = s.hit[i];
      if (k < 0) continue;
      const b = occ.houses[k];
      if (this.houses.has(b.id) || s.dist[i] > reachAt(s.ang[i])) continue;
      const h: SeenHouse = { id: b.id, coords: b.coords, bbox: b.bbox, seenAt: now };
      if (b.holes) h.holes = b.holes;
      this.houses.insert(h);
      houses.push(h);
    }

    const found: SeenPlace[] = [];
    const behind = PLACE_BEHIND_M * m2u, far = (Math.max(seen.beamM, seen.aroundM) + 1) * m2u;
    for (const p of places) {
      if (this.places.has(p.id)) continue;
      const dx = wmX(p.lon) - x;
      if (dx > far || dx < -far) continue;
      const dy = wmY(p.lat) - y;
      if (dy > far || dy < -far) continue;
      const d = Math.sqrt(dx * dx + dy * dy), a = Math.atan2(dy, dx);
      if (d > reachAt(a) || d > sightDistance(s, a) + behind) continue;
      const sp: SeenPlace = { ...p, seenAt: now };
      this.places.insert(sp);
      found.push(sp);
    }
    if (!tiles.length && !houses.length && !found.length) return NOTHING;
    return { tiles, houses, places: found };
  }

  private same(x: number, y: number, heading: number | null, cone: number, version: number, m2u: number): boolean {
    const p = this.last;
    if (version !== p.version || Math.abs(cone - p.cone) > SAME_CONE) return false;
    // Without a cone, where you face changes nothing.
    if (cone > 0 || p.cone > 0) {
      if ((heading === null) !== (p.heading === null)) return false;
      if (heading !== null && p.heading !== null && Math.abs(wrap((heading - p.heading) * RAD)) > SAME_HEADING) return false;
    }
    const r = SAME_SPOT_M * m2u;
    return (x - p.x) * (x - p.x) + (y - p.y) * (y - p.y) <= r * r;
  }
}
