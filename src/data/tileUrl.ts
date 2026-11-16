/**
 * Where the basemap tiles come from: OpenFreeMap's planet build (OpenMapTiles schema, free, no
 * key). Dated builds are immutable and cached for years, so this exact URL is also baked into
 * index.html, whose boot script starts downloading the first tile before any JavaScript loads.
 * A newer build is read from the TileJSON in the background and used from the next start on.
 * No imports: vite.config.ts reads this file too.
 */
export const DEFAULT_TILES = 'https://tiles.openfreemap.org/planet/20261101_080013_pt/{z}/{x}/{y}.pbf';
export const TILEJSON_URL = 'https://tiles.openfreemap.org/planet';
/** localStorage keys shared with the boot script in index.html. */
export const TILES_KEY = 'wl-tiles';
export const POS_KEY = 'wl-pos';
export const STATS_KEY = 'wl-stats';
export const WALKING_KEY = 'wl-walking';

const VALID = /^https:\/\/tiles\.openfreemap\.org\/[\w./-]+\/\{z\}\/\{x\}\/\{y\}\.pbf$/;

export function tileTemplate(): string {
  try {
    const t = localStorage.getItem(TILES_KEY);
    if (t && VALID.test(t)) return t;
  } catch {
    /* storage blocked */
  }
  return DEFAULT_TILES;
}

/** Remember the newest tile build for the next start, so one session never mixes two builds. */
export async function refreshTemplate(): Promise<void> {
  try {
    const res = await fetch(TILEJSON_URL, { credentials: 'omit' });
    if (!res.ok) return;
    const t = ((await res.json()) as { tiles?: string[] }).tiles?.[0];
    if (t && VALID.test(t)) localStorage.setItem(TILES_KEY, t);
  } catch {
    /* offline: keep the build we know */
  }
}

export function tileUrl(template: string, z: number, x: number, y: number): string {
  return template.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
}
