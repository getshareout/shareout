#!/usr/bin/env bash
# Full local check (worker + docs). There is no hosted CI; this is the complete gate.
# Prefer this before opening a PR. Fast subset: ci-check-fast.sh
#
# Runs the whole unit suite. Istanbul instrumentation more than doubles that, so
# coverage floors are opt-in: SHAREOUT_COVERAGE=1 ./tooling/scripts/ci-check.sh
set -euo pipefail

# Production (Cloudflare Workers) runs in UTC — pin tests so non-UTC contributors
# do not hit spurious scheduling/cron failures. Override with TZ=... if needed.
export TZ="${TZ:-UTC}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKER="$REPO_ROOT/shareout-app"
DOCS="$REPO_ROOT/docs-site"

echo "==> CI checks (worker)"
cd "$WORKER"
"$REPO_ROOT/tooling/scripts/install-deps.sh" "$WORKER" worker
npm run check:boundaries
npm run check:design-tokens
npm run check:domains
npm run check:customer-names
npm run check:skill-links
npm run check:migrations
npm run check:ui
npm run check:inline
npm run check:access-seams
npm run check:file-size
"$REPO_ROOT/tooling/scripts/check-agent-guides.sh"
npm run lint
npm run db:migrate:fresh
npm run typecheck
if [ "${SHAREOUT_COVERAGE:-}" = "1" ]; then
  npm run coverage -- --reporter=dot
else
  npm test -- --reporter=dot
fi

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
  "$REPO_ROOT/tooling/scripts/install-deps.sh" "$DOCS" docs-site
  npm run build
fi

echo ""
echo "✓ All checks passed"
