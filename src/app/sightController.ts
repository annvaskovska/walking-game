import { HeadingFusion } from '../core/heading';
import type { MotionFrame } from '../core/motion';
import { OccluderCache, stepOutside, type Occluders } from '../core/occluders';
import { SeenMemory, type Look } from '../core/seenMemory';
import type { Fix, LitHouse, SeenHouse, SeenPlace } from '../core/types';
import type { StreetGraph } from '../data/graph';
import type { TileSource } from '../data/tiles';
import { declinationDeg, decimalYear } from '../geo/declination';
import { bearingDeg, distanceM, metresPerDegree } from '../geo/geo';
import { pageTime } from '../map/fog/fogLayer';
import { LONG_AGO, latOfWm, lonOfWm, wmX, wmY } from '../map/fog/geometry';
import type { MapView } from '../map/mapView';
import { createCompass } from '../platform/compass';
import type { Storage } from '../platform/storage';
import type { Theme } from '../theme';

/** A seen-memory tile as stored. */
interface StoredTile {
  key: string;
  data: Uint8Array;
}

/** What to save of the seen memory. */
export interface Saves {
  tiles: StoredTile[];
  houses: SeenHouse[];
  places: SeenPlace[];
}

/** What the walker's light does this frame. */
export interface LightFrame {
  /** Where the light comes from (you, stepped out of a house if GPS put you inside one). */
  lon: number;
  lat: number;
  heading: number | null;
  cone: number;
  /** Where the beam points comes from the compass (you are looking around). */
  looking: boolean;
  /** The beam is easing between compass and GPS, or fading: worth drawing every frame. */
  settling: boolean;
}

/** Live looks while you walk or look around: at most this often (ms). */
const LIVE_LOOK_MS = 220;
/** Fixes older than this (ms) when they arrive were recorded while the screen was off. */
const REPLAY_AGE_MS = 4000;
/** Replayed fixes are looked from every few metres, not every second... */
const REPLAY_STEP_M = 5;
/** ...a few per frame, so an hour in the pocket does not freeze the map (~0.7 ms a look). */
const REPLAYS_PER_FRAME = 6;
/** Looks waiting for their streets: the newest are kept. */
const MAX_PENDING = 600;

/**
 * Line of sight: your light stops at walls, and what you see stays moonlit for good. This keeps
 * the walls around you, turns your position and the way you look (compass, else the way you walk)
 * into the light the fog draws, and into "looks" that the seen memory remembers: the moonlit
 * ground, the houses and the landmarks you have seen. While the screen was locked (iPhone app),
 * the fixes recorded meanwhile are looked from in the direction you walked.
 */
export class SightController {
  readonly memory: SeenMemory;
  private occluders = new OccluderCache();
  /** Walls around replayed fixes, apart from the ones around you the shadows use. */
  private replayWalls = new OccluderCache();
  private occVersion = -1;
  private compass = createCompass();
  private fusion = new HeadingFusion();
  private lastLiveLook = 0;
  /** Replayed looks (screen was off), done a few per frame. */
  private replays: Look[] = [];
  private lastReplay: Fix | null = null;
  /** Replayed looks waiting for the walls around them to load. */
  private pending: Look[] = [];
  private newHouses: SeenHouse[] = [];
  private newPlaces: SeenPlace[] = [];
  /** Tiles whose save failed, saved again with the next ones. */
  private unsaved = new Map<string, StoredTile>();
  private placesTimer = 0;
  /** Demo only: look this way (degrees), as if the phone had a compass. */
  simLook: number | null = null;

  constructor(
    private theme: Theme,
    private view: MapView,
    private graph: StreetGraph,
    private source: TileSource,
    private isLit: (houseId: string) => boolean,
  ) {
    this.memory = new SeenMemory(theme);
  }

  /** What you saw on earlier walks, back on the map. */
  async load(storage: Storage): Promise<void> {
    const [tiles, houses, places] = await Promise.all([
      storage.getAll<StoredTile>('seen'),
      storage.getAll<SeenHouse>('seenHouses'),
      storage.getAll<SeenPlace>('places'),
    ]);
    this.memory.grid.load(tiles.filter((t) => t.data instanceof Uint8Array));
    this.memory.loadHouses(houses);
    this.memory.loadPlaces(places);
    for (const t of this.memory.grid.tiles.values()) this.view.fog.setSeenTile(t);
    for (const h of houses) if (!this.isLit(h.id)) this.view.fog.addSeenHouse(h, LONG_AGO);
    this.view.setSeenPlaces([...this.memory.places.values()]);
  }

  start(): void {
    this.compass.start();
    this.lastLiveLook = 0;
  }

  /**
   * A walk carried on at launch had no Start tap, and the phone lets the compass on only after a
   * tap: the next tap on the map turns it on.
   */
  askOnNextTap(): void {
    if (!this.compass.supported) return;
    document.addEventListener('click', () => void this.compass.requestPermission(), { once: true, capture: true });
  }

  stop(): void {
    this.compass.stop();
    this.fusion.reset();
    this.pending = [];
    this.replays = [];
    this.lastReplay = null;
    this.view.fog.setOccluders(null);
    this.occVersion = -1;
  }

