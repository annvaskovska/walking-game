# 0013 - The browser is the demo, only the iPhone app walks

Status: accepted

## Context

This changes details of earlier records: the first position asked for in the Start tap and the service worker that kept the app (ADR 0007), the service worker's tile cache (ADR 0003), the demo walk behind `?sim` (ADR 0001 and ADR 0004), and the install manifest's name and the web walker's kept streets (ADR 0011).
The rest of each still holds.
A browser sends GPS only while the page is open with the screen on, so a walk in a browser lit less than the same walk in the iPhone app, which records with the screen locked (ADR 0002).
Walking in a browser kept code of its own: browser geolocation, a first position asked for in the Start tap, notices for location off, a page without https and a browser without location, a service worker with an install manifest, and a self-signed https server (`npm run phone`) to test GPS on a phone.
The owner's call: Mr Sparkles is an iPhone app, and the browser version is only a demo.
The demo walk already existed behind `?sim`, with records of its own, and it shows what walking does without asking for location.

## Decision

- Only the iPhone app, the Capacitor shell, records real walks, with its native GPS (ADR 0002).
- In any browser, on a desktop, on a phone or from a home screen, Mr Sparkles is the demo.
  - Start walks the scripted route through the Jordaan in Amsterdam (`src/platform/simRoute.ts`), and the app never asks for location.
  - Start reads "Start the demo walk", and the fine print under it reads "A walk through Amsterdam, no location needed." instead of "Your location stays on this phone."
  - On a first visit, the start screen shows Mr Sparkles in the fog (ADR 0012) until the first demo walk, as the iPhone app does before its first walk.
    After it, the demo's map shows behind the start screen.
  - `?sim` is no longer needed; `?sim=fast` walks the demo at 10× speed.
- The boot script in `index.html` sets `window.__wl.sim` when the page is not the iPhone app.
  It reads `window.Capacitor.isNativePlatform()`, which Capacitor puts on the page before any script runs, so the choice is made before the first paint.
- The demo keeps its own records, as before: the database `wanderlight-sim` and the `-sim` keys in `localStorage`.
- Gone: browser geolocation (`createBrowserLocation` in `src/platform/location.ts`), the first position asked for in the Start tap (`window.__wl.fix` and `err`), and the browser's notices for location off, a page without https and a browser without location.
  The only location notice left is the iPhone app's "Location is off", with its Open Settings link.
- The Start tap still asks for compass access in Safari on iPhone, because in a phone browser the demo's beam follows where the phone points.
- The wake lock stays in the browser, so the demo keeps the screen on.
- There is no home screen install.
  `vite-plugin-pwa`, with its service worker and install manifest, is gone, and so are the manifest icons (`public/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png`) and the `apple-mobile-web-app-*` meta tags.
  The favicon and the `apple-touch-icon` stay.
- `public/sw.js` takes the old service worker's place for anyone who still has it: it deletes the old caches, unregisters itself and reloads the open pages from the network.
  No page registers it.
- `npm run phone` and `@vitejs/plugin-basic-ssl` are gone: real GPS is tested in the iPhone app, from Xcode (`npm run ios`) or TestFlight (ADR 0009).
- The GitHub Pages deploy of `main` (`.github/workflows/pages.yml`) is the public demo.
- The iPhone app does not change.

## Consequences

- Every real walk records with the screen locked, and the browser's location code, its notices and its https setup are gone.
- Anyone can see the game in a browser without walking and without sharing a location.
- Real walks recorded earlier in a browser stay in that browser's storage, in `wanderlight` and the `wl-` keys without `-sim`, and are no longer shown; nothing moves them.
  A walker on the web no longer keeps their lit streets, as ADR 0011 said they would.
- Testing real GPS needs an iPhone and a Mac with Xcode; there is no quick test from a laptop on the same Wi-Fi.
- Without a service worker, the browser demo does not work offline, and map tiles are cached only by the browser's own HTTP cache.
  The iPhone app carries its files inside it and never registered a service worker (ADR 0002).
- The start screen still paints before any script runs (ADR 0007): choosing the demo is one line of the boot script.
- `public/sw.js` stays at the old service worker's address, because a browser that still has that worker checks there for its update.
- Nothing checks that a browser never asks for location or that the demo writes only to its own records; review holds both.
