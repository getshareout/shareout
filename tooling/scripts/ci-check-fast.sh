#!/usr/bin/env bash
# Fast checks for daily work + git pre-push hooks.
#
# There is no hosted CI: this script is what stands between a change and main.
#
# Tests run as critical-path + whatever the change actually touches (vitest module
# graph). Force the whole suite with SHAREOUT_FULL_TESTS=1.
#
# SHAREOUT_CHECK_MODE=light skips every test run: static checks + eslint on changed
# files, worker + workspace typechecks, secrets and bundles only. The pre-push hook uses
# it for feature branches: parallel agents each running suites on one machine starve
# each other into timeouts. Tests run once, on the integrated result
# (tooling/scripts/integrate.sh), before anything reaches main.
#
# Independent checks run in parallel; each one's output is printed only if it fails.
# check:bundles runs last, alone: it rewrites public/_bundles/ (as does the
# stage-skill-bundle test), so it must not race the test run.
#
# Secret scan covers the commits being pushed (base..HEAD), not the whole tree.
# Full-tree scan: ./tooling/scripts/check-secrets.sh
#
# Skips docs-site build, fresh migrate, coverage, and audit (see ci-check.sh).
set -euo pipefail

export TZ="${TZ:-UTC}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORKER="$REPO_ROOT/shareout-app"
BASE="${SHAREOUT_TEST_BASE:-origin/main}"

if [ ! -d "$WORKER/node_modules" ] && [ ! -f "$WORKER/package-lock.json" ]; then
  echo "error: $WORKER not set up — run: cd shareout-app && npm ci" >&2
  exit 1
fi

cd "$WORKER"
if [ ! -d node_modules ] || [ package-lock.json -nt node_modules ]; then
  echo "==> npm ci (worker)"
  npm ci
else
  echo "==> Skipping npm ci (worker lockfile unchanged)"
fi

LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT
PIDS=()
NAMES=()

job() {
  local name="$1"
  shift
  ( "$@" ) >"$LOGS/$name.log" 2>&1 &
  PIDS+=("$!")
  NAMES+=("$name")
}

# eslint on the files this branch changed (vs the merge base), not the whole tree: ~1 s.
# The tree is clean at --max-warnings 0, so a warning here is one this branch added or
# left in a file it touched. Whole tree: npm run lint.
lint_changed() {
  local files=()
  if ! git merge-base "$BASE" HEAD >/dev/null 2>&1; then
    echo "lint: no merge-base with $BASE — linting the whole tree"
    npm run -s lint
    return
  fi
  while IFS= read -r f; do
    [ -f "$f" ] && files+=("$f")
  done < <(git diff --name-only --relative --diff-filter=ACMR "$BASE...HEAD" -- \
    '*.ts' '*.tsx' '*.mts' '*.cts' '*.js' '*.mjs' '*.cjs')
  if [ "${#files[@]}" -eq 0 ]; then
    echo "lint: no lintable files changed vs $BASE"
    return 0
  fi
  echo "lint: ${#files[@]} changed file(s)"
  npm run -s lint:changed -- --no-warn-ignored "${files[@]}"
}

static_checks() {
  for c in boundaries design-tokens ui inline domains customer-names skill-links migrations access-seams file-size; do
    npm run -s "check:$c"
  done
  "$REPO_ROOT/tooling/scripts/check-agent-guides.sh"
  lint_changed
}

# Workspace suites run as their own jobs below, so test:affected skips them here.
app_tests() {
  if [ "${SHAREOUT_FULL_TESTS:-}" = "1" ]; then
    npm test -- --reporter=dot
  else
    npm run test:critical -- --reporter=dot
    SHAREOUT_AFFECTED_WORKSPACES=0 npm run test:affected
  fi
}

workspace() {
  npm run typecheck --workspace "@shareout/$1"
  npm test --workspace "@shareout/$1" -- --reporter=dot
}

secrets() {
  local base
  base="$(git merge-base "$BASE" HEAD 2>/dev/null || true)"
  if [ -n "$base" ]; then
    SHAREOUT_SECRETS_RANGE="$base..HEAD" "$REPO_ROOT/tooling/scripts/check-secrets.sh"
  else
    "$REPO_ROOT/tooling/scripts/check-secrets.sh"
  fi
}

LIGHT=0
[ "${SHAREOUT_CHECK_MODE:-}" = "light" ] && LIGHT=1

if [ "$LIGHT" = "1" ]; then
  echo "==> Light checks (no tests; integrate.sh runs the suite once on the integrated branch)"
else
  echo "==> Fast CI checks (parallel)"
fi
START=$SECONDS
job static static_checks
job typecheck npm run typecheck
job secrets secrets
if [ "$LIGHT" = "0" ]; then
  job tests app_tests
  job chat-core workspace chat-core
  job sdk workspace sdk
  job editor workspace editor-client
else
  # Typechecks only (0.4–0.9 s each): sdk/, editor-client/ and chat-core/ changes are
  # otherwise unchecked until integration.
  job chat-core-types npm run typecheck --workspace @shareout/chat-core
  job sdk-types npm run typecheck --workspace @shareout/sdk
  job editor-types npm run typecheck --workspace @shareout/editor-client
fi

FAILED=()
for i in "${!PIDS[@]}"; do
  if wait "${PIDS[$i]}"; then
    echo "  ✓ ${NAMES[$i]}"
  else
    echo "  ✗ ${NAMES[$i]}"
    FAILED+=("${NAMES[$i]}")
  fi
done

if [ "${#FAILED[@]}" -gt 0 ]; then
  for n in "${FAILED[@]}"; do
    echo ""
    echo "──── $n ────"
    tail -n 80 "$LOGS/$n.log"
  done
  exit 1
fi

echo "==> Bundles"
npm run check:bundles
npm run check:bundle-size

echo ""
echo "✓ Fast checks passed in $((SECONDS - START))s (full suite: SHAREOUT_FULL_TESTS=1 $0)"
