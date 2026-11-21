/**
 * Device storage. Everything stays on the phone in IndexedDB; this module is the only place that
 * touches it, so a native store (e.g. under Capacitor) can replace it later.
 */

/**
 * - `lit`, `houses`: streets and houses you walked (gold);
 * - `seen`: the seen memory, one z17 raster tile per record (`{ key, data: Uint8Array }`);
 * - `seenHouses`, `places`: houses and landmarks you have seen (moonlit, labelled);
 * - `walks`, `meta`: walk records and the walk in progress.
 */
export type StoreName = 'lit' | 'walks' | 'houses' | 'seen' | 'seenHouses' | 'places' | 'meta';

export interface Storage {
  get<T>(store: StoreName, key: string): Promise<T | undefined>;
  getAll<T>(store: StoreName): Promise<T[]>;
  getAllKeys(store: StoreName): Promise<string[]>;
  /** For stores with a key path ('lit', 'walks', 'houses'). */
  putMany(store: StoreName, values: unknown[]): Promise<void>;
  /** For the key/value 'meta' store. */
  set(key: string, value: unknown): Promise<void>;
  delete(store: StoreName, key: string): Promise<void>;
  readonly kind: 'indexeddb' | 'memory';
}

const DB_NAME = 'wanderlight';
/**
 * v2 added lit houses and cached building cells. v3 reads streets and houses from the map tiles
 * (which the service worker caches), so the street and building caches of v1-v2 are dropped.
 * v4 adds what you have seen: the seen memory, seen houses and landmarks.
 */
const DB_VERSION = 4;
const KEYED: Record<Exclude<StoreName, 'meta'>, string> = {
  lit: 'id',
  walks: 'id',
  houses: 'id',
  seen: 'key',
  seenHouses: 'id',
  places: 'id',
};
const DROPPED = ['cells', 'bldCells'];

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
  });
}

class IdbStorage implements Storage {
  readonly kind = 'indexeddb' as const;
  constructor(private db: IDBDatabase) {}

  async get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return req(this.db.transaction(store).objectStore(store).get(key)) as Promise<T | undefined>;
  }
  async getAll<T>(store: StoreName): Promise<T[]> {
    return req(this.db.transaction(store).objectStore(store).getAll()) as Promise<T[]>;
  }
  async getAllKeys(store: StoreName): Promise<string[]> {
    return (await req(this.db.transaction(store).objectStore(store).getAllKeys())) as string[];
  }
  async putMany(store: StoreName, values: unknown[]): Promise<void> {
    if (!values.length) return;
    const tx = this.db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const v of values) os.put(v);
    await done(tx);
  }
  async set(key: string, value: unknown): Promise<void> {
    const tx = this.db.transaction('meta', 'readwrite');
    tx.objectStore('meta').put(value, key);
    await done(tx);
  }
  async delete(store: StoreName, key: string): Promise<void> {
    const tx = this.db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await done(tx);
  }
}

/** Fallback when IndexedDB is unavailable (some private modes): works, but forgets on reload. */
export class MemoryStorage implements Storage {
  readonly kind = 'memory' as const;
  private data = new Map<StoreName, Map<string, unknown>>();
  private m(store: StoreName) {
    let s = this.data.get(store);
    if (!s) this.data.set(store, (s = new Map()));
    return s;
  }
  async get<T>(store: StoreName, key: string) {
    return structuredClone(this.m(store).get(key)) as T | undefined;
  }
  async getAll<T>(store: StoreName) {
    return [...this.m(store).values()].map((v) => structuredClone(v)) as T[];
  }
  async getAllKeys(store: StoreName) {
    return [...this.m(store).keys()];
  }
  async putMany(store: StoreName, values: unknown[]) {
    const kp = KEYED[store as Exclude<StoreName, 'meta'>];
    for (const v of values) this.m(store).set((v as Record<string, string>)[kp], structuredClone(v));
  }
  async set(key: string, value: unknown) {
    this.m('meta').set(key, structuredClone(value));
  }
  async delete(store: StoreName, key: string) {
    this.m(store).delete(key);
  }
}

/** `name` keeps the demo walk's records apart from your real ones. */
export async function openStorage(name = DB_NAME): Promise<Storage> {
  if (typeof indexedDB === 'undefined') return new MemoryStorage();
  try {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const r = indexedDB.open(name, DB_VERSION);
      r.onupgradeneeded = () => {
        const db = r.result;
        for (const [name, keyPath] of Object.entries(KEYED)) {
          if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
        }
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
        for (const name of DROPPED) if (db.objectStoreNames.contains(name)) db.deleteObjectStore(name);
      };
      r.onsuccess = () => {
        const db = r.result;
        // A newer version opened in another tab: let it upgrade (this tab saves no more).
        db.onversionchange = () => db.close();
        resolve(db);
      };
      r.onerror = () => reject(r.error);
      // An older tab still has it open: it usually lets go in a moment; else start without it.
      r.onblocked = () => setTimeout(() => reject(new Error('IndexedDB blocked')), 3000);
    });
    return new IdbStorage(db);
  } catch (e) {
    console.warn('IndexedDB unavailable, progress will not be saved', e);
    return new MemoryStorage();
  }
}

/**
 * Ask the browser not to evict what you lit under storage pressure ("lit forever"). Called once
 * there is something worth keeping: Firefox asks you about it, so not at the first start.
 */
export function persistStorage(): void {
  navigator.storage?.persisted?.()
    .then((done) => (done ? undefined : navigator.storage.persist()))
    .catch(() => {});
}
