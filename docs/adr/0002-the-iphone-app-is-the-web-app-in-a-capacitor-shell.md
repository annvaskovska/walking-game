# 0002 - The iPhone app is the web app in a Capacitor shell with a native GPS journal

Status: accepted

## Context

A browser sends GPS only while the page is open with the screen on, so a walk with the phone in a pocket left its streets dark.
The web app keeps the screen awake with the Wake Lock API, but a locked phone or another app in front still stops the fixes.
The iPhone app must look and feel the same as the web app: the same start screen, map, fog and gestures.
From the first version, location, wake lock and storage sat behind small modules in `src/platform/` so that a native shell could replace them.
While the screen is locked, iOS can pause the web view, reload it or end the app, so no fix may depend on the page being alive.

## Decision

- `capacitor.config.ts` wraps `dist/`, the same build as the web app; `npm run ios:sync` builds it and copies it into `ios/`.
- `src/platform/native.ts` detects the shell from `window.Capacitor`, and `src/app/app.ts` imports `src/platform/nativeLocation.ts` only there, so the web build never loads `@capacitor/core`.
- `ios/App/App/WalkTracker.swift` runs `CLLocationManager` at best accuracy, with no distance filter, the `fitness` activity type, no automatic pauses, the `location` background mode and, from iOS 17, a `CLBackgroundActivitySession`.
- It asks only for While Using permission, and asks for temporary full accuracy (`WalkStreets`) when the user allowed only approximate location.
- `WalkJournal` writes every fix of the walk to `walk.jsonl` in Application Support: a `{"walk": id}` header, then one `[lon, lat, acc, t, speed, course]` array per line.
  A fix's sequence number is its index in the journal, and the file stays readable after the first unlock.
- `ios/App/App/WalkTrackerPlugin.swift` sends each fix live as a `fix` event with its number, and `fixes({ from, after })` reads back the rest.
- `nativeLocation.ts` hands on a live fix only when its number is the next one expected.
  On a gap, on a return to the screen and after a reload, it reads back from that number, and it never hands on a fix that is not newer than the last.
- When more than one fix arrives at once, `onCatchUp` snaps the walker to where you are and shows the walk numbers for 3 s.
- At start, `app.ts` asks the journal when the walk got its last fix, so a walk recorded with the screen locked carries on, and one older than 3 hours is closed.
- The shell uses no wake lock and registers no service worker, because it carries its files inside it.

## Consequences

- The map, the fog, the rules and the storage stay one codebase; the native side only records GPS.
- A walk recorded with the screen locked lights the same streets as one watched live, because the web view replays the journal in order.
- The GPS runs at best accuracy until the walk ends, and iOS shows its blue location indicator meanwhile.
- The fix array is a contract between Swift and TypeScript, and nothing checks both sides together.
- `src/platform/nativeLocation.test.ts` checks the order, the catch-up, the rule against duplicates and the silence watchdog with a fake plugin.
- `.github/workflows/ios.yml` runs the tests and builds the app for the simulator on every pull request; no test runs the Swift code.
