# Agent rules

The rules in this file apply to all code in the repository.
Domain rules live in `.agents/skills/`, as plain Markdown in the Agent Skills format that belongs to no particular tool, one folder per skill.
`.claude/skills` links to it.
Today there is one: `adr`, which records a decision.

## This repository is public

Everything that lands in git is public at once, and it stays public: removing a line later does not remove it from history.
That covers code, comments, docs, decision records, images, commit messages, branch names, and pull request titles and bodies.
Before you write any of them, keep out:

- **Secrets:** keys, tokens, passwords, certificates, `.p8` files, provisioning profiles, `.env` files.
- **Account details:** Apple team IDs, App Store Connect key and issuer IDs, Apple Accounts, any account or customer number.
- **People:** names, email addresses, phone numbers, and who works on what.
- **Places tied to a person:** a home, a home city or country, a workplace, a regular route, or a GPS track from a real walk.
  Demo walks, test fixtures, comments and examples use the demo city, Amsterdam.
- **Machines:** local paths such as `/Users/<name>`, device names, serial numbers, IP addresses, private URLs.
- **Media** that shows any of the above, or carries location metadata.

A script that needs an account detail reads it from the environment and names the variable, never the value.
Picking a team in Xcode writes it into `ios/App/App.xcodeproj`: leave that change out of the commit.
`scripts/check-public.sh` runs first in `npm test` and in the commit hook, and fails on the patterns it knows: teams, machine paths, addresses, keys, track files.
A red run means the data comes out.
It cannot judge a route or an image, so those stay yours to check.
The repository's own public URLs, such as its GitHub Pages address, are fine.
When you are not sure, leave it out and ask.
[ADR 0010](docs/adr/0010-the-repository-is-public.md) records why.

## Decisions

`docs/adr/` records why Mr Sparkles is built the way it is, one decision per file, listed in `docs/adr/README.md`.
Development is ADR-driven: read the records for the area before you change it, and decide in a record before you build.
A change that makes or reverses a decision carries its ADR, written with the `adr` skill, in the same pull request.
Features and fixes inside an existing decision need no ADR.

## Product

Mr Sparkles is a walking motivator: the city starts in fog, and every street you walk lights up for good, with its houses and its name.
It is one web app: in its native iPhone shell it records real walks, and in any browser it is a demo that walks a scripted route through Amsterdam (ADR 0013).

Every change keeps these invariants:

- **On the phone.** Walks, lit streets and the seen memory stay on the device: IndexedDB through `src/platform/storage.ts`, and the few boot values in `localStorage`.
  No account, no server, no analytics; apart from the app, every request goes to the tile host (ADR 0001).
- **Real walking only.** Only filtered GPS steps that follow a street light it.
  Nothing lights from a tap (ADR 0004).
  The browser's demo walk sends its scripted fixes through the same filter, into records of its own.
- **One app.** The iPhone app is the web app in a Capacitor shell.
  Native code does only what the web cannot: record with the screen locked (ADR 0002).
- **First paint first.** `index.html` paints the start screen before any script runs, and nothing may delay it (ADR 0007).
- **Frame budget.** A walker who stands still costs almost nothing: drawing slows down and skips work when nothing changes (ADR 0008).

## Stack

- TypeScript and Vite, with no UI framework.
- MapLibre GL for the map, with custom WebGL layers for the fog and the shadows (`src/map/fog/`).
- OpenFreeMap vector tiles (OpenMapTiles schema), decoded in a worker into the map, the street graph and the houses (`src/data/`).
- Capacitor for the iPhone app, Swift for its background GPS (`ios/App/App/`).
- Vitest for unit tests.

## Layout

