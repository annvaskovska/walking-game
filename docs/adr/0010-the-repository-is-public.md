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
- When it is not clear whether something is private, it stays out until the user says otherwise.

## Consequences

- Contributors keep their own team in Xcode and leave that change in `ios/App/App.xcodeproj` out of their commits.
- A secret that reaches git is burned: revoke it first, then clean the history.
- Nothing checks a commit for personal data; the rule holds by review and by the agents that read `AGENTS.md`.
