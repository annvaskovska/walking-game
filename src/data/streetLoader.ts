import { CONFIG } from '../config';
import { Blocks, type Block } from '../core/blocks';
import { cellKey, lonLatToTile, parseCellKey, tileToBBox, type BBox } from '../geo/geo';
import { splitWay } from '../geo/pieces';
import { GridIndex } from '../geo/spatialIndex';
import type { Piece, WayInput } from '../core/types';
import type { Storage } from '../platform/storage';
import { fetchWays, OVERPASS_ENDPOINTS, OverpassError } from './overpass';

/**
 * Bump to refetch every cell after a change to what is fetched. v2 added street kinds and the
 * junction nodes that split ways into city blocks.
 */
const CELL_VERSION = 2;

interface CellRecord {
  key: string;
  v: number;
  fetchedAt: number;
  ways: WayInput[];
}

export type LoaderState = 'idle' | 'loading' | 'retrying' | 'offline';

export interface LoaderStatus {
  state: LoaderState;
  /** Cells around the user still waiting for the network. */
  pending: number;
  /** Is the user's own cell loaded? */
  hereLoaded: boolean;
  nextRetryAt: number | null;
  lastError: string | null;
}

type Fetcher = typeof fetchWays;

/**
 * Loads walkable streets per z15 grid cell around the user. Every cell is fetched from Overpass
 * once, stored in IndexedDB, and afterwards loaded from there. Requests go one at a time, nearest
 * cell first, with exponential backoff and endpoint rotation when Overpass is busy or offline.
 */
export class StreetLoader {
  readonly index = new GridIndex<Piece>();
  /** City blocks of every way loaded so far, indexed for drawing and lookup. */
  readonly blocks = new Blocks();
  private known = new Set<string>();
  private loaded = new Set<string>();
  private loading = new Map<string, Promise<void>>();
  private ways = new Set<number>();
  private pending: string[] = [];
  private focus: { x: number; y: number } | null = null;
  private busy = false;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  status: LoaderStatus = { state: 'idle', pending: 0, hereLoaded: false, nextRetryAt: null, lastError: null };

  constructor(
    private storage: Storage,
    private hooks: {
      onPieces(pieces: Piece[]): void;
      onBlocks(blocks: Block[]): void;
      onStatus(s: LoaderStatus): void;
    },
    private fetcher: Fetcher = fetchWays,
  ) {}

  async init(): Promise<void> {
    this.known = new Set(await this.storage.getAllKeys('cells'));
    window.addEventListener('online', () => {
      if (this.retryTimer) clearTimeout(this.retryTimer);
      this.retryTimer = null;
      this.kick();
    });
  }

  /** Make sure the cell under the user and its 8 neighbours are loaded. Cheap to call per fix. */
  ensureAround(lon: number, lat: number): void {
    const z = CONFIG.cellZoom;
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
    // Nearest first; forget far-away cells the user walked away from.
    const dist = (k: string) => {
      const c = parseCellKey(k);
      return Math.max(Math.abs(c.x - x), Math.abs(c.y - y));
    };
    this.pending = this.pending.filter((k) => dist(k) <= 2).sort((a, b) => dist(a) - dist(b));
    this.emit();
    this.kick();
  }

  /** Load already-cached cells in a view box (no network); for browsing old walks. */
  async loadCachedIn(b: BBox, maxCells = 36): Promise<void> {
    const z = CONFIG.cellZoom;
    const a = lonLatToTile(b[0], b[3], z);
    const c = lonLatToTile(b[2], b[1], z);
    if ((c.x - a.x + 1) * (c.y - a.y + 1) > maxCells) return;
    const jobs: Promise<void>[] = [];
    for (let x = a.x; x <= c.x; x++) {
      for (let y = a.y; y <= c.y; y++) {
        const k = cellKey(z, x, y);
        if (this.known.has(k) && !this.loaded.has(k)) jobs.push(this.loadCached(k));
      }
    }
    await Promise.all(jobs);
  }

