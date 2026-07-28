---
name: "shareout-skill"
version: "2.51.0"
updated_at: "2026-07-25T20:00:00Z"
description: "ShareOut primer — publish live HTML artifacts on a hosted or self-hosted instance. Resolve $ORIGIN first. For the full agent skill tree use GET $ORIGIN/v1/skill. For install/deploy on Cloudflare see the monorepo skills/ShareOutSkill/deploy/SKILL.md."
skill_endpoint: "/v1/skill"
---

# ShareOut (official primer)

This is the short **Recommended by ShareOut** primer. It is **not** the full skill tree.

| Goal | Load |
|------|------|
| Full agent skill (publish, SDK, workspace admin) | `GET $ORIGIN/v1/skill` (zip) · or monorepo `skills/ShareOutSkill/SKILL.md` |
| Install / deploy on Cloudflare | monorepo `skills/ShareOutSkill/deploy/SKILL.md` |
| Skill source of truth | monorepo `skills/README.md` |

## Instance origin

Every URL below uses **`$ORIGIN`** — the public origin of the instance you are talking to.

Resolve (first match wins):

1. `~/.shareout/credentials` → `"origin"`
2. Env `SHAREOUT_ORIGIN` / `SHAREOUT_BASE_URL`
3. User-stated instance URL
4. Only if none: `https://shareout.site` (hosted product)

```json
// ~/.shareout/credentials
{ "token": "so_…", "origin": "https://your-instance.example" }
```

**Self-host / OSS:** no Pro/Teams paywall. Workspace admin uses **roles**, not plan upgrades.
Never open checkout or invent billing flows.

## Version check

1. `GET $ORIGIN/v1/skill/version` → compare to this primer’s `version` (now `2.51.0`).
2. Prefer the live zip: `GET $ORIGIN/v1/skill` when the instance is newer or when you need
   full docs (creating/, team/, sdk/, api/, deploy/).

## First run — token

If credentials are missing:

- **Device login (Google):** `POST $ORIGIN/v1/auth/device/start` → user opens
  `verification_uri_complete` → poll `POST $ORIGIN/v1/auth/device/token`.
- **Anonymous:** `POST $ORIGIN/v1/auth/create-account` (if enabled).
- **Web UI:** sign in at `$ORIGIN` → Settings → API token.

Save `{ "token", "origin" }` with `chmod 600`.

## Publish (hello)

Prefer `curl` (some HTTP clients hit Cloudflare 1010):

```bash
ORIGIN=$(python3 -c "import json,os; c=json.load(open(os.path.expanduser('~/.shareout/credentials'))); print(c.get('origin') or os.environ.get('SHAREOUT_ORIGIN','https://shareout.site'))")
TOKEN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.shareout/credentials')))['token'])")
python3 - <<'PY' | curl -sS -X POST "$ORIGIN/v1/publish" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' --data-binary @-
import json, sys
json.dump({
  "name": "Hello ShareOut",
  "slug": "hello-shareout",
  "visibility": "public",
  "files": [{
    "path": "index.html",
    "content": "<!DOCTYPE html><html><body><h1>Hello ShareOut</h1></body></html>",
    "mime": "text/html",
    "encoding": "utf8"
  }]
}, sys.stdout)
PY
```

## SDK (in published HTML)

```html
<link rel="stylesheet" href="$ORIGIN/sdk/shareout.css">
<script src="$ORIGIN/sdk/shareout-ui.js" defer></script>
<script src="$ORIGIN/sdk/shareout.js"></script>
<script>
(async () => { const sdk = await ShareOut.create(); })();
</script>
```

Prefer `ShareOut.create()`, `.so-` classes, and SDK methods over raw `/v1/data/…` from the sandbox.

## Data choice

```text
Simple state     → sdk.json
Structured rows  → sdk.table()
Realtime collab  → sdk.realtime()
Files            → sdk.blobs
Live systems     → sdk.connection / live-data
```

## Workspace admin

Members, subdomains, governance, marketplace, external sharing: load the full skill zip and
open `team/SKILL.md`. On self-host, **do not** use `team/billing.md` for checkout.

## Install ShareOut (new instance)

If there is no `$ORIGIN` yet:

1. Clone `https://github.com/getshareout/shareout`
2. Follow `skills/ShareOutSkill/deploy/SKILL.md` (and `deploy/cloudflare.md`)
3. Companion agent skills when available: **wrangler**, **cloudflare**, **durable-objects**

## Non-negotiables

- Resolve `$ORIGIN` before authenticated calls.
- No token → First Run above (or deploy skill if no instance).
- Prefer documented endpoints; do not invent request shapes.
- Self-host: no paid plan gates; roles + features only.
