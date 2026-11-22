import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';

/**
 * The boot script in index.html runs before any JavaScript file has loaded, so what it needs is
 * written into it here:
 * - %WL_TILES%: the tile URL, read from src/data/tileUrl.ts (the one place it lives), so the first
 *   tile download starts at once;
 * - %WL_WORKER%: the built MapLibre worker. MapLibre asks for it only once the app bundle has run;
 *   fetched at boot, it downloads alongside the bundle instead, and the worker then loads from the
 *   HTTP cache. Empty in dev.
 */
function bootValuesInHtml(): Plugin {
  const src = readFileSync(new URL('./src/data/tileUrl.ts', import.meta.url), 'utf8');
  const tiles = /export const DEFAULT_TILES = '([^']+)'/.exec(src)?.[1];
  if (!tiles) throw new Error('DEFAULT_TILES not found in src/data/tileUrl.ts');
  let base = '/';
  return {
    name: 'boot-values',
    configResolved(config) {
      base = config.base;
    },
    transformIndexHtml: {
      // After the bundle is written, so the worker's hashed file name is known.
      order: 'post',
      handler(html, ctx) {
        const worker = Object.keys(ctx.bundle ?? {}).find((f) => /maplibre-gl-worker[^/]*\.m?js$/.test(f));
        if (ctx.bundle && !worker) throw new Error('MapLibre worker not found in the bundle');
        return html.replace('%WL_TILES%', tiles).replace('%WL_WORKER%', worker ? base + worker : '');
      },
    },
  };
}

// BASE_PATH is "/walking-game/" on GitHub Pages, "/" everywhere else.
export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [bootValuesInHtml()],
  // MapLibre is most of the app (~340 KB gzipped); one chunk loads in one round trip.
  build: { chunkSizeWarningLimit: 1300, target: 'es2022' },
  // .context/ holds design prototypes; edits there must not reload the app.
  server: { host: true, watch: { ignored: ['**/.context/**', '**/.malini/**'] } },
  preview: { host: true },
});
