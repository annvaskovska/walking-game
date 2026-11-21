# Wanderlight

Your city starts in fog. Every street you walk lights up, with its houses and its name, for good.

Wanderlight is a small walking motivator. Open it and you get one start screen: what it is, your
streets so far, and **Start walking**. After that it is just the map: you, a beam of light ahead
of you, and the fog. Walk along a street and the whole block lights up in a wave, its houses switch
their windows on one by one, and its name is written in gold. Your light stops at walls and
spills between houses; whatever it has touched (a square at the end of the street, a shop on the
corner) stays **moonlit**: blue roofs, a faint name, the landmark's label. Turn the phone to look
around: the beam follows the compass. Tap the map for the time, the
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
records, apart from your real walks. It never shows up in the normal app. Add **`&walk=damrak`**
for a loop round Damrak in Amsterdam instead. In the demo, `__wanderlight.look(90)` in the console
turns the beam east as a compass would (`look(null)`: back to the way you walk).

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

## The iPhone app: walk with the screen locked

The web app can only track you **while it is open with the screen on**. It keeps the screen awake
during a walk (Wake Lock API), but if you lock your phone or switch apps, the browser stops sending
GPS and that stretch of the walk is not lit.

The iPhone app has no such gap. It is the same web app (same start screen, map, fog and
gestures) in a native [Capacitor](https://capacitorjs.com) shell, with native GPS that keeps
recording in the background. Lock the phone, put it in your pocket, and when you look again the
streets you walked light up at once.

**Run it on your iPhone** (needs a Mac with Xcode, free Apple ID is enough):

```sh
npm install
npm run ios        # builds the web app, copies it into ios/, opens Xcode
```

The first time:

1. In Xcode, *Settings → Apple Accounts → +*, sign in with your Apple ID.
2. Select the **App** target → *Signing & Capabilities* → pick your **Team** (your Apple ID).
3. Plug in your iPhone, unlock it and tap *Trust*. Choose it in the device menu at the top and
   press **Run**. iPhone asks for **Developer Mode**: *Settings → Privacy & Security → Developer
   Mode → On*, restart, and press Run again.
4. With a free Apple ID, iPhone refuses to open the app the first time: *Settings → General → VPN &
   Device Management → Apple Development → Trust*, then open Wanderlight.

On the first walk, allow location **While Using the App** and keep *Precise Location* on. During a walk iOS shows a blue
location pill in the status bar; that is the walk being recorded. (An app signed with a free
Apple ID stops opening after 7 days; press Run again. Your streets stay on the phone.)

After changing the web code, run `npm run ios:sync` (build + copy) before running from Xcode
again. CI builds the iOS app on every pull request (`.github/workflows/ios.yml`).

How the lock screen works: `ios/App/App/WalkTracker.swift` runs `CLLocationManager` with the
background *location* mode, so iOS keeps delivering fixes while the screen is locked. It writes
every fix of the walk, numbered, to a small journal file on the phone. While the web view runs it
gets each fix live; when it missed some (screen locked, web view paused or reloaded by iOS, app
killed) it reads them back from where it left off, in order, so the walk lights exactly as if it
had seen them live (`src/platform/nativeLocation.ts`). The app asks only for *While Using*
permission: a walk you started counts as using the app.

## How it works

- **Fast on a phone network:** `index.html` carries the start screen and its CSS inline, so it
  paints in the first round trip, before any script. A tiny boot script starts downloading the map
  tile you were last in and MapLibre's worker right away, alongside the app, and a tap on Start
  asks for your location even before the app has loaded. The app (MapLibre is most of it, ~320 KB
  gzipped) loads behind the start screen, and the service worker keeps it for the next start. The
  type ships with the app: Instrument Serif and Instrument Sans (OFL, `public/fonts/`, ~60 KB for
  the start screen, preloaded; accented letters such as ő load from small extra files only when a
  name needs them). The map's labels draw with the same files.
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
  light it. The search reaches as far as the GPS accuracy, and never less than 15 m: a sidewalk
  plus the error a phone has between tall houses. Good GPS fixes (≤ 35 m accuracy, no impossible jumps, not faster than walking) are
  joined into segments first.
- **What you walk lights:** walked stretches accumulate along each block without double-counting
  backtracks, measured along the whole block so no step is lost where two pieces meet. Each ~20 m
  piece lights as soon as 40% of it (at least 6 m) is walked, so a street you walk only part of
  still shows where you went.
- **Whole-block unlocks:** once about half a block (and at least 8 m) has been walked, the rest of
  the block lights too. Houses within 20 m of anything lit light their windows. Each piece keeps a visit count (once
  per walk) for future heat colouring. If streets load late (offline), the walk's track is kept and
  replayed once they arrive. Streets lit before a map update are matched again by their shape.
- **Smooth walker:** GPS fixes go through a small Kalman filter, and the walker glides between
  them on a damped spring, so it never hops; the camera follows it every frame. Standing still,
  the walker (and so the camera) holds still until GPS noise puts its target more than a pixel
  away. Drawing runs at 60 fps while something moves fast, 30 fps at walking pace and 15 fps
  standing still, when the fog also reuses its light and seen masks while nothing in them changed.
- **The fog** is drawn on the GPU as one MapLibre custom layer. A half-resolution light mask holds
  the lit streets, the unlock waves, the pool of light around you and your beam; it is composited
  as night fog with slow mist, a thin warm rim, lamplight along lit streets with a gold line down
  the middle, and lit houses whose windows come on one by one. Every street shows faintly through
  the fog, so you can see where you could go.
- **Line of sight:** the walls of the houses within ~140 m are gathered around you (re-gathered
  only after you moved 25 m). On the GPU, every wall facing your light casts an instanced shadow
  wedge into the lantern channels of the mask, hard where two walls meet and soft at the corners
  you see round, so the light falls between houses and down side streets, not through them. If GPS
  puts you inside a house, the light steps out to the street first.
- **What you have seen** is kept apart from what you walked: a few times a second an angular sweep
  on the CPU computes what your light reaches (disc around you, cone ahead) and paints it into a
  persistent raster (zoom-17 tiles, ~0.7 m a texel, in IndexedDB). The fog reads it back as
  moonlight: thinner fog, a cold tint. Houses the light reached get dim blue roofs with a moonlit
  outline, walls facing your lantern glow warm, street names show faintly under the fog, and
  landmarks (shops, cafés, churches from the tiles' `poi` layer) visible from where you stood get
  their name. Walked still means gold; seen never lights a street.
- **Look around:** the beam follows the compass (`deviceorientation`; on iPhone the Start tap asks
  for motion access) while you stand or turn the phone, and the way you walk while you walk.
  Stretches recorded with the screen locked are looked at the way you walked them.

Code map: `src/core` (pure logic: GPS filter, motion, walked-along rule, blocks, progress, walk
stats, walls and line of sight, seen memory, heading), `src/geo` (geometry, pieces, spatial index), `src/data` (tile decoder and parser, tile
source, street graph), `src/platform` (location in the browser and in the iPhone app, wake lock,
storage, compass, demo walk), `src/map` (style, GPU fog, shadows, seen memory, walker, follow
camera, gold names), `src/ui`
(start screen, walk stats, notices), `src/app` (the controller), `ios/` (the iPhone app: Xcode
project, native GPS plugin). `scripts/make-icons.mjs` draws the app icons, the iPhone one too.

Map data © OpenStreetMap contributors · Tiles: OpenFreeMap / OpenMapTiles.
