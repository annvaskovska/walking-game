#!/bin/sh
# Fails when the files, or a commit that main does not have yet, hold what this public repository
# keeps out (ADR 0010). `npm test` runs it, .githooks/pre-push runs it on every commit a push
# sends, and .githooks/pre-commit runs `check-public.sh tree`: the files only.
# ponytail: patterns only, so it cannot name a place nobody listed (see the word list below), tell
# a real walk inside the demo city from a demo one, or see what a picture shows. Review still
# covers those; add a scanner such as gitleaks when the patterns miss a leak.
set -eu
cd "$(dirname "$0")/.."
bad=0
new=$(mktemp)
words=$(mktemp)
trap 'rm -f "$new" "$words"' EXIT

fail() {
  echo "check-public: $1 (above). This repository is public: take it out." >&2
  bad=1
}

# The commits to check: none for `tree`, else those of the given commit, or HEAD, that main lacks.
tip=${1:-HEAD}
if [ "$tip" = tree ]; then range=
elif git rev-parse -q --verify origin/main >/dev/null; then range="origin/main..$tip"
else range=$tip; fi

# What those commits publish even when a later commit takes it out again: their messages, the
# branch name and every line they add.
if [ -n "$range" ]; then
  {
    git log --format=%B "$range"
    git rev-parse --abbrev-ref HEAD
    git log -p --cc --format= "$range" -- . ':!package-lock.json' ':!scripts/check-public*' |
      grep '^+' | grep -v '^+++ ' | cut -c2-
  } >"$new" || true
fi

# scan <grep options>: the matching lines of tracked files, of new files that git does not ignore,
# and of what the commits publish.
scan() {
  git grep --untracked -I -n "$@" -- . ':!package-lock.json' ':!scripts/check-public*' || true
  grep -n "$@" "$new" | sed 's/^/a commit that main lacks:/' || true
}

# check <what it is> <pattern> [<allowed>]
check() {
  hits=$(scan -E -e "$2" | grep -v -E -e "${3:-^$}" || true)
  [ -z "$hits" ] || { printf '%s\n' "$hits" >&2; fail "$1"; }
}

check 'a signing team in the Xcode project' 'DEVELOPMENT_TEAM = "?[A-Z0-9]{10}'
check 'a path on a machine' '(/Users|/home|\\Users)[/\\][A-Za-z0-9._-]+'
check 'a private key' 'BEGIN [A-Z ]*PRIVATE KEY-----.*[A-Za-z0-9+/]{20}|^[A-Za-z0-9+/]{64}$'
# GitHub's no-reply addresses and file names such as icon@2x.png are fine.
check 'an email address' '[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+\.[A-Za-z]{2,}' \
  '@users\.noreply\.github\.com|@example\.(com|org)|@[0-9]x\.'

# Coordinates lie in the demo city, Amsterdam (52.2-52.5 north, 4.7-5.1 east). Any other pair of
# decimals with a comma between, and any other decimal named lat, lon or lng, is a real place.
# ponytail: the shape of a number, not its meaning, so `lat = 52` and a pair split over two lines
# pass, and two unrelated decimals of 1 to 179 with a comma between fail: write those another way.
ams='(^|[^0-9.-])(52\.[2-4][0-9]*|4\.[7-9][0-9]*|5\.0[0-9]*)'
n='-?(1[0-7][0-9]|[1-9][0-9]?)\.[0-9]{2,}'
hits=$(scan -E -e '[0-9]\.[0-9]' | sed -E "s/$ams/\1AMS/g" | grep -i -E \
  -e "(^|[^0-9.])$n, *($n|AMS)|AMS, *$n" \
  -e "(^|[^a-z])(lat|lon|lng|latitude|longitude)[0-9]*[\"']? *[:=] *-?[0-9]+\.[0-9]" || true)
[ -z "$hits" ] || { printf '%s\n' "$hits" >&2; fail 'a coordinate outside the demo city, shown with AMS for each Amsterdam value'; }

# Your own private words, such as your name, your city and your street: one per line in the file
# below, which lives outside every repository. A line also matches inside a longer word.
list=${CHECK_PUBLIC_WORDS:-$HOME/.config/check-public-words}
[ ! -f "$list" ] || grep -v -E '^[[:space:]]*(#|$)' "$list" >"$words" || true
if [ -s "$words" ]; then
  hits=$(scan -i -F -f "$words" | cut -d: -f1,2 | sort -u)
  [ -z "$hits" ] || { printf '%s\n' "$hits" >&2; fail "a word from $list"; }
fi

# Pictures carry no camera or location metadata.
files=$(git grep --untracked -l -a -i -E -e 'exif|xmpmeta' -- \
  '*.png' '*.jpg' '*.jpeg' '*.webp' '*.heic' '*.gif' || true)
[ -z "$files" ] || { printf '%s\n' "$files" >&2; fail 'metadata inside a picture'; }

# Key files, env files and recorded tracks, even when someone forced them past .gitignore.
files=$({
  git ls-files -c -o --exclude-standard
  [ -z "$range" ] || git log --name-only --format= "$range"
} | sort -u | grep -i -E '(^|/)\.env|\.(p8|p12|pem|mobileprovision|gpx|kml|fit|tcx)$' || true)
[ -z "$files" ] || { printf '%s\n' "$files" >&2; fail 'a key, env or GPS track file'; }

if [ -n "$range" ]; then
  # Authors and committers of the commits that main does not have yet.
  people=$(git log --format='%h %ae%n%h %ce' "$range" | sort -u |
    grep -v -E '@users\.noreply\.github\.com$| noreply@github\.com$' || true)
  if [ -n "$people" ]; then
    printf '%s\n' "$people" >&2
    fail 'a private address on a commit; set user.email to your GitHub no-reply address'
  fi

  # The hook that stops a push must be in place, where git looks or where a global hook hands over.
  # ponytail: a global core.hooksPath that hands over to nothing still passes once the copy exists.
  grep -q -s check-public "$(git rev-parse --git-path hooks/pre-push)" \
    "$(git rev-parse --git-common-dir)/hooks/pre-push" || {
    echo 'check-public: the push hook is not installed. Run `npm run prepare`, outside any sandbox.' >&2
    bad=1
  }
fi

exit $bad