  isHereLoaded(): boolean {
    if (!this.focus) return false;
    return this.loaded.has(cellKey(CONFIG.cellZoom, this.focus.x, this.focus.y));
  }

  /** Try the network again right now (e.g. from a "retry" button). */
  retryNow(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.kick();
  }

  private loadCached(key: string): Promise<void> {
    const existing = this.loading.get(key);
    if (existing) return existing;
    const p = (async () => {
      const rec = await this.storage.get<CellRecord>('cells', key);
      if (rec && rec.v === CELL_VERSION) {
        this.loaded.add(key);
        this.addWays(rec.ways);
      } else {
        this.known.delete(key);
        if (!this.pending.includes(key)) this.pending.push(key);
        this.kick();
      }
      this.emit();
    })().finally(() => this.loading.delete(key));
    this.loading.set(key, p);
    return p;
  }

  private addWays(ways: WayInput[]): void {
    const freshPieces: Piece[] = [];
    const freshBlocks: Block[] = [];
    for (const w of ways) {
      if (this.ways.has(w.id)) continue;
      this.ways.add(w.id);
      const pieces = splitWay(w);
      for (const p of pieces) if (this.index.insert(p)) freshPieces.push(p);
      freshBlocks.push(...this.blocks.add(w, pieces));
    }
    // Blocks first: a replay triggered by new pieces needs their blocks to exist.
    if (freshBlocks.length) this.hooks.onBlocks(freshBlocks);
    if (freshPieces.length) this.hooks.onPieces(freshPieces);
  }

  private kick(): void {
    if (this.busy || this.retryTimer || this.pending.length === 0) {
      this.emit();
      return;
    }
    void this.run();
  }

  private async run(): Promise<void> {
    const key = this.pending[0];
    this.busy = true;
    this.status.state = 'loading';
    this.emit();
    const { z, x, y } = parseCellKey(key);
    const endpoint = OVERPASS_ENDPOINTS[this.attempt % OVERPASS_ENDPOINTS.length];
    try {
      const ways = await this.fetcher(tileToBBox(x, y, z), endpoint);
      const rec: CellRecord = { key, v: CELL_VERSION, fetchedAt: Date.now(), ways };
      await this.storage.putMany('cells', [rec]).catch((e) => console.warn('Could not cache cell', e));
      this.known.add(key);
      this.loaded.add(key);
      this.pending = this.pending.filter((k) => k !== key);
      this.addWays(ways);
      this.attempt = 0;
      this.status.lastError = null;
      this.status.nextRetryAt = null;
      this.status.state = 'idle';
    } catch (e) {
      this.attempt++;
      const msg = e instanceof OverpassError || e instanceof Error ? e.message : String(e);
      this.status.lastError = msg;
      if (typeof navigator !== 'undefined' && navigator.onLine === false) {
        this.status.state = 'offline';
        this.status.nextRetryAt = null;
        // the 'online' listener resumes; also poll slowly in case the event never comes
        this.retryTimer = setTimeout(() => this.retryAfterWait(), 30_000);
      } else {
        const delay = Math.min(60_000, 3000 * 2 ** Math.min(this.attempt - 1, 5)) * (0.8 + Math.random() * 0.4);
        this.status.state = 'retrying';
        this.status.nextRetryAt = Date.now() + delay;
        this.retryTimer = setTimeout(() => this.retryAfterWait(), delay);
      }
    } finally {
      this.busy = false;
      this.emit();
      if (!this.retryTimer) this.kick();
    }
  }

  private retryAfterWait(): void {
    this.retryTimer = null;
    this.kick();
  }

  private emit(): void {
    this.status.pending = this.pending.length;
    this.status.hereLoaded = this.isHereLoaded();
    if (this.status.state === 'idle' && this.busy) this.status.state = 'loading';
    this.hooks.onStatus({ ...this.status });
  }
}
