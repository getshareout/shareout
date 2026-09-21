#!/usr/bin/env bash
# Create a worktree off origin/main, ready to test in seconds.
#
#   ./tooling/scripts/new-worktree.sh <branch> [dir]
#
# The slow part of a fresh worktree is `npm ci` (~450MB, minutes). node_modules is a
# pure function of the lockfile, so when the lockfile matches the primary checkout we
# clone it instead. On APFS `cp -c` is copy-on-write: seconds, and near-zero extra disk.
# The workspace links inside node_modules are relative (@shareout/sdk -> ../../sdk), so
# a copied tree points at THIS worktree's sources, not the primary's.
#
# Falls back to npm ci whenever the lockfile differs or the clone fails.
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

link_deps() {
  local name="$1" src="$2" dst="$3"
  if [ ! -d "$src/node_modules" ]; then
    echo "==> $name: primary has no node_modules — running npm ci"
    (cd "$dst" && npm ci)
    return
  fi
  if ! cmp -s "$src/package-lock.json" "$dst/package-lock.json"; then
    echo "==> $name: lockfile differs from primary — running npm ci"
    (cd "$dst" && npm ci)
    return
  fi
  echo "==> $name: cloning node_modules from primary"
  if ! cp -Rc "$src/node_modules" "$dst/node_modules" 2>/dev/null; then
    echo "    (copy-on-write unavailable, falling back to npm ci)"
    (cd "$dst" && npm ci)
  fi
}

link_deps "worker" "$PRIMARY/shareout-app" "$DEST/shareout-app"
[ -d "$PRIMARY/docs-site/node_modules" ] && link_deps "docs-site" "$PRIMARY/docs-site" "$DEST/docs-site"

# Gitignored local config the checks need. Without customer-names.local the very first
# `git push` fails on check:customer-names, which refuses to pass unconfigured.
for f in tooling/customer-names.local shareout-app/.dev.vars shareout-app/.env; do
  if [ -f "$PRIMARY/$f" ] && [ ! -e "$DEST/$f" ]; then
    cp "$PRIMARY/$f" "$DEST/$f"
    echo "==> carried over $f"
  fi
done

"$DEST/tooling/scripts/install-hooks.sh"

echo ""
echo "✓ Ready: cd $DEST/shareout-app"
echo "  Affected tests: npm run test:affected"
