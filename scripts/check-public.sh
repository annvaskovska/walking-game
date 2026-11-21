#!/bin/sh
# Fails when the tree, or a commit that is not on main yet, holds what this public repository keeps
# out (ADR 0010). `npm test` runs it, and so does the commit hook in .githooks/.
# ponytail: patterns only, so it cannot tell a real walk from a demo one, see location metadata
# inside an image, or spot a team ID outside the Xcode project. Review still covers those; add a
# scanner such as gitleaks when the patterns miss a leak.
set -eu
cd "$(dirname "$0")/.."
bad=0

fail() {
  echo "check-public: $1 (above). This repository is public: take it out." >&2
  bad=1
}

# check <what it is> <pattern> [<allowed>]: tracked files, and new files that git does not ignore.
check() {
  hits=$(git grep --untracked -I -n -E -e "$2" -- . ':!package-lock.json' ':!scripts/check-public.sh' |
    grep -v -E -e "${3:-^$}" || true)
  [ -z "$hits" ] || { printf '%s\n' "$hits" >&2; fail "$1"; }
}

check 'a signing team in the Xcode project' 'DEVELOPMENT_TEAM = "?[A-Z0-9]{10}'
check 'a path on a machine' '(/Users|/home|\\Users)[/\\][A-Za-z0-9._-]+'
check 'a private key' 'BEGIN [A-Z ]*PRIVATE KEY-----.*[A-Za-z0-9+/]{20}|^[A-Za-z0-9+/]{64}$'
# GitHub's no-reply addresses and file names such as icon@2x.png are fine.
check 'an email address' '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}' \
  '@users\.noreply\.github\.com|@example\.(com|org)|@[0-9]x\.'

# Key files, env files and recorded tracks, even when someone forced them past .gitignore.
files=$(git ls-files -c -o --exclude-standard |
  grep -i -E '(^|/)\.env|\.(p8|p12|pem|mobileprovision|gpx|kml|fit|tcx)$' || true)
[ -z "$files" ] || { printf '%s\n' "$files" >&2; fail 'a key, env or GPS track file'; }

# Authors and committers of the commits that main does not have yet.
if git rev-parse -q --verify origin/main >/dev/null; then range=origin/main..HEAD; else range=HEAD; fi
people=$(git log -50 --format='%h %ae%n%h %ce' "$range" | sort -u |
  grep -v -E '@users\.noreply\.github\.com$| noreply@github\.com$' || true)
if [ -n "$people" ]; then
  printf '%s\n' "$people" >&2
  fail 'a private address on a commit; set user.email to your GitHub no-reply address'
fi

exit $bad
