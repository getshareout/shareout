#!/usr/bin/env bash
# Apply every D1 migration to an empty local DB, then smoke-query core tables.
# Used by OSS CI (Phase 3) so a stranger deploy isn't the first place numbering breaks.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PERSIST="$(mktemp -d "${TMPDIR:-/tmp}/shareout-d1-XXXXXX")"
cleanup() { rm -rf "$PERSIST"; }
trap cleanup EXIT

cd "$ROOT"
echo "==> Fresh D1 persist: $PERSIST"
# Binding name DB (not database_name) so Deploy-button renames still migrate.
npx wrangler d1 migrations apply DB --local --persist-to "$PERSIST"

echo "==> Smoke: users + artifacts tables exist"
out="$(npx wrangler d1 execute shareout-db --local --persist-to "$PERSIST" --command \
  "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','artifacts') ORDER BY name;" \
  --json)"
echo "$out" | grep -q '"name": "artifacts"'
echo "$out" | grep -q '"name": "users"'
echo "✓ fresh migrate smoke passed"
