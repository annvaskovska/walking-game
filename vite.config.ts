import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import basicSsl from '@vitejs/plugin-basic-ssl';

// BASE_PATH is "/walking-game/" on GitHub Pages, "/" everywhere else.
// `--mode phone` (npm run phone) serves over self-signed HTTPS so geolocation works on a phone.
export default defineConfig(({ mode }) => ({
  base: process.env.BASE_PATH || '/',
  plugins: [
    mode === 'phone' ? basicSsl() : null,
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Wanderlight',
        short_name: 'Wanderlight',
        description: 'Light up your city one street at a time.',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0e0e10',
        theme_color: '#0e0e10',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,mjs,css,html,woff2,png,svg}'],
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
  // MapLibre alone is ~1 MB; it is precached by the service worker, so one big chunk is fine.
  build: { chunkSizeWarningLimit: 1600 },
  // .context/ holds design prototypes; edits there must not reload the app.
  server: { host: true, watch: { ignored: ['**/.context/**', '**/.malini/**'] } },
  preview: { host: true },
}));
