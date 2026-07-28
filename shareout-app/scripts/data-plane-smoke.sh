#!/usr/bin/env bash
# Post-deploy / self-host smoke: prove the data plane works end to end.
#
# Path exercised:
#   publish artifact → json put/get → table insert/query →
#   dataset upload/confirm → dataset content → cleanup
#
# Requires:
#   SHAREOUT_ORIGIN  e.g. https://shareout.<account>.workers.dev  (no trailing slash)
#   SHAREOUT_TOKEN   personal API token (so_…) from Settings → API tokens
#
# Optional:
#   KEEP_SMOKE_ARTIFACT=1  leave the test artifact for inspection
#
# Usage (from shareout-app/):
#   export SHAREOUT_ORIGIN=… SHAREOUT_TOKEN=…
#   npm run smoke:data
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORIGIN="${SHAREOUT_ORIGIN:?set SHAREOUT_ORIGIN to your worker origin (no trailing slash)}"
ORIGIN="${ORIGIN%/}"
TOKEN="${SHAREOUT_TOKEN:?set SHAREOUT_TOKEN to an API token (so_…)}"
KEEP="${KEEP_SMOKE_ARTIFACT:-0}"
SLUG="smoke-data-$(date +%s)"
NAME="Data plane smoke ${SLUG}"

auth=(-H "Authorization: Bearer ${TOKEN}" -H "Content-Type: application/json")

json_field() {
  # json_field <json> <js-expr-on-j>  e.g. json_field "$body" 'j.artifact.id'
  node -e 'const j=JSON.parse(process.argv[1]); const v=eval(process.argv[2]); if(v===undefined||v===null) process.exit(2); process.stdout.write(String(v));' "$1" "$2"
}

http_json() {
  # http_json METHOD path [body]
  local method="$1" path="$2" body="${3:-}"
  local url="${ORIGIN}${path}"
  local res code
  if [[ -n "$body" ]]; then
    res="$(curl -sS -w "\n%{http_code}" -X "$method" "$url" "${auth[@]}" -d "$body")"
  else
    res="$(curl -sS -w "\n%{http_code}" -X "$method" "$url" "${auth[@]}")"
  fi
  code="$(echo "$res" | tail -n1)"
  BODY="$(echo "$res" | sed '$d')"
  CODE="$code"
}

echo "==> GET ${ORIGIN}/health"
http_json GET /health
test "$CODE" = "200" || { echo "health expected 200, got $CODE: $BODY"; exit 1; }
schema="$(node -e 'try{const j=JSON.parse(process.argv[1]);process.stdout.write(j.schema||"")}catch{process.stdout.write("")}' "$BODY" || true)"
if [[ -n "$schema" && "$schema" != "ready" ]]; then
  echo "health.schema is '${schema}' (want ready). Apply D1 migrations: npx wrangler d1 migrations apply DB --remote"
  exit 1
fi
echo "    health ok${schema:+ (schema=$schema)}"

echo "==> POST /v1/publish (${SLUG})"
HTML='<!DOCTYPE html><html><head><meta charset="utf-8"><title>Data smoke</title></head><body><h1>Data plane smoke</h1></body></html>'
PUBLISH_BODY="$(node -e '
const html = process.argv[1], name = process.argv[2], slug = process.argv[3];
process.stdout.write(JSON.stringify({
  name, slug, visibility: "private",
  files: [{ path: "index.html", content: html, mime: "text/html" }],
}));
' "$HTML" "$NAME" "$SLUG")"
http_json POST /v1/publish "$PUBLISH_BODY"
if [[ "$CODE" != "201" && "$CODE" != "200" ]]; then
  echo "publish expected 201, got $CODE: $BODY"
  exit 1
fi
ARTIFACT_ID="$(json_field "$BODY" 'j.artifact.id' 2>/dev/null || json_field "$BODY" 'j.artifact_id' 2>/dev/null || true)"
if [[ -z "${ARTIFACT_ID:-}" ]]; then
  echo "publish response missing artifact.id: $BODY"
  exit 1
fi
echo "    artifact ${ARTIFACT_ID}"

cleanup() {
  if [[ "$KEEP" == "1" ]]; then
    echo "==> KEEP_SMOKE_ARTIFACT=1 — leaving ${ARTIFACT_ID}"
    return
  fi
  echo "==> DELETE /v1/artifacts/${ARTIFACT_ID}"
  curl -sS -o /dev/null -w "    cleanup HTTP %{http_code}\n" -X DELETE \
    "${ORIGIN}/v1/artifacts/${ARTIFACT_ID}" \
    -H "Authorization: Bearer ${TOKEN}" || true
}
trap cleanup EXIT

DATA="/v1/data/${ARTIFACT_ID}"

