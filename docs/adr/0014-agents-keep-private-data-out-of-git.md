# 0014 - Agents keep private data out of git, with no scan

Status: accepted

## Context

ADR 0010 made `scripts/check-public.sh` the check for private data: the first step of `npm test`, and a commit hook that `npm install` set up.
The one leak this repository had passed every pattern: an agent traced a real walk from a screenshot the user shared, added it as a second demo walk, and ran a benchmark on local data of that area.
A pattern cannot tell a real walk from a demo one, or a name from a word; only the agent that writes the change can.
The hooks needed an install step that a sandbox can refuse and a global hooks path replaces, and on such a machine no hook ran.
Every commit and push in this repository comes from Malini, which tells each agent to keep what it learns about the user out of files, commits and pull requests.

## Decision

- Nothing that lands in git names a person, an account, a machine or a place tied to a person: code, comments, docs, ADRs, images, commit messages, branch names, and pull request titles and bodies.
  `AGENTS.md` lists what that covers.
- The agents hold that line: Malini's private-data rule, and the "This repository is public" and "Demo data only" rules in `AGENTS.md`.
- No git hook and no scan: `.githooks/`, `scripts/check-public.sh` and the `prepare` script are gone, and `npm test` and CI run only the tests.
- Code, tests, benchmarks and scripts read only tracked files, and every place in them is Amsterdam: the demo walk in `src/platform/simRoute.ts`, or made up there.
  The sight benchmark walks the demo route between made-up houses.
- `.gitignore` keeps out `.context/`, which holds prototypes and captures of the demo walk, and signing files: `*.p8`, `*.p12`, `*.mobileprovision`.
  A real trace lives outside every checkout.
- These stay from ADR 0010: account details come from the environment (ADR 0009), the Xcode project in git holds no signing team, and commits carry a GitHub no-reply address.
- Each contributor turns on *Keep my email addresses private* and *Block command line pushes that expose my email* in their GitHub settings.
- When it is not clear whether something is private, it stays out until the user says otherwise.

## Consequences

- Nothing in the repository fails on a leak: a leak that reaches git is public at once, and only a history rewrite takes it out.
- A secret that reaches git is burned: revoke it first, then clean the history.
- A team that Xcode writes into `ios/App/App.xcodeproj` is left out of the commit by hand.
- A commit made outside Malini has only `AGENTS.md` and review to stop a leak.
- GitHub still refuses a push whose commits expose a private email address, for a contributor who turned that on.
- Enforcer: none in the repository; the agents' rules and review are the guard.
