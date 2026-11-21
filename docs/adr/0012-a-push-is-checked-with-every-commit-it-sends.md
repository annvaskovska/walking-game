# 0012 - A push is checked, with every commit it sends

Status: accepted

## Context

ADR 0010 keeps personal data out of git and names `scripts/check-public.sh` as its check.
Three gaps stayed open.
The commit hook was set through `core.hooksPath`, which a sandbox can refuse to write and a global hooks path replaces, and the install failed without a word: on such a machine no hook ran.
The check read the files as they are now, so a real place added in one commit and taken out in the next still went out with the push.
It had no pattern for the two things the app is about, coordinates and place names, so a test set in a real city passed.
CI runs after the push, when the commits are already public.

## Decision

- The push is the gate.
  `.githooks/pre-push` runs the check on every commit a push sends that `main` lacks: each line those commits add, their messages, their file names, and their author and committer addresses.
- `.githooks/pre-commit` runs `check-public.sh tree`, the files only, so work on a branch can still be committed while that branch cannot be pushed.
- `npm install` copies both hooks into the hooks folder of the clone, which every worktree shares and a global hook can hand over to.
  A copy that fails says so, and the check fails while the push hook is not in place.
- Coordinates: a pair of decimals, or a decimal named `lat`, `lon` or `lng`, outside Amsterdam (52.2-52.5 north, 4.7-5.1 east) fails.
- Names: each contributor lists their own private words, such as their name, city and street, one per line in `~/.config/check-public-words`, or in the file that `CHECK_PUBLIC_WORDS` names.
  The check fails on a match and prints only where it is.
  The list lives outside every repository, because a list of the places to keep out would itself be the leak.
- A picture that carries EXIF or XMP metadata fails.
- The iPhone workflow checks out the commits of the pull request with the full history, so the same check reads each of them.

## Consequences

- A branch that carries a leak in its history cannot be pushed, even after the leak is out of the files: it is built again from `main`.
- A clone from before the history was cleaned (ADR 0010) fails the check on every branch.
- Two unrelated decimals of 1 to 179 with a comma between them fail, and the code writes them another way.
- The word list holds only what its owner wrote in it.
  A place nobody listed, a real walk inside Amsterdam and what a picture shows stay with review.
- Enforcers: `scripts/check-public.sh` in `npm test`, in both hooks and in both CI workflows.
  `scripts/check-public.test.sh` plants each kind of leak in a scratch repository and fails when one passes.
- Nothing stops a push that skips hooks, such as `git push --no-verify`: CI fails after it, when the commits are public.