echo "==> PUT ${DATA}/json/smoke_settings"
http_json PUT "${DATA}/json/smoke_settings" '{"theme":"dark","smoke":true}'
test "$CODE" = "200" || test "$CODE" = "201" || { echo "json put failed $CODE: $BODY"; exit 1; }

echo "==> GET ${DATA}/json/smoke_settings"
http_json GET "${DATA}/json/smoke_settings"
test "$CODE" = "200" || { echo "json get failed $CODE: $BODY"; exit 1; }
node -e '
const j=JSON.parse(process.argv[1]);
const v=j.data?.value ?? j.value;
if(!v || v.theme!=="dark" || v.smoke!==true){ console.error("unexpected json value", j); process.exit(1); }
' "$BODY"
echo "    json ok"

echo "==> POST ${DATA}/tables/smoke_rows"
http_json POST "${DATA}/tables/smoke_rows" '{"title":"hello","status":"open","n":1}'
test "$CODE" = "201" || test "$CODE" = "200" || { echo "table insert failed $CODE: $BODY"; exit 1; }

echo "==> POST ${DATA}/tables/smoke_rows/query"
http_json POST "${DATA}/tables/smoke_rows/query" '{"filter":{"status":"open"}}'
test "$CODE" = "200" || { echo "table query failed $CODE: $BODY"; exit 1; }
node -e '
const j=JSON.parse(process.argv[1]);
const rows=j.data?.rows ?? j.rows ?? [];
if(!Array.isArray(rows) || !rows.some(r=>r.title==="hello")){ console.error("table query missing row", j); process.exit(1); }
' "$BODY"
echo "    tables ok"

echo "==> POST ${DATA}/datasets/upload-url"
http_json POST "${DATA}/datasets/upload-url" '{"name":"smoke_extract","format":"json"}'
test "$CODE" = "201" || test "$CODE" = "200" || { echo "dataset upload-url failed $CODE: $BODY"; exit 1; }
UPLOAD_URL="$(json_field "$BODY" 'j.data?.uploadUrl || j.uploadUrl')"
UPLOAD_ID="$(json_field "$BODY" 'j.data?.uploadId || j.uploadId')"
ROWS_JSON='[{"id":1,"sku":"A","qty":3},{"id":2,"sku":"B","qty":1}]'

echo "==> PUT dataset bytes → ${UPLOAD_URL:0:80}…"
if [[ "$UPLOAD_URL" == http* ]]; then
  put_code="$(curl -sS -o /tmp/shareout-smoke-put.out -w "%{http_code}" -X PUT "$UPLOAD_URL" \
    -H "Content-Type: application/json" \
    -d "$ROWS_JSON")"
else
  put_code="$(curl -sS -o /tmp/shareout-smoke-put.out -w "%{http_code}" -X PUT "${ORIGIN}${UPLOAD_URL}" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "Content-Type: application/json" \
    -d "$ROWS_JSON")"
fi
test "$put_code" = "200" || test "$put_code" = "201" || {
  echo "dataset PUT failed HTTP $put_code: $(cat /tmp/shareout-smoke-put.out 2>/dev/null || true)"
  exit 1
}

echo "==> POST ${DATA}/datasets/smoke_extract/confirm"
CONFIRM_BODY="$(node -e 'process.stdout.write(JSON.stringify({uploadId:process.argv[1]}))' "${UPLOAD_ID}")"
http_json POST "${DATA}/datasets/smoke_extract/confirm" "$CONFIRM_BODY"
test "$CODE" = "200" || test "$CODE" = "201" || { echo "dataset confirm failed $CODE: $BODY"; exit 1; }

echo "==> GET ${DATA}/datasets/smoke_extract/content"
http_json GET "${DATA}/datasets/smoke_extract/content?limit=10"
test "$CODE" = "200" || { echo "dataset content failed $CODE: $BODY"; exit 1; }
node -e '
const j=JSON.parse(process.argv[1]);
const data=j.data?.data ?? j.data;
const total=j.data?.total ?? j.total;
if(!Array.isArray(data) || data.length<2){ console.error("expected ≥2 dataset rows", j); process.exit(1); }
if(Number(total)<2){ console.error("expected total≥2", j); process.exit(1); }
if(data[0].sku!=="A"){ console.error("unexpected first row", data[0]); process.exit(1); }
' "$BODY"
echo "    datasets ok"

echo ""
echo "✓ data plane smoke passed"
echo "  origin     ${ORIGIN}"
echo "  artifact   ${ARTIFACT_ID}"
echo "  checks     health · publish · json · tables · datasets"
echo "  (optional) KEEP_SMOKE_ARTIFACT=1 to keep the artifact"
