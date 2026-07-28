#!/usr/bin/env bash
# Fast checks for daily work + git pre-push hooks.
#
# This is the local half of the deal struck in .github/workflows/ci.yml: PR CI runs
# static gates and the critical-path subset only, so THIS script is where the full
# unit suite actually runs before code leaves the machine. Keep the two in sync.
# Skips docs-site build, fresh migrate, coverage, and audit (see ci-check.sh).
set -euo pipefail

export TZ="${TZ:-UTC}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKER="$REPO_ROOT/shareout-app"

worker_npm_ci() {
  cd "$WORKER"
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
    echo "==> npm ci (worker)"
    npm ci
  else
    echo "==> Skipping npm ci (worker lockfile unchanged)"
  fi
}

if [ ! -d "$WORKER/node_modules" ] && [ ! -f "$WORKER/package-lock.json" ]; then
  echo "error: $WORKER not set up — run: cd shareout-app && npm ci" >&2
  exit 1
fi

echo "==> Fast CI checks (worker)"
worker_npm_ci
npm run check:boundaries
npm run check:design-tokens
npm run check:ui
npm run check:domains
npm run check:customer-names
npm run check:migrations
npm run check:access-seams
npm run check:file-size
npm run typecheck
npm test -- --reporter=dot

echo "==> Fast CI checks (chat-core workspace)"
npm run typecheck --workspace @shareout/chat-core
npm test --workspace @shareout/chat-core -- --reporter=dot

echo "==> Fast CI checks (SDK workspace)"
npm run typecheck --workspace @shareout/sdk
npm test --workspace @shareout/sdk -- --reporter=dot

echo "==> Fast CI checks (editor workspace)"
npm run typecheck --workspace @shareout/editor-client
npm test --workspace @shareout/editor-client -- --reporter=dot

# check:bundles rebuilds editor + chat-core + sdk and diffs staged output
# against what's committed — it IS the workspace build step.
echo "==> Fast CI checks (bundles)"
npm run check:bundles
npm run check:bundle-size

echo "==> Secret scan (gitleaks)"
"$REPO_ROOT/tooling/scripts/check-secrets.sh"

echo ""
echo "✓ Fast checks passed (full suite: ./tooling/scripts/ci-check.sh)"
