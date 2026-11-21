import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

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
    name: 'wanderlight-boot-values',
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
// `--mode phone` (npm run phone) serves over self-signed HTTPS so geolocation works on a phone.
export default defineConfig(({ mode }) => ({
  base: process.env.BASE_PATH || '/',
  plugins: [
    mode === 'phone' ? basicSsl() : null,
    bootValuesInHtml(),
    VitePWA({
      // main.ts decides when a new version takes over: never in the middle of a walk.
      registerType: 'prompt',
      // Install icons are fetched by the browser when it needs them; the precache keeps the app.
      includeManifestIcons: false,
      manifest: {
        name: 'Wanderlight',
        short_name: 'Wanderlight',
        description: 'Your city starts in fog. Every street you walk lights up, with its houses and its name.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0b0d12',
        theme_color: '#0b0d12',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,html,svg}'],
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
        runtimeCaching: [
          {
            // Map tiles are versioned URLs: once fetched, keep them.
            urlPattern: ({ url }) => url.origin === 'https://tiles.openfreemap.org' && url.pathname.endsWith('.pbf'),
            handler: 'CacheFirst',
            options: {
              cacheName: 'map-tiles',
              expiration: { maxEntries: 4000, maxAgeSeconds: 60 * 60 * 24 * 30 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // TileJSON points at the current tile version: prefer fresh, fall back offline.
            urlPattern: ({ url }) => url.origin === 'https://tiles.openfreemap.org',
            handler: 'NetworkFirst',
            options: {
              cacheName: 'map-meta',
              networkTimeoutSeconds: 4,
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
  ],
  // MapLibre is most of the app (~300 KB gzipped); one chunk loads in one round trip, and the
  // service worker keeps it for the next start.
  build: { chunkSizeWarningLimit: 1300, target: 'es2022' },
  // .context/ holds design prototypes; edits there must not reload the app.
  server: { host: true, watch: { ignored: ['**/.context/**', '**/.malini/**'] } },
  preview: { host: true },
}));
