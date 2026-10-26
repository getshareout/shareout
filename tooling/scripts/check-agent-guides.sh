#!/usr/bin/env bash
# AGENTS.md is the one agent guide. CLAUDE.md exists only so Claude Code loads it: it is
# the single line `@AGENTS.md` (an import), so the two files cannot drift apart again.
#
# Usage: ./tooling/scripts/check-agent-guides.sh   (run by ci-check-fast.sh and ci-check.sh)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [ ! -s "$ROOT/AGENTS.md" ] || [ "$(cat "$ROOT/CLAUDE.md" 2>/dev/null)" != "@AGENTS.md" ]; then
  echo "✗ CLAUDE.md must be exactly the line '@AGENTS.md', and AGENTS.md must exist." >&2
  echo "  Put agent guidance in AGENTS.md; CLAUDE.md only imports it." >&2
  exit 1
fi
echo "✓ CLAUDE.md imports AGENTS.md"
