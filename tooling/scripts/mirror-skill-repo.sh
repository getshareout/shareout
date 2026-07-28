#!/usr/bin/env bash
# Mirror skills/ShareOutSkill/ → a local checkout of getshareout/shareout-skill.
# Canonical edits stay in this monorepo; the skill repo is publish/install only.
#
# Usage:
#   ./tooling/scripts/mirror-skill-repo.sh /path/to/shareout-skill
#   SHAREOUT_SKILL_DIR=~/code/shareout-skill ./tooling/scripts/mirror-skill-repo.sh
#
# Does not commit or push. After rsync, review and commit in the skill repo.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SRC="$ROOT/skills/ShareOutSkill"
DST="${1:-${SHAREOUT_SKILL_DIR:-}}"

if [[ -z "$DST" ]]; then
  echo "usage: $0 /path/to/shareout-skill" >&2
  echo "   or: SHAREOUT_SKILL_DIR=... $0" >&2
  exit 2
fi
if [[ ! -d "$SRC" ]]; then
  echo "missing source: $SRC" >&2
  exit 1
fi
if [[ ! -d "$DST/.git" ]]; then
  echo "destination must be a git checkout of shareout-skill: $DST" >&2
  exit 1
fi

SHA="$(git -C "$ROOT" rev-parse --short HEAD)"
echo "==> mirroring $SRC → $DST (from monorepo @$SHA)"
echo "    preserving destination README.md, LICENSE, .gitignore"

rsync -a --delete \
  --exclude '.git' \
  --exclude 'README.md' \
  --exclude 'LICENSE' \
  --exclude '.gitignore' \
  "$SRC/" "$DST/"

echo "✓ rsync done. Next:"
echo "  cd $DST"
echo "  git checkout -b sync/from-monorepo-$SHA"
echo "  git add -A && git status"
echo "  git commit -m \"sync: mirror skill from getshareout/shareout@$SHA\""
echo "  git push -u origin HEAD && gh pr create"
