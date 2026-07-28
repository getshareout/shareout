#!/usr/bin/env bash
# Install shared git hooks for all worktrees (hooks live in the common .git dir).
#
# Usage (once per machine, from any checkout or worktree):
#   ./tooling/scripts/install-hooks.sh
#
# Pre-push runs ci-check-fast.sh. Skip one push: git push --no-verify
# Skip via env: SHAREOUT_SKIP_HOOK=1 git push
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
HOOKS_DIR="$(git -C "$REPO_ROOT" rev-parse --git-path hooks)"
mkdir -p "$HOOKS_DIR"

cat > "$HOOKS_DIR/pre-push" << 'HOOK'
#!/usr/bin/env bash
set -euo pipefail

if [ "${SHAREOUT_SKIP_HOOK:-}" = "1" ]; then
  echo "pre-push: skipped (SHAREOUT_SKIP_HOOK=1)"
  exit 0
fi

ROOT="$(git rev-parse --show-toplevel)"
echo "pre-push: running fast CI checks (skip: git push --no-verify)"
exec "$ROOT/tooling/scripts/ci-check-fast.sh"
HOOK

chmod +x "$HOOKS_DIR/pre-push"
echo "✓ Installed pre-push hook → $HOOKS_DIR/pre-push"
echo "  Full suite before a PR: ./tooling/scripts/ci-check.sh"
