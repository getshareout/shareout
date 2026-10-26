#!/usr/bin/env bash
# Make <app-dir>/node_modules match <app-dir>/package-lock.json, as cheaply as possible.
#
#   ./tooling/scripts/install-deps.sh <app-dir> [label]
#
# 1. Already installed from this lockfile (deps-installed.mjs)  → nothing to do.
# 2. The primary checkout's tree matches this lockfile           → clone it: on APFS
#    `cp -c` is copy-on-write, so seconds and near-zero extra disk. The workspace links
#    inside node_modules are relative (@shareout/sdk -> ../../sdk), so a copied tree
#    points at THIS checkout's sources, not the primary's.
# 3. Otherwise                                                   → npm ci --prefer-offline
#    (~5 s with a warm npm cache).
#
# Used by new-worktree.sh, ci-check-fast.sh, ci-check.sh, integrate.sh and land.sh.
set -euo pipefail

APP="$(cd "$1" && pwd)"
LABEL="${2:-$(basename "$APP")}"
CHECK="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/deps-installed.mjs"

if reason="$(node "$CHECK" "$APP")"; then
  echo "==> $LABEL: node_modules matches the lockfile"
  exit 0
fi
echo "==> $LABEL: $reason"

TOP="$(git -C "$APP" rev-parse --show-toplevel)"
PRIMARY="$(cd "$(dirname "$(git -C "$APP" rev-parse --path-format=absolute --git-common-dir)")" && pwd)"
SRC="$PRIMARY/${APP#"$TOP"/}"

if [ "$SRC" != "$APP" ] && node "$CHECK" "$APP" "$SRC" >/dev/null; then
  echo "==> $LABEL: cloning node_modules from the primary checkout"
  rm -rf "$APP/node_modules"
  if cp -Rc "$SRC/node_modules" "$APP/node_modules" 2>/dev/null; then
    exit 0
  fi
  echo "    (copy-on-write unavailable, falling back to npm ci)"
  rm -rf "$APP/node_modules"
fi

echo "==> $LABEL: npm ci --prefer-offline"
(cd "$APP" && npm ci --prefer-offline --no-audit --no-fund)
