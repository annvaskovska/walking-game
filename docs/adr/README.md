# Architecture decision records

Why Mr Sparkles is built the way it is, one decision per file: `NNNN-kebab-title.md`, with status `accepted`, `superseded by NNNN` or `deprecated`.
Development is ADR-driven: a change that makes or reverses a decision writes its record first, with the `adr` skill (`.agents/skills/adr`), and ships it in the same pull request.
An accepted record is never rewritten, only superseded.

| # | Decision |
| --- | --- |
| [0001](0001-walks-stay-on-the-device.md) | Walks stay on the device in IndexedDB, with a few boot values in `localStorage`; only tile requests leave the phone |
| [0002](0002-the-iphone-app-is-the-web-app-in-a-capacitor-shell.md) | The iPhone app is the same build in Capacitor; Swift GPS journals numbered fixes that the web view replays in order |
| [0003](0003-one-tile-download-feeds-the-map-and-the-street-graph.md) | One OpenFreeMap z14 download per tile feeds MapLibre and a worker that parses the street graph and the houses |
| [0004](0004-only-real-walking-lights-streets.md) | Only filtered GPS steps light: 35 m accuracy, a walking speed cap, glitches dropped, the walked-along match, no taps |
| [0005](0005-pieces-and-blocks-are-the-units-that-light.md) | 20 m pieces light at 40% (6 m), blocks up to 160 m unlock at half (8 m), shapes matched again after map updates |
| [0006](0006-the-fog-is-one-gpu-layer-with-a-separate-seen-memory.md) | One MapLibre custom layer: a half-resolution light mask, wall shadow wedges, and a CPU-painted z17 seen raster |
| [0007](0007-the-first-paint-comes-from-index-html-alone.md) | The start screen, its CSS and a boot script that prefetches tiles and the worker are inline; the fonts ship with the app and are preloaded |
| [0008](0008-the-frame-rate-follows-what-moves.md) | Drawing slows to 30 or 15 fps by motion, the walker holds within a pixel, and fog masks are kept while unchanged |
| [0009](0009-testflight-uploads-from-a-mac-with-an-api-key.md) | `npm run ios:testflight` signs with an App Store Connect API key from the environment and uploads from a Mac |
| [0010](0010-the-repository-is-public.md) | Superseded by 0014. Nothing in git names a person, an account, a machine or a place tied to a person; account details come from the environment, and `scripts/check-public.sh` checks every test run and commit |
| [0011](0011-the-app-is-called-mr-sparkles.md) | The app is Mr Sparkles with the bundle ID `io.github.annvaskovska.mrsparkles`; names that find stored data stay `wanderlight` |
| [0012](0012-mr-sparkles-is-a-firefly-you-meet-on-the-first-screen.md) | Mr Sparkles is one flickering round light, on the map and on the start screen, where a first-time walker drags him over a fogged picture of the demo city; Nunito is the interface's type |
| [0013](0013-the-browser-is-the-demo-only-the-iphone-app-walks.md) | Only the iPhone app records real walks; every browser walks the demo route through Amsterdam, with no location, no service worker and no home screen install |
| [0014](0014-agents-keep-private-data-out-of-git.md) | Agents keep private data out of git by the rules in `AGENTS.md` and Malini; code reads only tracked demo data in Amsterdam; no hook and no scan |
