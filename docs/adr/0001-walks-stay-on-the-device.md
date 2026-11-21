# 0001 - Walks stay on the device, with no account and no server

Status: accepted

## Context

Wanderlight records where a person walks, and that track can show where they live and what they do every day.
The app is a static build on GitHub Pages and the same build inside an iPhone shell, with no backend of its own.
Lit streets stay lit for good, so progress must survive reloads, a tab closed mid-walk and long breaks between walks.
Some private browsing modes have no IndexedDB, and a browser may evict site data under storage pressure.

## Decision

- `src/platform/storage.ts` is the only module that touches IndexedDB: database `wanderlight`, version 4, with the stores `lit`, `houses`, `walks`, `seen`, `seenHouses`, `places` and `meta`.
- A schema change bumps `DB_VERSION`, and `onupgradeneeded` creates the missing stores and deletes old ones (`cells` and `bldCells` went once streets came from the map tiles).
- When IndexedDB is missing, or stays blocked for 3 s, `MemoryStorage` takes over.
  The app still works, logs a warning, and forgets everything on reload.
- After the first walk that is kept, `persistStorage()` asks the browser not to evict the data.
  It does not ask at the first start, because Firefox asks the user about it.
- `src/app/app.ts` saves the walk in progress to `meta` at most every 2 s, lit pieces and houses after 1 s, and the seen memory every 5 s.
  It saves all of them at once on `pagehide` and when the page goes to the background.
- A few small values live in `localStorage`, because the boot script in `index.html` reads them before any module loads: `wl-pos` (the last position, rounded to 5 decimals), `wl-stats`, `wl-walking` and `wl-tiles`.
- The demo walk (`?sim`) uses its own database, `wanderlight-sim`, and a `-sim` suffix on those keys.
- Apart from the app's own files, every request goes to `tiles.openfreemap.org`, for tiles and the TileJSON, with `credentials: 'omit'`.
  There is no account, no analytics and no upload of any kind.
- The start screen and the iPhone location prompt both say that the location never leaves the device.

## Consequences

- There is no server to run, secure or pay for, and nothing to sign in to.
- There is no sync and no backup: clearing the site data or deleting the app loses every walk.
- The tile host still sees which tiles the phone asks for, so it learns the rough area of a walk.
- A new store or a new record shape needs a version bump and upgrade code in `openStorage`, and `Progress.load` must keep reading older records.
  `src/core/progress.test.ts` checks that records saved before piece kinds existed still load.
- New persistent state goes through `Storage`, or into `localStorage` only when the boot script needs it before the app loads.
- Nothing checks that no other module opens IndexedDB or calls another host; review and `AGENTS.md` hold that rule.
