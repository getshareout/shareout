#!/usr/bin/env bash
# Secret-scan gate (gitleaks). Used by export-oss.sh and optionally pre-push / CI.
#
# Usage:
#   ./tooling/scripts/check-secrets.sh              # scan this checkout (no-git)
#   ./tooling/scripts/check-secrets.sh /path/to/dir  # scan an export tree
#   SHAREOUT_SECRETS_RANGE=origin/main..HEAD ./tooling/scripts/check-secrets.sh
#                                                    # scan only those commits (pre-push: ~0.1s vs ~16s)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-$ROOT}"
CONFIG="$ROOT/.gitleaks.toml"

if ! command -v gitleaks >/dev/null 2>&1; then
  echo "error: gitleaks not installed (brew install gitleaks)" >&2
  exit 1
fi

if [ -n "${SHAREOUT_SECRETS_RANGE:-}" ]; then
  echo "==> gitleaks git $SHAREOUT_SECRETS_RANGE"
  gitleaks git "$ROOT" --config "$CONFIG" --log-opts="$SHAREOUT_SECRETS_RANGE" --no-banner --verbose
  echo "✓ gitleaks clean: $SHAREOUT_SECRETS_RANGE"
  exit 0
fi

echo "==> gitleaks detect --source $TARGET"
# --no-git: scan the tree as files (works on fresh export dirs without .git history noise)
gitleaks detect --source "$TARGET" --config "$CONFIG" --no-git --verbose
echo "✓ gitleaks clean: $TARGET"
