#!/usr/bin/env bash
# Local mirror of .github/workflows/ci.yml (worker + docs).
# Prefer this before opening a PR. Fast subset: ci-check-fast.sh
set -euo pipefail

# Production (Cloudflare Workers) runs in UTC — pin tests so non-UTC contributors
# do not hit spurious scheduling/cron failures. Override with TZ=... if needed.
export TZ="${TZ:-UTC}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKER="$REPO_ROOT/shareout-app"
DOCS="$REPO_ROOT/docs-site"

echo "==> CI checks (worker)"
cd "$WORKER"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  npm ci
else
  echo "==> Skipping npm ci (worker lockfile unchanged)"
fi
npm run check:boundaries
npm run check:design-tokens
npm run check:domains
npm run check:customer-names
npm run check:migrations
npm run check:ui
npm run check:access-seams
npm run check:file-size
npm run db:migrate:fresh
npm run typecheck
npm run test:critical -- --reporter=dot
npm run coverage -- --reporter=dot

echo "==> CI checks (chat-core workspace)"
npm run typecheck --workspace @shareout/chat-core
npm test --workspace @shareout/chat-core -- --reporter=dot

echo "==> CI checks (SDK workspace)"
npm run typecheck --workspace @shareout/sdk
npm test --workspace @shareout/sdk -- --reporter=dot

echo "==> CI checks (editor workspace)"
npm run typecheck --workspace @shareout/editor-client
npm test --workspace @shareout/editor-client -- --reporter=dot

echo "==> CI checks (bundles)"
npm run check:bundles
npm run check:bundle-size

echo "==> Dependency audit (prod high+)"
npm audit --omit=dev --audit-level=high

echo "==> Secret scan (gitleaks)"
"$REPO_ROOT/tooling/scripts/check-secrets.sh"

if [ -n "${SHAREOUT_CHANGED_FILES:-}" ] && ! printf '%s\n' "$SHAREOUT_CHANGED_FILES" | grep -qE '^docs-site/'; then
  echo "==> Skipping docs site (no docs-site/ changes)"
else
  echo "==> CI checks (docs site)"
  cd "$DOCS"
  if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
    npm ci
  else
    echo "==> Skipping npm ci (docs lockfile unchanged)"
  fi
  npm run build
fi

echo ""
echo "✓ All checks passed"
