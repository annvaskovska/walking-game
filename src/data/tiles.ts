import type { Block } from '../core/blocks';
import type { Building } from '../core/types';
import { lonLatToTile, metresPerDegree } from '../geo/geo';
import type { TileJob, TileResult } from './tileWorker';
import { tileTemplate, tileUrl } from './tileUrl';

/** Streets and houses are read from this zoom: the most detailed level of the basemap. */
export const GRAPH_Z = 14;
/** Graph tiles kept beyond the ones around you, so walking back and forth over a tile edge is free. */
const SPARE_TILES = 4;
/** Load the next tile once you are this close to its edge (m). */
const EDGE_MARGIN_M = 250;

export interface GraphTile {
  key: string;
  blocks: Block[];
  houses: Building[];
}

export interface TileHooks {
  /** A tile's streets and houses are ready. */
  onTile(t: GraphTile): void;
  /** A tile far behind you was dropped from memory. */
  onDrop(key: string): void;
  /** Whether the tile you are standing in is still missing after a failed download. */
  onWaiting?(waiting: boolean): void;
}

interface Shared {
  promise: Promise<ArrayBuffer>;
  ctrl: AbortController;
  /** Map requests still waiting for it. */
  users: number;
  /** The street graph wants it: never abort. */
  keep: boolean;
}

class Fatal extends Error {}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'));
    }, { once: true });
  });

/** Prefetches started by the boot script in index.html, before any module loaded. */
function takePrefetch(key: string): Promise<ArrayBuffer> | undefined {
  const pre = (globalThis as { __wlPrefetch?: Record<string, Promise<ArrayBuffer>> }).__wlPrefetch;
  const p = pre?.[key];
  if (p) delete pre[key];
  return p;
}

/**
 * The one place tiles are downloaded. The map asks for them through a custom protocol, and the
 * street graph asks for the z14 tiles around you; both share a single download per tile. Each
 * graph tile is parsed in a worker into street blocks and houses.
 */
export class TileSource {
  readonly template = tileTemplate();
  private inflight = new Map<string, Shared>();
  private worker: Worker | null = null;
  private jobs = new Map<number, (r: TileResult) => void>();
  private nextJob = 1;
  private wanted = new Set<string>();
  private loading = new Set<string>();
  /** Loaded graph tiles, least recently wanted first. */
  private loaded: string[] = [];
  private here: string | null = null;
  private lastSig = '';
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private retryMs = 1000;
  private waiting = false;
  readonly stats = { fetched: 0, bytes: 0, parsed: 0, parseMs: 0, failures: 0 };

  constructor(private hooks: TileHooks) {
    if (typeof window !== 'undefined') window.addEventListener('online', () => this.retryNow());
  }

  /** Tile bytes for the map (body of the `wlt://` protocol handler). */
  async load(z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer> {
    const key = `${z}/${x}/${y}`;
    const s = this.shared(z, x, y, false);
    s.users++;
    let counted = true;
    const onAbort = () => {
      counted = false;
      s.users--;
      if (s.users <= 0 && !s.keep) {
        if (this.inflight.get(key) === s) this.inflight.delete(key);
        s.ctrl.abort();
      }
    };
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const buf = await s.promise;
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      // The map transfers what it gets to its worker; the graph may still need the original.
      return buf.slice(0);
    } finally {
      signal?.removeEventListener('abort', onAbort);
      if (counted) s.users--;
    }
  }

  /** Keep the street graph loaded around a position. Cheap to call on every fix. */
  ensureAround(lon: number, lat: number): void {
    const m = metresPerDegree(lat);
    const dLon = EDGE_MARGIN_M / m.lon, dLat = EDGE_MARGIN_M / m.lat;
    const c = lonLatToTile(lon, lat, GRAPH_Z);
    const a = lonLatToTile(lon - dLon, lat + dLat, GRAPH_Z);
    const b = lonLatToTile(lon + dLon, lat - dLat, GRAPH_Z);
    const keys: string[] = [`${GRAPH_Z}/${c.x}/${c.y}`];
    for (let x = a.x; x <= b.x; x++) {
      for (let y = a.y; y <= b.y; y++) {
        const k = `${GRAPH_Z}/${x}/${y}`;
        if (k !== keys[0]) keys.push(k);
      }
    }
    this.here = keys[0];
    const sig = keys.join('|');
    if (sig === this.lastSig) return;
    this.lastSig = sig;
    this.wanted = new Set(keys);
    for (const k of keys) this.loadGraph(k);
    this.evict();
    this.updateWaiting();
  }

  /** Is the street data under this position loaded? */
  hasGraphAt(lon: number, lat: number): boolean {
    const t = lonLatToTile(lon, lat, GRAPH_Z);
    return this.loaded.includes(`${GRAPH_Z}/${t.x}/${t.y}`);
  }

  retryNow(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    for (const k of this.wanted) this.loadGraph(k);
  }

