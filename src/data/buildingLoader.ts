import { CONFIG } from '../config';
import { bboxOfCoords, cellKey, expandBBox, lonLatToTile, parseCellKey, polylineDistanceM, tileToBBox } from '../geo/geo';
import { GridIndex } from '../geo/spatialIndex';
import type { Building } from '../core/types';
import type { Storage } from '../platform/storage';
import { fetchBuildings, OVERPASS_ENDPOINTS, OverpassError } from './overpass';

const CELL_VERSION = 1;

interface BuildingCellRecord {
  key: string;
  v: number;
  fetchedAt: number;
  buildings: Building[];
}

type Fetcher = typeof fetchBuildings;

/**
 * Loads OSM building footprints around the walker by z16 cell, caches them in IndexedDB and
 * hands the new ones to the app so houses along unlocked blocks can switch their windows on.
 * It runs beside the street loader, one request at a time, and never blocks a walk: a failure
 * just means houses appear on a later pass.
 */
export class BuildingLoader {
  readonly index = new GridIndex<Building>();
  private known = new Set<string>();
  private loaded = new Set<string>();
  private loading = new Map<string, Promise<void>>();
  private pending: string[] = [];
  private focus: { x: number; y: number } | null = null;
  private busy = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private storage: Storage,
    private hooks: { onHouses(buildings: Building[]): void },
    private fetcher: Fetcher = fetchBuildings,
  ) {}

  async init(): Promise<void> {
    this.known = new Set(await this.storage.getAllKeys('bldCells'));
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => {
        if (this.retryTimer) clearTimeout(this.retryTimer);
        this.retryTimer = null;
        this.kick();
      });
    }
  }

  /** Fetch the cells under the walker and their neighbours. Cheap to call on every fix. */
  ensureAround(lon: number, lat: number): void {
    const z = CONFIG.buildingCellZoom;
    const { x, y } = lonLatToTile(lon, lat, z);
    if (this.focus && this.focus.x === x && this.focus.y === y) return;
    this.focus = { x, y };
    const keys: string[] = [];
    for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0], [1, -1], [1, 1], [-1, 1], [-1, -1]]) {
      keys.push(cellKey(z, x + dx, y + dy));
    }
    for (const k of keys) {
      if (this.loaded.has(k)) continue;
      if (this.known.has(k)) void this.loadCached(k);
      else if (!this.pending.includes(k)) this.pending.push(k);
    }
    const dist = (k: string) => {
      const c = parseCellKey(k);
      return Math.max(Math.abs(c.x - x), Math.abs(c.y - y));
    };
    this.pending = this.pending.filter((k) => dist(k) <= 2).sort((a, b) => dist(a) - dist(b));
    this.kick();
  }

  /** Buildings whose footprint comes within `radiusM` of a line, e.g. a block. */
  buildingsNear(flat: ArrayLike<number>, radiusM: number): Building[] {
    if (flat.length < 4) return [];
    const box = expandBBox(bboxOfCoords(flat), radiusM);
    const out: Building[] = [];
    for (const b of this.index.query(box)) {
      if (polylineDistanceM(flat, b.coords) <= radiusM) out.push(b);
    }
    return out;
  }

  private loadCached(key: string): Promise<void> {
    const existing = this.loading.get(key);
    if (existing) return existing;
    const p = (async () => {
      const rec = await this.storage.get<BuildingCellRecord>('bldCells', key);
      if (rec && rec.v === CELL_VERSION) {
        this.loaded.add(key);
        this.add(rec.buildings);
      } else {
        this.known.delete(key);
        if (!this.pending.includes(key)) this.pending.push(key);
        this.kick();
      }
    })().finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }

  private add(buildings: Building[]): void {
    const fresh: Building[] = [];
    for (const b of buildings) if (this.index.insert(b)) fresh.push(b);
    if (fresh.length) this.hooks.onHouses(fresh);
  }

  private kick(): void {
    if (this.busy || this.retryTimer || this.pending.length === 0) return;
    void this.run();
  }

  private async run(): Promise<void> {
    const key = this.pending[0];
    this.busy = true;
    const { z, x, y } = parseCellKey(key);
    const endpoint = OVERPASS_ENDPOINTS[this.attempt % OVERPASS_ENDPOINTS.length];
    try {
      const buildings = await this.fetcher(tileToBBox(x, y, z), endpoint);
      const rec: BuildingCellRecord = { key, v: CELL_VERSION, fetchedAt: Date.now(), buildings };
      await this.storage.putMany('bldCells', [rec]).catch((e) => console.warn('Could not cache buildings', e));
      this.known.add(key);
      this.loaded.add(key);
      this.pending = this.pending.filter((k) => k !== key);
      this.add(buildings);
      this.attempt = 0;
    } catch (e) {
      this.attempt++;
      const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
      const msg = e instanceof OverpassError || e instanceof Error ? e.message : String(e);
      if (this.attempt === 1) console.warn('Buildings not loaded yet:', msg);
      const delay = offline ? 30_000 : Math.min(60_000, 3000 * 2 ** Math.min(this.attempt - 1, 5)) * (0.8 + Math.random() * 0.4);
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.kick();
      }, delay);
    } finally {
      this.busy = false;
      this.kick();
    }
  }
}

/** Exposed for tests that build a loader without IndexedDB. */
export type { BuildingCellRecord };
