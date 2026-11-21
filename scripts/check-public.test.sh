#!/bin/sh
# Self-check of check-public.sh, run by `npm test`: in a scratch repository a clean tree passes,
# each planted leak fails, and a leak that a later commit takes out still fails for the push.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
dir=$(mktemp -d)
trap 'rm -rf "$dir"' EXIT
git init -q "$dir/repo"
cd "$dir/repo"
mkdir scripts
cp "$here/scripts/check-public.sh" scripts/
cp "$here/.githooks/pre-push" .git/hooks/
echo zzyzx >"$dir/words"
export CHECK_PUBLIC_WORDS="$dir/words"
export GIT_AUTHOR_NAME=t GIT_AUTHOR_EMAIL=t@users.noreply.github.com
export GIT_COMMITTER_NAME=t GIT_COMMITTER_EMAIL=t@users.noreply.github.com

run() { sh scripts/check-public.sh "$@" >/dev/null 2>&1; }
die() { echo "check-public.test: $1" >&2; exit 1; }

cat >fine.ts <<'EOF'
const home = [4.88, 52.37], box = [4.879, 52.369, 4.902, 52.372];
declinationDeg(52.37, 4.88, 2026.9);
const row = [2025, 28, 89, -121, -99.77, -255.388723, -1482.460628];
const hash = fract(p * vec2(123.34, 456.21)), ease = lerp(0.45, 0.12, 1.84 * 0.25);
const lat = 52.3742, lon = 4.8839, latency = 16.67, along = 0.5;
EOF
run tree || die 'a clean tree fails'

while IFS= read -r leak; do
  echo "$leak" >leak.ts
  run tree && die "passes: $leak"
done <<'EOF'
const far = [12.34, 56.78];
declinationDeg(52.37, 56.78, 2026.9);
const LAT = 52.37, LON = 56.78;
{ "lat": 12.3, "lng": 4.88 }
const cache = '/Users/someone/cache';
// ask someone@elsewhere.dev
// a spot in Zzyzxville
DEVELOPMENT_TEAM = ABCDE12345;
EOF
rm leak.ts
: >walk.gpx
run tree && die 'passes: a GPS track file'
rm walk.gpx

git add -A
git commit -q --no-verify -m 'Add the app'
run || die 'a clean history fails'
GIT_COMMITTER_EMAIL=someone@elsewhere.dev git commit -q --no-verify --allow-empty -m 'Sign with a private address'
run && die 'passes: a private address on a commit'
git reset -q --hard HEAD~1
echo 'const far = [12.34, 56.78];' >leak.ts
git add -A
git commit -q --no-verify -m 'Add a leak'
git rm -q leak.ts
git commit -q --no-verify -m 'Take the leak out'
run tree || die 'a clean tree fails after the leak is out'
run && die 'passes: a leak that a later commit took out'
echo "0 $(git rev-parse HEAD) 0 0" | sh .git/hooks/pre-push >/dev/null 2>&1 && die 'the push hook lets the leak through'
exit 0
