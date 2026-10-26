#!/usr/bin/env bash
# Create a worktree off origin/main, ready to test in seconds.
#
#   ./tooling/scripts/new-worktree.sh <branch> [dir]
#
# `npm ci` installs ~450 packages (~650MB): about 5s with a warm npm cache, but a full
# extra copy on disk per worktree. So install-deps.sh clones the primary checkout's
# node_modules (copy-on-write on APFS: seconds, near-zero extra disk) when what the
# primary has INSTALLED (node_modules/.package-lock.json) matches this worktree's
# lockfile, and runs `npm ci --prefer-offline` otherwise.
set -euo pipefail

BRANCH="${1:-}"
if [ -z "$BRANCH" ]; then
  echo "usage: $0 <branch> [dir]" >&2
  exit 2
fi

GIT_COMMON="$(git rev-parse --git-common-dir)"
PRIMARY="$(cd "$(dirname "$GIT_COMMON")" && pwd)"
DEST="${2:-$PRIMARY/../shareout-wt/${BRANCH##*/}}"

if [ -e "$DEST" ]; then
  echo "error: $DEST already exists" >&2
  exit 1
fi

echo "==> Fetching origin"
git -C "$PRIMARY" fetch origin --quiet

echo "==> Worktree $DEST on $BRANCH"
git -C "$PRIMARY" worktree add -b "$BRANCH" "$DEST" origin/main

DEST="$(cd "$DEST" && pwd)"

DEPS="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/install-deps.sh"
"$DEPS" "$DEST/shareout-app" worker
[ -d "$PRIMARY/docs-site/node_modules" ] && "$DEPS" "$DEST/docs-site" docs-site

# Gitignored local config. tooling/customer-names.local is not copied: check:customer-names
# reads it from the main checkout.
for f in shareout-app/.dev.vars shareout-app/.env; do
  if [ -f "$PRIMARY/$f" ] && [ ! -e "$DEST/$f" ]; then
    cp "$PRIMARY/$f" "$DEST/$f"
    echo "==> carried over $f"
  fi
done

"$DEST/tooling/scripts/install-hooks.sh"

echo ""
echo "✓ Ready: cd $DEST/shareout-app"
echo "  Affected tests: npm run test:affected"
