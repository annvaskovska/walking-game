# Mr Sparkles guide

## The demo in a browser

Only the iPhone app records real walks (ADR 0013).
In any browser, Mr Sparkles is a demo: Start walks a scripted route through the Jordaan in Amsterdam and never asks for your location.
Run `npm run dev` and open **http://localhost:5173**, or **http://localhost:5173/?sim=fast** for 10× speed.
The demo keeps its own records, apart from real walks, and keeps the screen on while it walks.
Real walks recorded in a browser before it became the demo stay in that browser's storage, and the app no longer shows them.
In the demo, `__sparkles.look(90)` in the console turns the beam east as a compass would, and `look(null)` turns it back to the way you walk.

Every push to `main` builds the app and deploys it to **https://annvaskovska.github.io/walking-game/** as the public demo (`.github/workflows/pages.yml`).
In the repository's *Settings → Pages*, set *Source* to **GitHub Actions** once.

## The iPhone app

The iPhone app is the same web app (same start screen, map and gestures) in a native [Capacitor](https://capacitorjs.com) shell, with native GPS that keeps recording in the background.
Lock the phone, put it in your pocket, and when you look again the streets you walked are colored in at once.
Real GPS is tested here, in the app run from Xcode or installed from TestFlight.

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

Picking your team changes `DEVELOPMENT_TEAM` in `ios/App/App.xcodeproj`; leave that change out of your commits (ADR 0014).

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
  A tiny boot script picks the real walk in the iPhone app or the demo in a browser, and starts downloading the map tiles around where you were last and MapLibre's worker right away, alongside the app.
  A tap on Start before the app has loaded starts the walk as soon as it is up.
  The app (~340 KB gzipped, most of it MapLibre) loads behind the start screen; the iPhone app carries it inside.
  The type is Marker Felt for titles, numbers and street names, and Chalkboard SE for everything you read and tap, where the system has them, as on an iPhone or a Mac.
  Elsewhere Kalam Bold and Patrick Hand stand in; they ship with the app (OFL, `public/fonts/`) and swap in, so they never hold up the first paint.
  Accented letters such as ő load from small extra files only when a name needs them.
  The map's labels always draw with the shipped files.
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
  Houses within 20 m of anything lit are colored in too.
  Each piece keeps a visit count (once per walk) for future heat colouring.
  If streets load late (offline), the walk's track is kept and replayed once they arrive.
  Streets lit before a map update are matched again by their shape.
- **Smooth walker.**
  GPS fixes go through a small Kalman filter, and the walker glides between them on a damped spring, so it never hops; the camera follows it every frame.
  Standing still, the walker (and so the camera) holds still until GPS noise puts its target more than a pixel away.
  Drawing runs on every display frame while something moves fast, 30 fps at walking pace and 15 fps standing still, when the crayon layer also reuses what it drew while nothing in it changed.
- **Ink** is the map's own style (`src/map/style.ts`, `src/map/ink.ts`), drawn at the design's scale: 2.25 CSS px for every 1.5 m at the walk zoom.
  Houses, water and parks are outlines, with waves in the canals and cloud trees in the parks drawn on a canvas; streets are a black casing cut back to paper, paths are dashes, and each landmark gets a pictogram.
- **Crayon** is drawn on the GPU as one MapLibre custom layer (`src/map/fog/`), multiplied over the ink through the paper's tooth (`makeTooth`), so ink lines stay black under the color and specks of paper show through.
  Each lit street gets its own crayon of 13 (`pencilOf` in `src/theme.ts`, a hash of its name), as a soft band under a back-and-forth scribble that runs a little past its lines; the houses beside it are hatched off register, some in their street's crayon and the rest in one of their own.
  The walk leaves its own line in the pressed crayon of the street it follows, and the canal beside it gets a light blue scribble.
  It paints into a target of its own, and keeps that paint while nothing in it changed and the map moved less than half a pixel.
- **Mr Sparkles** is a crayon drawn on the GPU (`src/map/puckLayer.ts`): his body is turned into a texture only when his crayon or his wear changes, and he colors in left and right, leans and pops in the shader.
  His face (`src/ui/face.ts`) changes with the moment: big eyes while he colors, stars for a new street, hearts for a landmark, and sleep with a Zzz when you stand still.
  Tap him and his eyes spin; he looks at a finger near him.
  Only when his face changes are his arms and face drawn again over his body, on a small canvas.
- **What you have seen** is kept apart from what you walked.
  The walls of the houses within ~140 m are gathered around you, and gathered again only after you moved 25 m.
  A few times a second an angular sweep on the CPU computes what your view reaches over those walls (disc around you, cone ahead) and paints it into a persistent raster (zoom-17 tiles, ~0.7 m a texel, in IndexedDB), with the houses it reached.
  Landmarks (shops, cafés, churches from the tiles' `poi` layer) your view reaches get their pictogram colored in, and Mr Sparkles names the new ones in his speech bubble.
  The raster and the houses show nothing on the map today; they are kept so a later look can use them without new walks.
  Walked still means crayon; seen never colors a street.
- **Look around.**
  The beam follows the compass (`deviceorientation`; in Safari on iPhone the Start tap asks for motion access) while you stand or turn the phone, and the way you walk while you walk.
  Stretches recorded with the screen locked are looked at the way you walked them.

Why each of these is built this way is in the [decision records](adr/README.md).
