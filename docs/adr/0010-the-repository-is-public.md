# 0010 - The repository is public

Status: accepted

## Context

This repository is public on GitHub, and everything in it, history included, can be read, cloned and indexed by anyone.
A line removed later stays in every clone and in the history of `main`.
The app is about where a person walks, so its fixtures, demo walks and screenshots can show where someone lives.
Shipping to TestFlight adds account details, such as team IDs and API keys, that must not be published.

## Decision

- Nothing that lands in git names a person, an account, a machine or a place tied to a person: code, comments, docs, ADRs, images, commit messages, branch names, and pull request titles and bodies.
  `AGENTS.md` lists what that covers.
- A script that needs an account detail reads it from the environment and names the variable, never the value, as `scripts/testflight.sh` does (ADR 0009).
- Demo walks and test fixtures use public places, never a track from a real walk.
- `.gitignore` keeps out `.context/`, where real GPS traces for local benchmarks live, and signing files: `*.p8`, `*.p12`, `*.mobileprovision`.
- The Xcode project in git holds no signing team: `DEVELOPMENT_TEAM` is empty there.
- `scripts/check-public.sh` fails on a signing team in the Xcode project, a path on a machine, an email address, a private key, a key, env or GPS track file, and a commit whose author or committer address is not a GitHub no-reply one.
  `npm test` runs it first, and `npm install` makes it the commit hook through `.githooks/`.
- Each contributor turns on *Keep my email addresses private* and *Block command line pushes that expose my email* in their GitHub settings.
- When it is not clear whether something is private, it stays out until the user says otherwise.

## Consequences

- Contributors pick their own team in Xcode, which writes it into `ios/App/App.xcodeproj`; the check stops the commit until that change is left out.
- A secret that reaches git is burned: revoke it first, then clean the history.
- The history was cleaned once, before this record was published; a clone from before that is never pushed.
- `scripts/check-public.sh` enforces the patterns it knows on every test run, every commit and both CI workflows.
  It cannot tell a real walk from a demo one or read the metadata inside an image; review and the agents that read `AGENTS.md` hold those.
