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

# Public CI is Ubuntu — brew isn't there. Install a pinned binary when missing under CI.
ensure_gitleaks() {
  if command -v gitleaks >/dev/null 2>&1; then
    return 0
  fi
  if [ "${CI:-}" != "true" ] && [ -z "${GITHUB_ACTIONS:-}" ]; then
    echo "error: gitleaks not installed (brew install gitleaks)" >&2
    return 1
  fi
  local ver="8.30.1"
  local dir="${RUNNER_TEMP:-${TMPDIR:-/tmp}}/gitleaks-${ver}"
  mkdir -p "$dir"
  echo "==> installing gitleaks v${ver} for CI"
  curl -sSL "https://github.com/gitleaks/gitleaks/releases/download/v${ver}/gitleaks_${ver}_linux_x64.tar.gz" \
    | tar -xz -C "$dir" gitleaks
  export PATH="$dir:$PATH"
  if [ -n "${GITHUB_PATH:-}" ]; then
    echo "$dir" >> "$GITHUB_PATH"
  fi
  command -v gitleaks >/dev/null
}

ensure_gitleaks

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
