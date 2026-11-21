# 0012 - A push is checked, with every commit it sends

Status: accepted

## Context

ADR 0010 keeps personal data out of git and names `scripts/check-public.sh` as its check.
Three gaps stayed open.
The commit hook was set through `core.hooksPath`, which a sandbox can refuse to write and a global hooks path replaces, and the install failed without a word: on such a machine no hook ran.
The check read the files as they are now, so a real place added in one commit and taken out in the next still went out with the push.
It had no pattern for coordinates, so a test set in a real city passed.
The leak itself began in one commit: a real walk, traced from a screenshot of a phone test, became a second demo walk, and the tests moved to its city.
ADR 0010 then let real GPS traces for local benchmarks live in `.context/`, and a benchmark read them, so a real walk sat in the checkout where every agent works.
CI runs after the push, when the commits are already public.

## Decision

- The push is the gate.
  `.githooks/pre-push` runs the check on every commit a push sends that `main` lacks: each line those commits add, their messages, their file names, and their author and committer addresses.
- `.githooks/pre-commit` runs `check-public.sh tree`, the files only, so work on a branch can still be committed while that branch cannot be pushed.
- `npm install` copies both hooks into the hooks folder of the clone, which every worktree shares and a global hook can hand over to.
  A copy that fails says so, and the check fails while the push hook is not in place.
- Coordinates: a pair of decimals, or a decimal named `lat`, `lon` or `lng`, outside Amsterdam (52.2-52.5 north, 4.7-5.1 east) fails.
- Code reads tracked files only, which reverses that part of ADR 0010.
  The sight benchmark runs on the demo walk between made-up houses, a real trace lives outside every checkout, and the check fails on code that names a path inside `.context/`.
- `AGENTS.md` tells agents to work with demo data only: every place is Amsterdam, and the app runs as `?sim`.
- A picture that carries EXIF or XMP metadata fails.
- The iPhone workflow checks out the commits of the pull request with the full history, so the same check reads each of them.

## Consequences

- A branch that carries a leak in its history cannot be pushed, even after the leak is out of the files: it is built again from `main`.
- A clone from before the history was cleaned (ADR 0010) fails the check on every branch.
- Two unrelated decimals of 1 to 179 with a comma between them fail, and the code writes them another way.
- The name of a person or a place has no pattern, and a list of the names to keep out would itself be the leak.
  Names, a real walk inside Amsterdam and what a picture shows stay with review and with the agent rules.
- Enforcers: `scripts/check-public.sh` in `npm test`, in both hooks and in both CI workflows.
  `scripts/check-public.test.sh` plants each kind of leak in a scratch repository and fails when one passes.
- Nothing stops a push that skips hooks, such as `git push --no-verify`: CI fails after it, when the commits are public.
