#!/usr/bin/env bash
# ÉLES KIADÁS (ktg.szakify.hu) — CSAK Daniel kifejezett kérésére futtatandó!
# A fejlesztés a `dev` ágon folyik és helyben tesztelődik; az éles oldal
# addig nem változik, amíg ez a szkript le nem fut.
#
#   scripts/release.sh            → kiadás a main ágról
#   scripts/release.sh --dry-run  → mindent előkészít, de nem tölt fel
#
# A gh-pages ág története megmarad (nem force-push), így bármelyik korábbi
# kiadásra vissza lehet állni: scripts/rollback.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REPO="https://github.com/szegedid91/ktg-management.git"
DRY=0; [ "${1:-}" = "--dry-run" ] && DRY=1

cd "$ROOT"
BRANCH="$(git rev-parse --abbrev-ref HEAD)"
if [ "$BRANCH" != "main" ]; then echo "✋ Kiadni csak a main ágról lehet (most: $BRANCH). Előbb: git checkout main && git merge dev"; exit 1; fi
if [ -n "$(git status --porcelain -- . ':!app/src/lib/version.ts')" ]; then echo "✋ Nem véglegesített módosítások vannak — előbb commit."; exit 1; fi

cd "$ROOT/app"
npx tsc --noEmit -p .
node scripts/genversion.mjs
rm -rf dist
npx expo export --platform web --clear
echo "ktg.szakify.hu" > dist/CNAME
touch dist/.nojekyll
node scripts/postbuild-web.mjs
cp dist/index.html dist/404.html   # a postbuild UTÁN: a mélylinkek is megkapják a PWA-metát
V="$(grep -o "APP_VERSION = '[^ ]*" src/lib/version.ts | cut -d"'" -f2)"

TMP="$(mktemp -d)"
git clone --quiet --depth 50 --branch gh-pages "$REPO" "$TMP"
find "$TMP" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -R dist/. "$TMP/"
cd "$TMP"
git add -A
git -c user.name="Daniel Szegedi" -c user.email="dnl.szegedi@gmail.com" commit --quiet -m "Release $V" || { echo "Nincs változás a jelenlegi éles verzióhoz képest."; exit 0; }
if [ "$DRY" = "1" ]; then echo "DRY-RUN: a(z) $V kiadás előkészítve, feltöltés nélkül ($TMP)."; exit 0; fi
git push --quiet origin gh-pages

cd "$ROOT"
git add app/src/lib/version.ts
git commit --quiet -m "Verzió: '$V'" || true
git tag "release-$V" || true
git push --quiet origin main --tags
echo "✅ Kiadva: $V — élesedés 1–3 perc (GitHub Pages)."
