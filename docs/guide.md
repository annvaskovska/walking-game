# Mr Sparkles guide

## Try it without walking

Open **http://localhost:5173/?sim**, or **`?sim=fast`** for 10× speed.
This hidden demo walks a scripted route through the Jordaan in Amsterdam and keeps its own records, apart from your real walks.
It never shows up in the normal app.
In the demo, `__sparkles.look(90)` in the console turns the beam east as a compass would, and `look(null)` turns it back to the way you walk.

## Get it on your phone

### From GitHub Pages

Every push to `main` builds and deploys the app (`.github/workflows/pages.yml`).
In the repository's *Settings → Pages*, set *Source* to **GitHub Actions** once.
Then, on your phone:

1. Open **https://annvaskovska.github.io/walking-game/**.
2. Allow location when you start your first walk.
3. Add it to your home screen: in Safari, tap *Share → Add to Home Screen*; in Chrome on Android, tap *⋮ → Add to Home screen / Install app*.

### From your laptop on the same Wi-Fi

```sh
npm run phone
```

This builds the app and serves it over HTTPS with a self-signed certificate, since geolocation needs HTTPS.
Open the `https://<your-laptop-ip>:4173/` address it prints on your phone and accept the certificate warning.

## The iPhone app

The web app can only track you while it is open with the screen on.
It keeps the screen awake during a walk (Wake Lock API), but when you lock your phone or switch apps, the browser stops sending GPS and that stretch of the walk is not lit.

