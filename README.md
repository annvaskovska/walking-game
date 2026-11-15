# Wanderlight

Your city starts dark. Every street you actually walk lights up, for good.

Wanderlight is a small walking motivator: a dark map of your city under fog. Start a walk and
your phone's GPS cuts a lit path through the fog along the streets you pass. Streets stay lit
forever. While you walk, the app shows the time, the distance and an estimate of your steps
(distance ÷ 0.75 m, since browsers can't read the phone's step counter); the same three numbers
make up the summary when you end the walk.

This is the bare-bones version: one screen, a plain neutral look, no achievements yet. A designed
skin and stamps come once a design direction is chosen.

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
  cached in IndexedDB. Each walkable way is cut into ~20 m pieces (`wayId:index`). Pieces between
  two junctions form a **block** (capped at 160 m) — the unit that unlocks. Unnamed ways count as
  paths and light up in their own right.
- **Walked along it:** a good GPS step only lights the street it is actually following. Both ends
  of the step must be within 20 m of the street, the step must run alongside it rather than across
  it, and only the nearest parallel street is considered, so walking past a side street does not
  light it. Tagged sidewalks and crossings never light on their own, and an untagged footway right
  beside a road you are following is treated as that road's sidewalk. Good GPS fixes (≤ 35 m
  accuracy, no impossible jumps, not faster than walking) are joined into segments first.
- **Whole-block unlocks:** walked stretches accumulate along each block without double-counting
  backtracks. Once about half a block (and at least 8 m) has been walked, the whole block lights at
  once. Each piece keeps a visit count (once per walk) for future heat colouring. If streets load
  late (offline, Overpass busy), the walk's track is kept and replayed once they arrive.
- **Houses:** building footprints are loaded from OpenStreetMap too, per z16 cell around the walk,
  and cached in IndexedDB. When a block unlocks, the buildings within 30 m of it light up with a
  gold fill and lit windows. Houses, like streets, stay lit for good.
- **Map:** the OpenFreeMap basemap, with the style built in code from `src/theme.ts`. Newly lit
  streets flash cream and settle to gold, with their names written in gold above the fog; the
  basemap's own labels are hidden for unlocked streets. The fog is a canvas overlay with soft
  corridors cut out along lit streets and around lit houses.

Code map: `src/core` (pure logic: GPS filter, walked-along rule, blocks, progress, walk stats),
`src/geo` (geometry, pieces, spatial index), `src/data` (Overpass, street and building loaders),
`src/platform` (location, wake lock, storage, sim), `src/map` (style, fog, marker), `src/ui` (shell,
walk dock, summary), `src/app` (the controller).

Map data © OpenStreetMap contributors · Tiles: OpenFreeMap / OpenMapTiles.
