# Wanderlight

Your city starts dark. Every street you actually walk lights up, for good.

Wanderlight is a small walking motivator: a night map of your city under fog. Start a walk and
your phone's GPS cuts a glowing path through the fog along the streets you pass. Streets stay lit
forever, new streets get a little "New street" toast, and walks earn stamps (First Light, 10/50/100
streets, 5 km lit, Night Owl, Early Bird, 3- and 7-day streaks, a park walk). The **You** tab
shows streets met, km lit, walks, your streak, this week's distance and the nearest streets you
haven't walked yet.

Only real walking counts: there is no tap-to-explore. Fixes that are too inaccurate, glitchy jumps
and anything faster than a brisk walk (bike, tram, car) are ignored.

All your data stays on the device (IndexedDB). There is no account and no server.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the pure logic (GPS filter, lighting, stats, stamps…)
npm run build      # type-check + production build into dist/
```

To try it without walking, open **http://localhost:5173/?sim** (or **`?sim=fast`** for 10×
speed). This hidden test mode walks a scripted route through the Jordaan in Amsterdam. It never
shows up in the normal app.

## Get it on your phone

**From GitHub Pages:** every push to `main` builds and deploys the app (see
`.github/workflows/pages.yml`). In the repository's *Settings → Pages*, set *Source* to
**GitHub Actions** once. Then, on your phone:

1. Open **https://annvaskovska.github.io/walking-game/**
2. Allow location when you start your first walk.
3. Add it to your home screen: in Safari, tap *Share → Add to Home Screen*; in Chrome on Android,
   tap *⋮ → Add to Home screen / Install app*.

**From your laptop on the same Wi-Fi:**

```sh
npm run phone
```

This builds the app and serves it over HTTPS with a self-signed certificate (geolocation needs
HTTPS). Open the `https://<your-laptop-ip>:4173/` address it prints on your phone and accept the
certificate warning.

## The honest limitation

A web app can only track you **while it is open with the screen on**. Wanderlight keeps the
screen awake during a walk (Wake Lock API) and re-acquires it when you come back to the app, but
if you lock your phone or switch apps, the browser stops sending GPS and that stretch of the walk
is not lit. (On iPhone, keeping the screen awake needs iOS 16.4 or later and is most reliable in
recent versions.)

The next step is wrapping the app with **Capacitor** to get native background location. The
platform calls (geolocation, wake lock, storage) already live behind small modules in
`src/platform/` so they can be swapped for Capacitor plugins without touching the rest.

## How it works

- **Streets** come from OpenStreetMap through the Overpass API, one z15 map cell at a time, and are
  cached in IndexedDB. Each walkable way is cut into ~20 m pieces (`wayId:index`); a street is all
  pieces sharing a name, and unnamed ways count as paths.
- **Lighting:** good GPS fixes (≤ 35 m accuracy, no impossible jumps, not faster than walking) are
  joined into segments, and every piece within `clamp(accuracy × 0.8, 12, 25)` m of a segment
  lights up. Each piece keeps a visit count (once per walk) for future heat colouring. If streets
  load late (offline, Overpass busy), the walk's track is kept and lit once they arrive.
- **Map:** the OpenFreeMap basemap, with the style built in code from `src/theme.ts`. The fog is a
  canvas overlay with soft corridors cut out along lit streets; lit streets glow as a MapLibre
  layer.

Code map: `src/core` (pure logic: GPS filter, lighting, progress, stats, stamps), `src/geo`
(geometry, pieces, spatial index), `src/data` (Overpass, street loader), `src/platform`
(location, wake lock, storage, sim), `src/map` (style, fog, marker), `src/ui` (shell, screens),
`src/app` (the controller).

Map data © OpenStreetMap contributors · Tiles: OpenFreeMap / OpenMapTiles.
