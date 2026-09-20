#!/usr/bin/env bash
# Visszaállás egy korábbi éles kiadásra (a gh-pages ág történetéből).
#   scripts/rollback.sh          → az előző kiadás
#   scripts/rollback.sh <sha>    → adott gh-pages commit
#   scripts/rollback.sh --list   → az utolsó kiadások listája
set -euo pipefail
REPO="https://github.com/szegedid91/ktg-management.git"
TMP="$(mktemp -d)"
git clone --quiet --depth 50 --branch gh-pages "$REPO" "$TMP"
cd "$TMP"
if [ "${1:-}" = "--list" ]; then git log --oneline -20; exit 0; fi
TARGET="${1:-HEAD~1}"
git rev-parse --verify --quiet "$TARGET" >/dev/null || { echo "Nincs ilyen kiadás: $TARGET"; exit 1; }
DESC="$(git log -1 --format=%s "$TARGET")"
find . -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
git checkout --quiet "$TARGET" -- .
git add -A
git -c user.name="Daniel Szegedi" -c user.email="dnl.szegedi@gmail.com" commit --quiet -m "Rollback → $DESC"
git push --quiet origin gh-pages
echo "↩️  Visszaállítva: $DESC — élesedés 1–3 perc."
