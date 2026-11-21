# 0007 - The first paint comes from index.html alone

Status: accepted

## Context

Wanderlight opens on a phone network, at the start of a walk.
The app bundle is mostly MapLibre, about 300 KB gzipped, and nothing it draws can show before it has downloaded and run.
A browser asks for location only inside a user gesture, so a tap on Start before the app has loaded must not be lost.
A web font, an icon sprite or a glyph download would each be one more download before text and icons show.

## Decision

- `index.html` holds the start screen, its CSS, the logo as inline SVG and the few rules of MapLibre's stylesheet that the map needs.
  The rest of that stylesheet is never loaded.
- A boot script in the head runs before the first paint:
  - it reads `wl-pos`, `wl-walking` and `wl-tiles` from `localStorage` and picks the screen to show;
  - it starts downloading the z14 tile you were last in, and any neighbour within 250 m, into `window.__wlPrefetch`, which `TileSource` takes over (ADR 0003);
  - it fetches the MapLibre worker, so that it downloads alongside the bundle and loads from the HTTP cache later.
- A `preconnect` link opens the connection to the tile host.
- A second inline script shows the lifetime numbers from `wl-stats`.
  On a Start tap before the app is up, it asks for compass access and, in the browser, for a first position in that same tap, and leaves the answers on `window.__wl` for the app.
- `bootValuesInHtml` in `vite.config.ts` writes the tile URL from `src/data/tileUrl.ts` and the hashed name of the MapLibre worker into `index.html`.
  It fails the build when it cannot find either.
- The app is one chunk (`chunkSizeWarningLimit` 1300), and `src/map/mapView.ts` calls `prewarm()`, so MapLibre's workers start behind the start screen.
- There are no web fonts, no glyphs and no sprite.
  Text uses system font stacks (`ui-serif`, `system-ui`), and `mapView.ts` draws the landmark dot on a canvas.
- `vite-plugin-pwa` precaches the JS, HTML and SVG files.
  `src/main.ts` registers the service worker 3 s after the page loads, so it never competes with the first tiles, and lets a new version take over only while no walk is on.

## Consequences

- The start screen paints in the first round trip, and the first tile can be there before the app is.
- The next start comes from the service worker, and a walk goes on offline.
- `index.html` repeats logic from `src/data/tileUrl.ts` and `src/data/tiles.ts` (the tile URL check, the z14 tile maths, the 250 m edge), and its CSS repeats the palette of `src/theme.ts`.
  Comments ask to keep them in step, and nothing checks it except the build check for the tile URL.
- Nothing may delay the start screen behind a script, a stylesheet or a font.
  No check measures the first paint.
- `npm run build` runs in `.github/workflows/pages.yml`, and in `.github/workflows/ios.yml` through `npm run ios:sync`, so a missing boot value fails CI.