  /**
   * The light for this frame, from the walker's position; also keeps the walls around it up to
   * date for the shadows, and now and then remembers what you see.
   */
  frame(now: number, f: MotionFrame): LightFrame {
    const gps = { heading: f.heading, cone: f.cone, moving: f.moving };
    const sim = this.simLook;
    // The demo looks along true headings; a real compass reads magnetic ones.
    const reading = sim !== null
      ? { heading: sim - this.fusion.declination, accuracy: 5, t: now }
      : this.compass.read(now);
    const h = this.fusion.update(now, gps, reading);

    const occ = this.wallsAround(f.lon, f.lat);
    let lon = f.lon, lat = f.lat;
    if (occ) {
      const m2u = 1 / Math.cos((f.lat * Math.PI) / 180);
      const [x, y] = stepOutside(occ, wmX(f.lon), wmY(f.lat), m2u);
      lon = lonOfWm(x);
      lat = latOfWm(y);
    }
    const light: LightFrame = {
      lon, lat, heading: h.heading, cone: h.cone, looking: h.source === 'compass', settling: h.settling,
    };

    // Live looks need the walls around you; until they load, the next frame looks again.
    if (occ && now - this.lastLiveLook >= LIVE_LOOK_MS) {
      this.lastLiveLook = now;
      this.see({ lon: f.lon, lat: f.lat, heading: h.heading, cone: h.cone }, occ);
    }
    this.replaySome();
    return light;
  }

  /**
   * A fix of the walk. Live fixes are looked from by the frame loop; fixes recorded while the
   * screen was off are queued here, to be looked from facing the way you walked.
   */
  fix(fix: Fix, from: Fix | null, nowMs: number): void {
    if (nowMs - fix.t < REPLAY_AGE_MS && document.visibilityState === 'visible') return;
    const last = this.lastReplay;
    if (last && distanceM(last.lon, last.lat, fix.lon, fix.lat) < REPLAY_STEP_M) return;
    this.lastReplay = fix;
    const heading = from ? bearingDeg(from.lon, from.lat, fix.lon, fix.lat) : null;
    this.replays.push({ lon: fix.lon, lat: fix.lat, heading, cone: heading === null ? 0 : 1 });
  }

  /** New streets and houses arrived: looks that waited for them can happen now. */
  tileArrived(): void {
    if (!this.pending.length) return;
    this.replays.push(...this.pending);
    this.pending = [];
  }

  /** Replayed looks, oldest first, a few per frame; those whose streets have not loaded wait. */
  private replaySome(): void {
    const n = Math.min(this.replays.length, REPLAYS_PER_FRAME);
    if (!n) return;
    for (const l of this.replays.splice(0, n)) {
      if (!this.covered(l.lon, l.lat)) {
        this.pending.push(l);
        continue;
      }
      this.see(l, this.replayWalls.around(l.lon, l.lat, this.graph.houses, this.graph.version));
    }
    if (this.pending.length > MAX_PENDING) this.pending.splice(0, this.pending.length - MAX_PENDING);
  }

  /** Houses that just lit up gold are drawn as lit houses, not seen ones. */
  housesLit(houses: LitHouse[]): void {
    for (const h of houses) this.view.fog.removeSeenHouse(h.id);
  }

  /** What changed since the last save. */
  takeSaves(): Saves {
    for (const t of this.memory.grid.takeDirty()) this.unsaved.set(t.key, { key: t.key, data: t.data });
    const out = { tiles: [...this.unsaved.values()], houses: this.newHouses, places: this.newPlaces };
    this.unsaved.clear();
    this.newHouses = [];
    this.newPlaces = [];
    return out;
  }

  /** A save that failed: tried again with the next one. */
  giveBack(s: Saves): void {
    for (const t of s.tiles) if (!this.unsaved.has(t.key)) this.unsaved.set(t.key, t);
    this.newHouses.unshift(...s.houses);
    this.newPlaces.unshift(...s.places);
  }

  get hasSaves(): boolean {
    return (
      this.newHouses.length > 0 || this.newPlaces.length > 0 || this.unsaved.size > 0 ||
      this.memory.grid.dirtyCount > 0
    );
  }

  /** The walls within reach of a spot, once the street data under all of it has loaded. */
  private wallsAround(lon: number, lat: number): Occluders | null {
    if (!this.covered(lon, lat)) return null;
    const occ = this.occluders.around(lon, lat, this.graph.houses, this.graph.version);
    if (occ.version !== this.occVersion) {
      this.occVersion = occ.version;
      this.view.fog.setOccluders(occ);
      // The compass points to magnetic north, the map to true north (a few degrees apart in most cities).
      this.fusion.declination = declinationDeg(lat, lon, decimalYear(new Date()));
    }
    return occ;
  }

  /** Is the street data loaded everywhere your sight reaches from here? */
  private covered(lon: number, lat: number): boolean {
    const m = metresPerDegree(lat);
    const r = this.theme.fog.coneM;
    const dLon = r / m.lon, dLat = r / m.lat;
    return (
      this.source.hasGraphAt(lon - dLon, lat - dLat) && this.source.hasGraphAt(lon + dLon, lat - dLat) &&
      this.source.hasGraphAt(lon - dLon, lat + dLat) && this.source.hasGraphAt(lon + dLon, lat + dLat)
    );
  }

  /** Remember what you see from a spot, over the walls around it. */
  private see(l: Look, occ: Occluders): void {
    const m = metresPerDegree(l.lat);
    const r = this.theme.fog.coneM + 15;
    const places = this.graph.places.query([l.lon - r / m.lon, l.lat - r / m.lat, l.lon + r / m.lon, l.lat + r / m.lat]);
    const res = this.memory.look(l, occ, places, Date.now());
    for (const t of res.tiles) this.view.fog.setSeenTile(t);
    if (res.houses.length) {
      const t0 = pageTime();
      for (const h of res.houses) {
        this.newHouses.push(h);
        if (!this.isLit(h.id)) this.view.fog.addSeenHouse(h, t0 + Math.random() * 0.25);
      }
    }
    if (res.places.length) {
      this.newPlaces.push(...res.places);
      if (!this.placesTimer) {
        this.placesTimer = window.setTimeout(() => {
          this.placesTimer = 0;
          this.view.setSeenPlaces([...this.memory.places.values()]);
        }, 400);
      }
    }
  }
}