  private shared(z: number, x: number, y: number, keep: boolean): Shared {
    const key = `${z}/${x}/${y}`;
    let s = this.inflight.get(key);
    if (!s) {
      const ctrl = new AbortController();
      const entry: Shared = { promise: Promise.resolve(new ArrayBuffer(0)), ctrl, users: 0, keep: false };
      const pre = takePrefetch(key);
      const load = pre ? pre.catch(() => this.fetchTile(z, x, y, ctrl.signal)) : this.fetchTile(z, x, y, ctrl.signal);
      entry.promise = load.finally(() => {
        if (this.inflight.get(key) === entry) this.inflight.delete(key);
      });
      this.inflight.set(key, entry);
      s = entry;
    }
    if (keep) s.keep = true;
    return s;
  }

  private async fetchTile(z: number, x: number, y: number, signal: AbortSignal): Promise<ArrayBuffer> {
    const url = tileUrl(this.template, z, x, y);
    let wait = 400;
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await fetch(url, { signal, credentials: 'omit' });
        if (res.ok) {
          const buf = await res.arrayBuffer();
          this.stats.fetched++;
          this.stats.bytes += buf.byteLength;
          return buf;
        }
        // An empty tile (open sea) comes back as 200 with no body; 404/204 mean the same.
        if (res.status === 404 || res.status === 204) return new ArrayBuffer(0);
        if (res.status < 500 && res.status !== 429 && res.status !== 408) {
          throw new Fatal(`Tile ${z}/${x}/${y}: HTTP ${res.status}`);
        }
        if (attempt >= 2) throw new Error(`Tile ${z}/${x}/${y}: HTTP ${res.status}`);
      } catch (e) {
        if (signal.aborted || e instanceof Fatal || attempt >= 2) throw e;
      }
      await sleep(wait * (0.75 + Math.random() * 0.5), signal);
      wait *= 3;
    }
  }

  private loadGraph(key: string): void {
    const at = this.loaded.indexOf(key);
    if (at >= 0) {
      // Most recently wanted goes last, so eviction takes the oldest.
      this.loaded.splice(at, 1);
      this.loaded.push(key);
      return;
    }
    if (this.loading.has(key)) return;
    this.loading.add(key);
    const [z, x, y] = key.split('/').map(Number);
    this.shared(z, x, y, true)
      .promise.then((buf) => this.parse(z, x, y, buf))
      .then((res) => {
        this.loading.delete(key);
        if (!res.ok) throw new Error(res.error);
        this.stats.parsed++;
        this.stats.parseMs += res.ms;
        this.loaded.push(key);
        this.retryMs = 1000;
        this.hooks.onTile({ key, blocks: res.blocks, houses: res.houses });
        this.evict();
        this.updateWaiting();
      })
      .catch((e) => {
        this.loading.delete(key);
        this.stats.failures++;
        console.warn('Wanderlight: tile failed', key, e);
        this.updateWaiting(true);
        // Keep trying the tiles around you, backing off to every 30 s (or at once when back online).
        if (!this.retryTimer) {
          this.retryTimer = setTimeout(() => {
            this.retryTimer = null;
            for (const k of this.wanted) this.loadGraph(k);
          }, this.retryMs);
          this.retryMs = Math.min(30_000, this.retryMs * 2);
        }
      });
  }

  private parse(z: number, x: number, y: number, buf: ArrayBuffer): Promise<TileResult> {
    if (!this.worker) {
      const w = new Worker(new URL('./tileWorker.ts', import.meta.url), { type: 'module', name: 'wl-tiles' });
      w.onmessage = (e: MessageEvent<TileResult>) => {
        const done = this.jobs.get(e.data.id);
        this.jobs.delete(e.data.id);
        done?.(e.data);
      };
      w.onerror = (e) => {
        // A crashed worker fails its jobs; the next tile starts a fresh one.
        for (const [id, done] of this.jobs) done({ id, ok: false, error: e.message || 'tile worker crashed' });
        this.jobs.clear();
        w.terminate();
        if (this.worker === w) this.worker = null;
      };
      this.worker = w;
    }
    const id = this.nextJob++;
    const job: TileJob = { id, z, x, y, buf };
    return new Promise((resolve) => {
      this.jobs.set(id, resolve);
      // No transfer list: the map may still be reading the same bytes.
      this.worker!.postMessage(job);
    });
  }

  private evict(): void {
    let spare = this.loaded.filter((k) => !this.wanted.has(k)).length;
    for (let i = 0; i < this.loaded.length && spare > SPARE_TILES; ) {
      const k = this.loaded[i];
      if (this.wanted.has(k)) {
        i++;
        continue;
      }
      this.loaded.splice(i, 1);
      spare--;
      this.hooks.onDrop(k);
    }
  }

  private updateWaiting(failed = false): void {
    const missing = !!this.here && !this.loaded.includes(this.here);
    const waiting = missing && (failed || this.waiting);
    if (waiting === this.waiting) return;
    this.waiting = waiting;
    this.hooks.onWaiting?.(waiting);
  }
}
