# Wanderlight

Your city starts in fog. Every street you walk lights up, with its houses and its name, for good.

Wanderlight is a small walking motivator. Open it and you get one start screen: what it is, your
streets so far, and **Start the walk**. After that it is just the map: you, a beam of light ahead
of you, and the fog. Walk along a street and the whole block lights up in a wave, its houses switch
their windows on one by one, and its name is written in gold. Tap the map for the time, the
distance and an estimate of your steps (distance ÷ 0.75 m, since browsers can't read the phone's
step counter), and to end the walk; the summary shows the same three numbers and the streets you
lit.

Only real walking counts: there is no tap-to-explore. Fixes that are too inaccurate, glitchy jumps
and anything faster than a brisk walk (bike, tram, car) are ignored.

All your data stays on the device (IndexedDB). There is no account and no server.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests for the pure logic (GPS filter, walked-along rule, blocks…)
npm run build      # type-check + production build into dist/
```

To try it without walking, open **http://localhost:5173/?sim** (or **`?sim=fast`** for 10×
speed). This hidden demo walks a scripted route through the Jordaan in Amsterdam and keeps its own
records, apart from your real walks. It never shows up in the normal app.

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

- **Fast on a phone network:** `index.html` carries the start screen and its CSS inline, so it
  paints in the first round trip, before any script. A tiny boot script starts downloading the map
  tile you were last in and MapLibre's worker right away, alongside the app, and a tap on Start
  asks for your location even before the app has loaded. The app (MapLibre is most of it, ~320 KB
  gzipped) loads behind the start screen, and the service worker keeps it for the next start. No
  web fonts: names use the phone's own serif.
- **One download per tile:** the [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles
  schema, z14) that draw the map are also parsed, in a worker, into the walkable street graph and
  the house footprints. MapLibre gets each tile through a custom protocol from the same download.
  No Overpass, so no rate limits or queues. Each walkable way is cut into ~20 m pieces; pieces
  between two junctions form a **block** (capped at 160 m), the unit that unlocks. Footways are
  judged along their length: a stretch running beside a road is that road's sidewalk and the
  rest of the path stays; crossings and piers never light on their own.
- **Walked along it:** a good GPS step only lights the street it is actually following. Both ends
  of the step must be within 20 m of the street, the step must run alongside it rather than across
  it, and only the nearest parallel street is considered, so walking past a side street does not
  light it. Good GPS fixes (≤ 35 m accuracy, no impossible jumps, not faster than walking) are
  joined into segments first.
- **Whole-block unlocks:** walked stretches accumulate along each block without double-counting
  backtracks. Once about half a block (and at least 8 m) has been walked, the whole block lights at
  once, and the houses within 20 m of it light their windows. Each piece keeps a visit count (once
  per walk) for future heat colouring. If streets load late (offline), the walk's track is kept and
  replayed once they arrive. Streets lit before a map update are matched again by their shape.
- **Smooth walker:** GPS fixes go through a small Kalman filter, and the walker glides between
  them on a damped spring, so it never hops; the camera follows it every frame. Drawing runs at
  60 fps while something moves fast, 30 fps at walking pace and 15 fps standing still.
- **The fog** is drawn on the GPU as one MapLibre custom layer. A half-resolution light mask holds
  the lit streets, the unlock waves, the pool of light around you and your beam; it is composited
  as night fog with slow mist, a thin warm rim, lamplight along lit streets with a gold line down
  the middle, and lit houses whose windows come on one by one. Every street shows faintly through
  the fog, so you can see where you could go.

Code map: `src/core` (pure logic: GPS filter, motion, walked-along rule, blocks, progress, walk
stats), `src/geo` (geometry, pieces, spatial index), `src/data` (tile decoder and parser, tile
source, street graph), `src/platform` (location, wake lock, storage, demo walk), `src/map` (style,
GPU fog, walker, follow camera, gold names), `src/ui` (start screen, walk stats, notices),
`src/app` (the controller). `scripts/make-icons.mjs` draws the app icons.

Map data © OpenStreetMap contributors · Tiles: OpenFreeMap / OpenMapTiles.
