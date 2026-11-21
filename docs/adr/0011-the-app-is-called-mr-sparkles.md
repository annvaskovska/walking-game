# 0011 - The app is called Mr Sparkles

Status: accepted

## Context

The app shipped as Wanderlight, on the web and from Xcode, and is renamed Mr Sparkles before its first TestFlight upload.
The walker sees the name on the start screen, in the page title, under the home screen icon, in the location prompt and in error messages.
The iPhone app's bundle ID ties it to one developer team for good, and its App Store Connect record is made with it.
A new bundle ID costs nothing before the first upload and a new app record after it.
Stored data is found by names in code: the IndexedDB database, the `localStorage` keys and the iPhone walk journal folder.
A walk on the web is kept only while those names and the page address stay the same.

## Decision

- Everything the walker reads says Mr Sparkles: the wordmark `Mr <i>Sparkles</i>` and the `<title>` in `index.html`, the manifest `name` and `short_name` in `vite.config.ts`, `appName` in `capacitor.config.ts`, `CFBundleDisplayName` and the location usage text in `ios/App/App/Info.plist`, and every message and console prefix.
- The iPhone app's bundle ID is `io.github.annvaskovska.mrsparkles`, in `capacitor.config.ts` and in both build configurations of `ios/App/App.xcodeproj`.
- The view controller is `AppViewController`, after the Xcode target, so a later rename does not touch Swift.
- The demo's console handle is `__sparkles`, and the npm package is `mr-sparkles`.
- Names that find stored data stay: the database `wanderlight`, the demo's `wanderlight-sim`, the `wl-` keys, and the journal folder `Wanderlight` in `WalkTracker.swift`.
- The repository and its GitHub Pages address stay `walking-game`.

## Consequences

- A walker on the web keeps every lit street, since the database name and the page address do not change.
- A home screen web app keeps its data, but can show the old name until it is added again.
- The iPhone app is a new app to iOS: a copy run from Xcode under the old bundle ID keeps its own walks, and nothing moves them across.
- The kept storage names now read as the old app name; a comment at each says why, so nobody renames them.
- Nothing enforces the kept names: `git grep -i wanderlight` lists only them and the records that name them.
