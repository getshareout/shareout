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

# Feature branches get the light checks (no tests). Pushing main, or an integration/*
# branch, runs the tests. stdin: <local ref> <local sha> <remote ref> <remote sha>.
MODE=light
while read -r _ _ remote_ref _; do
  case "$remote_ref" in
    refs/heads/main|refs/heads/integration/*) MODE=full ;;
  esac
done
if [ "$MODE" = "full" ]; then
  echo "pre-push: main/integration push — running checks with tests"
  exec "$ROOT/tooling/scripts/ci-check-fast.sh"
fi
echo "pre-push: feature branch — light checks (tests run in tooling/scripts/land.sh / integrate.sh)"
SHAREOUT_CHECK_MODE=light exec "$ROOT/tooling/scripts/ci-check-fast.sh"
HOOK

chmod +x "$HOOKS_DIR/pre-push"

# Committed generated files (shareout-app/.gitattributes `merge=generated`): keep our side
# on merge/rebase instead of conflicting; check:bundles in pre-push catches the stale result.
git -C "$REPO_ROOT" config merge.generated.name "generated file: keep ours, regenerate before push"
git -C "$REPO_ROOT" config merge.generated.driver true
echo "✓ Installed pre-push hook → $HOOKS_DIR/pre-push"
echo "✓ Configured merge driver 'generated' (keeps one side; check:bundles regenerates)"
echo "  Feature-branch pushes run light checks; tests run on what lands:"
echo "  ./tooling/scripts/land.sh <pr-number>   or, for a batch:"
echo "  ./tooling/scripts/integrate.sh <branch> [<branch>…]"