The iPhone app has no such gap.
It is the same web app (same start screen, map, fog and gestures) in a native [Capacitor](https://capacitorjs.com) shell, with native GPS that keeps recording in the background.
Lock the phone, put it in your pocket, and when you look again the streets you walked light up at once.

### Run it from Xcode

You need a Mac with Xcode, and a free Apple Account is enough.

```sh
npm install
npm run ios        # builds the web app, copies it into ios/, opens Xcode
```

The first time:

1. In Xcode, *Settings → Apple Accounts → +*, sign in with your Apple Account.
2. Select the **App** target → *Signing & Capabilities* → pick your **Team**.
3. Plug in your iPhone, unlock it and tap *Trust*.
   Choose it in the device menu at the top and press **Run**.
   iPhone asks for **Developer Mode**: *Settings → Privacy & Security → Developer Mode → On*, restart, and press Run again.
4. With a free Apple Account, iPhone refuses to open the app the first time: *Settings → General → VPN & Device Management → Apple Development → Trust*, then open Mr Sparkles.

Picking your team changes `DEVELOPMENT_TEAM` in `ios/App/App.xcodeproj`; leave that change out of your commits (ADR 0010).
The hooks that `npm install` sets up run `scripts/check-public.sh`, which stops a commit and a push that hold it.
List your own private words, such as your name, city and street, one per line in `~/.config/check-public-words`: the same check then stops them too (ADR 0012).

On the first walk, allow location **While Using the App** and keep *Precise Location* on.
During a walk iOS shows a blue location pill in the status bar: that is the walk being recorded.
An app signed with a free Apple Account stops opening after 7 days; press Run again, and your streets stay on the phone.

After changing the web code, run `npm run ios:sync` (build and copy) before running from Xcode again.
CI builds the iPhone app on every pull request (`.github/workflows/ios.yml`).

### Upload to TestFlight

This needs a paid Apple Developer Program membership (ADR 0009).
The first time, on the web:

1. On developer.apple.com, in *Certificates, Identifiers & Profiles → Identifiers → +*, register an App ID with the bundle ID from `capacitor.config.ts`.
2. In App Store Connect, *Apps → + → New App*: iOS, the name Mr Sparkles, that bundle ID, and any SKU.
   If it says the paid application agreement is outdated, the account holder accepts the new version in *Business → Agreements* first, also for a free app.
3. In App Store Connect, *Users and Access → Integrations → App Store Connect API → Team Keys → +*, make a key with **Admin** access and download its `.p8` file once.

Then set four values in the environment and run the upload:

| Variable | Where it is |
| --- | --- |
| `ASC_TEAM_ID` | developer.apple.com, *Membership details* |
| `ASC_KEY_ID` | the key's row in *Team Keys* |
| `ASC_ISSUER_ID` | above the list of *Team Keys* |
| `ASC_KEY` | the text of the `.p8` file |

```sh
npm run ios:testflight
```

Keep the four values in a secret store, never in this repository or in a file inside it (ADR 0010).
`scripts/testflight.sh` runs the tests, builds the app, signs it and uploads it.
Xcode makes the certificate and the profile from the key, and gives each upload the next build number.
The first time, in *TestFlight*, create an internal group with automatic distribution and add yourself.
Once App Store Connect has processed a build, it shows in the TestFlight app on your iPhone.

### How the lock screen works

`ios/App/App/WalkTracker.swift` runs `CLLocationManager` with the background *location* mode, so iOS keeps delivering fixes while the screen is locked.
It writes every fix of the walk, numbered, to a small journal file on the phone.
While the web view runs, it gets each fix live.
When it missed some (screen locked, web view paused or reloaded by iOS, app killed), it reads them back from where it left off, in order, so the walk lights exactly as if it had seen them live (`src/platform/nativeLocation.ts`).
The app asks only for *While Using* permission: a walk you started counts as using the app.

## Under the hood

- **Fast on a phone network.**
  `index.html` carries the start screen and its CSS inline, so it paints in the first round trip, before any script.
  A tiny boot script starts downloading the map tiles around where you were last and MapLibre's worker right away, alongside the app, and a tap on Start asks for your location even before the app has loaded.
  The app (~340 KB gzipped, most of it MapLibre) loads behind the start screen, and the service worker keeps it for the next start.
  The type ships with the app: Instrument Serif and Instrument Sans (OFL, `public/fonts/`, ~60 KB for the start screen, preloaded).
  Accented letters such as ő load from small extra files only when a name needs them.
  The map's labels draw with the same files.
- **One download per tile.**
  The [OpenFreeMap](https://openfreemap.org) vector tiles (OpenMapTiles schema, z14) that draw the map are also parsed, in a worker, into the walkable street graph and the house footprints.
  MapLibre gets each tile through a custom protocol from the same download.
  No Overpass, so no rate limits or queues.
  Each walkable way is cut into ~20 m pieces; pieces between two junctions form a **block** (capped at 160 m), the unit that unlocks.
  Footways are judged along their length: a stretch running beside a road is that road's sidewalk and the rest of the path stays; crossings and piers never light on their own.
- **Walked along it.**
  A good GPS step only lights the street it is actually following.
  Both ends of the step must be within 20 m of the street, the step must run alongside it rather than across it, and only the nearest parallel street is considered, so walking past a side street does not light it.
  The search reaches as far as the GPS accuracy, and never less than 15 m: a sidewalk plus the error a phone has between tall houses.
  Good GPS fixes (≤ 35 m accuracy, no impossible jumps, not faster than walking) are joined into segments first.
- **What you walk lights.**
  Walked stretches accumulate along each block without double-counting backtracks, measured along the whole block so no step is lost where two pieces meet.
  Each ~20 m piece lights as soon as 40% of it (at least 6 m) is walked, so a street you walk only part of still shows where you went.
- **Whole-block unlocks.**
  Once about half a block (and at least 8 m) has been walked, the rest of the block lights too.
  Houses within 20 m of anything lit light their windows.
  Each piece keeps a visit count (once per walk) for future heat colouring.
  If streets load late (offline), the walk's track is kept and replayed once they arrive.
  Streets lit before a map update are matched again by their shape.
- **Smooth walker.**
  GPS fixes go through a small Kalman filter, and the walker glides between them on a damped spring, so it never hops; the camera follows it every frame.
  Standing still, the walker (and so the camera) holds still until GPS noise puts its target more than a pixel away.
  Drawing runs on every display frame while something moves fast, 30 fps at walking pace and 15 fps standing still, when the fog also reuses its light and seen masks while nothing in them changed.
- **The fog** is drawn on the GPU as one MapLibre custom layer.
  A half-resolution light mask holds the lit streets, the unlock waves, the pool of light around you and your beam.
  It is composited as night fog with slow mist, a thin warm rim, lamplight along lit streets with a gold line down the middle, and lit houses whose windows come on one by one.
  Every street shows faintly through the fog, so you can see where you could go.
- **Line of sight.**
  The walls of the houses within ~140 m are gathered around you, and gathered again only after you moved 25 m.
  On the GPU, every wall facing your light casts an instanced shadow wedge into the lantern channels of the mask, hard where two walls meet and soft at the corners you see round, so the light falls between houses and down side streets, not through them.
  If GPS puts you inside a house, the light steps out to the street first.
- **What you have seen** is kept apart from what you walked.
  A few times a second an angular sweep on the CPU computes what your light reaches (disc around you, cone ahead) and paints it into a persistent raster (zoom-17 tiles, ~0.7 m a texel, in IndexedDB).
  The fog reads it back as moonlight: thinner fog, a cold tint.
  Houses the light reached get dim blue roofs with a moonlit outline, walls facing your lantern glow warm, street names show faintly under the fog, and landmarks (shops, cafés, churches from the tiles' `poi` layer) visible from where you stood get their name.
  Walked still means gold; seen never lights a street.
- **Look around.**
  The beam follows the compass (`deviceorientation`; on iPhone the Start tap asks for motion access) while you stand or turn the phone, and the way you walk while you walk.
  Stretches recorded with the screen locked are looked at the way you walked them.

Why each of these is built this way is in the [decision records](adr/README.md).