- `src/core/`: pure logic, each module with its test: GPS filter, motion, walked-along rule, blocks, progress, walk stats, walls and line of sight, seen memory, heading.
- `src/geo/`: geometry, pieces, spatial index.
- `src/data/`: tile decoder and parser, tile source, street graph. `tileUrl.ts` is the one place the tile URL lives.
- `src/platform/`: the iPhone app's location, the demo walk, wake lock, storage, compass.
- `src/map/`: style, GPU fog, shadows, seen memory, walker, follow camera, gold names.
- `src/ui/`: start screen, walk stats, notices.
- `src/app/`: the controller.
- `index.html`: the start screen with Mr Sparkles in the fog, its CSS and its scripts, inline.
- `ios/`: the Xcode project and the native GPS plugin.
- `scripts/make-icons.mjs` draws the app icons, the iPhone one too; `scripts/testflight.sh` uploads to TestFlight.
- `docs/guide.md`: how to run, install and ship it, and how it works under the hood. `docs/adr/`: why.

## Commands

- `npm run dev` serves the app at `localhost:5173`, where it is the demo: Start walks a scripted route without GPS, with records apart from real walks.
  `?sim=fast` walks it at 10× speed.
- `npm test` runs the unit tests, `npm run typecheck` type-checks, `npm run build` does both and builds into `dist/`.
- `npm run ios` builds, copies the web app into `ios/` and opens Xcode; `npm run ios:sync` only builds and copies.
  Real GPS is tested only in the iPhone app, run from Xcode or installed from TestFlight.
- `npm run ios:testflight` uploads a build to TestFlight with an App Store Connect API key from the environment (ADR 0009).
  `xcodebuild` resolves Swift packages in a sandbox of its own, so run it outside any other sandbox.
- CI: `.github/workflows/ios.yml` tests and builds the iPhone app on every pull request; `.github/workflows/pages.yml` deploys `main` to GitHub Pages as the public demo.
- Commit subjects and pull request titles are plain imperative sentences that say what changes for the walker, as `git log` shows.

## Code: lazy senior developer

Lazy means efficient, not careless.
The best code is the code never written.
Lazy means less code, not less effort: understanding, root cause, and verification still get full effort.

Understand the problem first.
Read the task and the code it touches, and trace the real flow end to end.
Then stop at the first rung that holds:

1. Does this need to be built at all? (YAGNI)
2. Does it already exist in this codebase? Reuse the helper, util, or pattern that is already here.
3. Does the standard library do this? Use it.
4. Does a native platform feature cover it? Use it.
5. Does an already-installed dependency solve it? Use it.
6. Can this be one line? Make it one line.
7. Only then: write the minimum code that works.

Bug fix = root cause, not symptom.
A report names a symptom.
Grep every caller of the function you touch and fix the shared function once.
One guard there is a smaller diff than one per caller, and a fix on only the path the ticket names leaves sibling callers broken.

Rules:

- No abstractions or boilerplate that nobody asked for.
- No new dependency if you can avoid it.
- Deletion over addition. Boring over clever. Fewest files possible.
- Shortest working diff wins, but only once you understand the problem.
  The smallest change in the wrong place is not lazy, it is a second bug.
- Complex request? Ship the lazy version and question it in the same response: "Did Y, it covers X. Need full X? Say so."
- Two stdlib options of the same size? Pick the one that is correct on edge cases.
- Mark deliberate simplifications that cut a real corner with a known ceiling (global lock, O(n²) scan, naive heuristic) with a `ponytail:` comment.
  Name the ceiling and the upgrade path.

Never lazy about:

- Understanding the problem. A small diff you do not understand is laziness dressed up as efficiency.
- Input validation at trust boundaries, error handling that prevents data loss, security, privacy, and accessibility.
- Calibration that real hardware needs. GPS drifts, and a compass reads off.
- Anything explicitly requested.
- Tests. Lazy code without its check is unfinished.
  Non-trivial logic leaves ONE runnable check behind: the smallest thing that fails if the logic breaks (an assert-based self-check or one small test file, no frameworks, no fixtures).
  Trivial one-liners need no test.
