#!/usr/bin/env bash
# Integrate several feature branches and run the full suite ONCE on the result.
#
# Feature-branch pushes only run light checks (see install-hooks.sh). This is where the
# tests run: merge every branch onto origin/main in a throwaway worktree, regenerate the
# committed bundles, then typecheck + full suite + workspace suites + bundle checks.
# Fix failures on integration/<name>, push it (that push runs the tested hook), then
# land it on main as one PR.
#
# Usage:
#   ./tooling/scripts/integrate.sh [-n name] <branch> [<branch>…]
#   name defaults to a timestamp; branches are remote names without "origin/".
set -euo pipefail

export TZ="${TZ:-UTC}"
NAME="$(date -u +%Y%m%d-%H%M)"
if [ "${1:-}" = "-n" ]; then NAME="$2"; shift 2; fi
[ "$#" -gt 0 ] || { echo "usage: $0 [-n name] <branch> [<branch>…]" >&2; exit 2; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
BRANCH="integration/$NAME"
DIR="${SHAREOUT_INTEGRATE_DIR:-${TMPDIR:-/tmp}/shareout-integrate-$NAME}"

git -C "$REPO_ROOT" fetch -q origin
git -C "$REPO_ROOT" worktree add -q "$DIR" -b "$BRANCH" origin/main --no-track
cd "$DIR"
echo "==> $BRANCH at $DIR"

for b in "$@"; do
  echo "==> merge origin/$b"
  if ! git merge -q --no-ff --no-edit "origin/$b"; then
    echo "Conflict merging $b in $DIR. Resolve, commit, merge the remaining branches" >&2
    echo "by hand, then run: SHAREOUT_FULL_TESTS=1 $DIR/tooling/scripts/ci-check-fast.sh" >&2
    git diff --name-only --diff-filter=U >&2
    exit 1
  fi
done

cd shareout-app
npm ci --silent
echo "==> regenerate committed bundles"
npm run -s check:bundles >/dev/null 2>&1 || true
cd "$DIR"
if ! git diff --quiet; then
  git add -A shareout-app/public shareout-app/src/discovery shareout-app/src/official-skills \
    shareout-app/src/data/agent/sdk-reference.generated.ts
  git commit -q -m "integration: regenerate bundles"
fi

echo "==> full checks (once)"
SHAREOUT_FULL_TESTS=1 "$DIR/tooling/scripts/ci-check-fast.sh"

echo ""
echo "✓ $BRANCH passes. Next:"
echo "  git -C $DIR push -u origin $BRANCH   # tested hook runs on integration/*"
echo "  gh pr create --head $BRANCH --base main"
