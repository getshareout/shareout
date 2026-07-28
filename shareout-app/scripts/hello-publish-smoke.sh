#!/usr/bin/env bash
# Manual / post-deploy smoke: publish examples/hello-shareout.html to a running instance.
# Requires: SHAREOUT_ORIGIN (e.g. https://shareout.xxx.workers.dev) and SHAREOUT_TOKEN (so_…).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ORIGIN="${SHAREOUT_ORIGIN:?set SHAREOUT_ORIGIN to your worker origin}"
TOKEN="${SHAREOUT_TOKEN:?set SHAREOUT_TOKEN to an API token (so_…)}"
HTML="$(cat "$ROOT/examples/hello-shareout.html")"

payload="$(node -e '
const html = process.argv[1];
process.stdout.write(JSON.stringify({
  name: "Hello ShareOut",
  slug: "hello-shareout",
  files: [{ path: "index.html", content: html, mime: "text/html" }],
}));
' "$HTML")"

echo "==> POST $ORIGIN/v1/publish"
res="$(curl -sS -w "\n%{http_code}" -X POST "$ORIGIN/v1/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "$payload")"
code="$(echo "$res" | tail -n1)"
body="$(echo "$res" | sed '$d')"
echo "$body" | head -c 500
echo
test "$code" = "201" || { echo "expected 201, got $code"; exit 1; }

url="$(node -e 'const j=JSON.parse(process.argv[1]); process.stdout.write(j.deployment?.url||"");' "$body")"
test -n "$url" || { echo "missing deployment.url"; exit 1; }
echo "==> GET $url"
tmp="$(mktemp)"
ok=0
for attempt in 1 2 3 4 5 6 7 8; do
  if curl -sS -L "$url" -o "$tmp" && grep -q "Hello ShareOut" "$tmp"; then
    ok=1
    break
  fi
  # Shell page wraps iframe; raw body is the definitive check
  if curl -sS -L "${url}index.html?_raw" -o "$tmp" && grep -q "Hello ShareOut" "$tmp"; then
    ok=1
    break
  fi
  sleep 1
done
rm -f "$tmp"
test "$ok" = "1" || { echo "served HTML missing Hello ShareOut after retries"; exit 1; }
echo "✓ hello publish smoke passed → $url"
