---
name: "shareout-skill"
version: "2.54.0"
updated_at: "2026-10-09T12:00:00Z"
description: "Publish, update, inspect, and manage ShareOut artifacts on a self-hosted instance. Use when the user wants to build or publish a web artifact (HTML apps, dashboards, forms, or CSV/Markdown/JSON/TXT), wire SDK data stores, live data, schedules, sharing, analytics, or in-artifact AI. If the user wants to INSTALL or DEPLOY ShareOut on Cloudflare first, load deploy/SKILL.md immediately."
skill_endpoint: "/v1/skill"
---

# ShareOut Skill

ShareOut is the workspace where AI work lives: publish HTML (and CSV/MD/JSON/TXT) artifacts
with persistent data, collab, connectors, and automation — on **your** instance.

**Source of truth:** this tree lives in the product repo at
`getshareout/shareout` → `skills/ShareOutSkill/` (see [../README.md](../README.md)).
Do not treat `getshareout/shareout-skill` as a second place to edit — that repo is a
**mirror / install surface**. Runtime copy for agents: `GET $ORIGIN/v1/skill`.

This file is the **use** skill (build & publish).  
**Install / deploy** a new instance? → stop and load **[deploy/SKILL.md](deploy/SKILL.md)** first.

---

## Talk to the user

The person you are helping is usually not technical. Every message you send them:

- **Reply in their language.** If they write in Spanish, answer in natural Spanish — and in
  Argentina use *vos* ("¿Querés que la publique?", not "¿Quiere usted…?"). Same for any
  other language: match theirs, never switch to English on your own.
- **No jargon.** Say "page" / "página", "link", "private" / "privada", "only you can see it"
  — not artifact, deploy, endpoint, slug, token, visibility, 401. Technical words are for
  your own reasoning, not their screen.
- **Always end with the link** when you published or changed something — the full URL, on
  its own line, and say who can open it (anyone / your team / only you).
- **Never paste a token, API key or `device_code` back into the chat**, and never ask them
  to paste one unless there is no other way. Keys go in `~/.shareout/credentials` or the
  connector, not in conversation.
- **Tell the truth about the result.** If the response has `visibility_downgraded: true`,
  the page is private — say so and why (the `notice`), never announce it as public.

If something goes wrong, see [If you get stuck](#if-you-get-stuck) — don't make them debug it.

---

## 0) Instance origin — resolve before any API call

ShareOut is **self-hosted only**. There is no public hosted API. Every example URL
in this tree uses **`$ORIGIN`** (scheme + host, no trailing slash) and
**`$ORIGIN_HOST`** (hostname only).

**Resolve origin (first match wins) — required before any API call:**

1. `~/.shareout/credentials` → `"origin"` field  
2. Env `SHAREOUT_ORIGIN` or `SHAREOUT_BASE_URL`  
3. User-stated instance URL  

If none of the above: **stop** and load [deploy/SKILL.md](deploy/SKILL.md) (or ask
the user for their instance URL). Do **not** invent a default host.

```json
// ~/.shareout/credentials  (preferred)
{
  "token": "so_…",
  "origin": "https://shareout.company.com"
}
```

| Call | URL |
|------|-----|
| API | `$ORIGIN/v1/...` |
| Skill zip | `GET $ORIGIN/v1/skill` |
| Skill version | `GET $ORIGIN/v1/skill/version` |
| SDK | `$ORIGIN/sdk/shareout.js` (+ `.css`, `shareout-ui.js`) — inside artifact HTML write `/sdk/…` |
| Smoke | `SHAREOUT_ORIGIN=$ORIGIN SHAREOUT_TOKEN=so_… npm run smoke:hello` |

---

## 1) Install vs use — first branch

| User intent | Load |
|-------------|------|
| Install, self-host, deploy to Cloudflare, set up domain/DNS/secrets, “get ShareOut running” | **[deploy/SKILL.md](deploy/SKILL.md)** (+ [deploy/cloudflare.md](deploy/cloudflare.md)) |
| Build / publish / update artifacts on an instance that already exists | Stay here |
| Cloudflare-only confusion (Workers, D1, custom domain) while deploying | deploy skill → Cloudflare companion skills listed there |

If there is no token **and** no reachable origin yet, you are in **install** territory —
load [deploy/SKILL.md](deploy/SKILL.md).

---

## Version check (against **their** origin)

Frontmatter `version` is this file (`2.54.0`).

1. `GET $ORIGIN/v1/skill/version` → `{ "version", "updated_at" }`.
2. If newer: download `GET $ORIGIN/v1/skill` (zip), replace local skill copy, continue.
3. If the instance has no skill endpoint yet (brand-new deploy mid-setup): use this repo copy and finish [deploy/SKILL.md](deploy/SKILL.md).

Shortcuts: `HEAD $ORIGIN/v1/skill` → `X-Skill-Version`; `If-None-Match` → `304` when unchanged.

---

## Feature model

**Every feature is on.** There is no checkout, no tier, and no paywall code path.
Workspace admin, external sharing, skill marketplace, subdomains and the rest are
product surfaces, not something to upgrade into.

Load [team/SKILL.md](team/SKILL.md) when the task is **workspace admin** work
(members, governance, marketplace, …) — because of what they are doing, never
because of a plan name.

Never ask “are you on Teams?”. Ask whether they need **workspace admin** or
personal artifacts. An instance owner narrows the surface per workspace under
**Admin → Features**, not by buying a plan.

---

## Agent loading protocol

1. Resolve `$ORIGIN` ([§0](#0-instance-origin--resolve-before-any-api-call)).
2. If install/deploy → [deploy/SKILL.md](deploy/SKILL.md).
3. Start with this file for product work.
4. Workspace admin / members / subdomain / governance / marketplace → [team/SKILL.md](team/SKILL.md).
5. Known workspace + token → `GET $ORIGIN/v1/skill?workspace={slugOrId}` for house-style `workspace-context.md`.
6. Route details via [INDEX.md](INDEX.md).

---

## First questions (product work)

1. What are they building? Dashboard, form, report, tool, doc, grid, presentation, automation.
2. Who uses it? Owner only, invited people, workspace members, or public.
3. What data? None, simple state, tables, files, live connectors, realtime.
4. After publish? Link, collect data, notify, schedule, metric alert, inbound email, AI chat.

**New artifact from scratch?** → [creating/overview.md](creating/overview.md).

---

## Routing

[INDEX.md](INDEX.md) maps intents → files.

- **Deploy / domain / Cloudflare** → [deploy/SKILL.md](deploy/SKILL.md)
- **Build new artifact** → [creating/overview.md](creating/overview.md)
- **Save / share / install a team skill** → [team/skill-marketplace.md](team/skill-marketplace.md)
- **Workspace admin** → [team/SKILL.md](team/SKILL.md)

---

## Data choice

```text
Simple state: theme, filters, last-opened -> sdk.json
Structured records: tasks, submissions, orders -> sdk.table()
Realtime editing: docs, boards, multiplayer UI -> sdk.realtime()
Files: images, PDFs, attachments -> sdk.blobs
Live external systems: REST, warehouses, Sheets -> sdk.connection / live-data
```

---

## SDK loading

```html
<head>
  <link rel="stylesheet" href="/sdk/shareout.css">
  <script src="/sdk/shareout-ui.js" defer></script>
  <script src="/sdk/shareout.js"></script>
</head>
<script>
(async () => {
  const sdk = await ShareOut.create();
})();
</script>
```

Rules:

- Load `/sdk/shareout.js` before `ShareOut.create()`. Keep it root-relative: the artifact's own host serves the bundle, so there is no placeholder left to substitute and no second origin on the critical path.
- Prefer `await ShareOut.create()` so the embedded Bearer token is ready.
- Use SDK methods inside published HTML — not raw `fetch` to `/v1/data/...` from the sandbox. See [sdk/live-data.md](sdk/live-data.md).
- Prefer `/sdk/shareout.css` and `.so-` classes. See [modules/ui/overview.md](modules/ui/overview.md).
- Do not use third-party CDN mirrors of the ShareOut SDK.

### Third-party libraries

Load them from the instance, not a public CDN:

```html
<script src="$ORIGIN/vendor/plotly.js-dist-min@2.35.2/plotly.min.js" defer></script>
<script src="$ORIGIN/vendor/d3@7/dist/d3.min.js" defer></script>
<link rel="stylesheet" href="$ORIGIN/vendor/leaflet@1.9.4/dist/leaflet.css">
```

`$ORIGIN/vendor/<npm package>@<version>/<file inside the package>` — the same layout
jsDelivr uses, so any `cdn.jsdelivr.net/npm/…` URL translates by dropping the host and
`/npm`. The instance fetches the bytes once, stores them and serves them immutable +
edge-cached, on a host the viewer is already connected to. Publishing rewrites
`cdn.plot.ly`, `d3js.org`, jsDelivr and unpkg URLs to this automatically, so an existing
artifact is never broken by writing the CDN URL — writing `/vendor/…` just skips the
translation.

If the library you need is not vendored yet (`GET $ORIGIN/v1/workspaces/{id}/vendor-packages`
lists what is), a workspace admin adds it with one call:

```bash
curl -X POST "$ORIGIN/v1/workspaces/$WS/vendor-packages" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"package":"highcharts"}'
```

Details and the instance-wide knobs (`VENDOR_PACKAGES_EXTRA`, `VENDOR_ALLOW_ANY`):
[team/libraries.md](team/libraries.md#public-npm-libraries-vendor) ·
[patterns/performance.md](patterns/performance.md#libraries-load-from-the-instance-not-a-public-cdn).

---

## HTML artifact rules

Publishing is never blocked by editor markers — but editor-ready HTML is the default for
anything the team will keep editing.

Editor-readiness checklist:

- `script type="shareout/manifest"` in `head` with valid JSON.
- Every `sdk.json` key and `sdk.table()` name declared in manifest `sources`.
- Dynamic content uses `data-shareout-binding` against declared sources.
- Pages: `data-shareout-page`; repeats: `data-shareout-template`.
- Interactive targets resolve (`data-shareout-link` / `data-shareout-action`).
- `default` sample data on sources (json, tables, **and** connections) so the visual editor previews without live fetches.

Publish returns advisory `editor_readiness` — summarize for the user; do not block.  
Full spec: [core/html-spec/overview.md](core/html-spec/overview.md).

---

## Design taste

Before visual work, read [modules/ui/taste.md](modules/ui/taste.md):

- Use the design system (`.so-` + tokens) first.
- Restraint: one accent, one type system, one primary action, real empty/error states.
- Avoid AI-slop tells (neon purple, three equal cards, eyebrow spam, fake-perfect metrics).

---

## Artifact types

| Type | Extensions | Use |
| --- | --- | --- |
| `html` | `.html`, `.htm` | Full SDK apps, dashboards, tools, presentations |
| `csv` | `.csv` | Sortable/filterable grids |
| `markdown` | `.md`, `.markdown` | Docs with TOC |
| `json` | `.json` | Tree viewer |
| `txt` | `.txt` | Plain text / logs |

Details: [api/artifact-types.md](api/artifact-types.md).

---

## First run — get a token (instance already up)

If install is not done, go to [deploy/SKILL.md](deploy/SKILL.md).

Authenticated calls need a token. If `~/.shareout/credentials` lacks a token for this origin:

> **How do you want to start?**  
> **A)** Sign in (Google device login or web UI) — invited users / real accounts.  
> **B)** Instant anonymous account — `POST $ORIGIN/v1/auth/create-account` (if enabled on instance).

### Path A — Device login (Google)

1. `POST $ORIGIN/v1/auth/device/start` optional `{ "expected_email" }`  
   → `{ device_code, user_code, verification_uri_complete, interval, expires_in }`.
2. User opens `verification_uri_complete`.
3. Poll `POST $ORIGIN/v1/auth/device/token` `{ "device_code" }` until `approved` + `token`.
4. Save `{ token, origin }` to `~/.shareout/credentials` (`chmod 600`). Honor any `warn`.

### Path B — Anonymous

1. `POST $ORIGIN/v1/auth/create-account` → `{ token, user_id }`.
2. Save credentials with `origin`.
3. Offer linking email/Google later so they can use the web UI.

Web UI path: user signs in at `$ORIGIN` → Settings → API token → paste to you.

All later requests: `Authorization: Bearer so_…` against **`$ORIGIN`**.

---

## Publishing

Build JSON however you want; prefer `curl` for the HTTP call (Cloudflare may block some HTTP clients):

```bash
ORIGIN=$(python3 -c "import json,os; c=json.load(open(os.path.expanduser('~/.shareout/credentials'))); print(c.get('origin') or os.environ.get('SHAREOUT_ORIGIN','$ORIGIN'))")
TOKEN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.shareout/credentials')))['token'])")
python3 build_payload.py | curl -sS -X POST "$ORIGIN/v1/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @-
```

Full API: [api/overview.md](api/overview.md).

---

## Workspace boundary

Personal artifacts can be private, collaborator-shared, or public. Load **team/** docs when
doing workspace administration or workspace-scoped features:

- Members, roles, domain allowlists  
- `visibility: "workspace"`  
- Workspace subdomains  
- House style / context files  
- Workspace schedules, marketplace, external client sharing, admin portal  

| Term | Meaning |
| --- | --- |
| `access_policy` | Row-level data filtering per viewer — [core/access-policy.md](core/access-policy.md) |
| Workspace membership | Who can join a workspace — [team/SKILL.md](team/SKILL.md) |
| Collaborator role | Artifact `owner` / `editor` / `viewer` |
| Workspace role | Workspace `owner` / `admin` / `member` |

---

## If you get stuck

Every error body carries `code`, usually a `hint` (what to do next), sometimes `docs`, and
always a `request_id`. Read them before retrying — never retry the same call blindly.
Codes and fields: [api/errors.md](api/errors.md).

| You see | Do this | Tell the user (in their language) |
|---------|---------|-----------------------------------|
| `401 UNAUTHORIZED` (`reason`: missing / invalid / revoked / expired) | Get a fresh key: the user opens `$ORIGIN/home?view=connect` (connector or API token), or run device login ([auth.md](auth.md)). Retry once. | "I need you to reconnect me to ShareOut — open this link and come back." |
| `403 FORBIDDEN` / `INSUFFICIENT_SCOPE` | Don't retry. The key or the person lacks access to that workspace/page. | "You don't have access to that space yet — ask its admin to invite you." |
| `429 RATE_LIMIT_EXCEEDED` / `RATE_LIMITED` | Wait until `Retry-After` / `reset`; batch work instead of looping. | "ShareOut asks me to wait until HH:MM before publishing again." |
| `201` with `visibility_downgraded: true` | It published, but private. Don't re-publish to "fix" it. | "It's published, but only you can see it for now, because …" (the `notice`) |
| `moderation` in the publish result, or `202 MODERATION_HELD` | Under automatic review; it goes public by itself when it clears. Don't re-publish. | "It's published and under a quick automatic review; it'll open to everyone on its own." |
| `SIGNUPS_PAUSED` | Use device login if they already have an account; otherwise they need an invite. | "This ShareOut only lets invited people in — ask whoever runs it for an invite." |
| Any `5xx`, or the same error twice after following its `hint` | Stop and file a ticket (below). | "Something broke on ShareOut's side. I've told the team (ticket #…)." |

**Ask a human — don't loop silently.** After **2 failed attempts** at the same step, or on
**any 5xx**, create a support ticket ([api/support.md](api/support.md)):

```bash
curl -sS -X POST "$ORIGIN/v1/support/tickets" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"subject":"Publish fails with INTERNAL_ERROR",
       "body":"User wanted: publish their sales dashboard.\nTried: POST /v1/publish twice.\nError: 500 INTERNAL_ERROR\nrequest_id: 8a1f…\nartifact_id: art_… (if any)"}'
```

Put in `body`: what the user wanted, what you tried, the error `code`, the `request_id`, and
the `artifact_id` if there is one. Then tell the user, in their language, that the ShareOut
team was notified and give them the ticket id — and stop retrying. Using the ShareOut
connector (`$ORIGIN/mcp`) instead of the REST API? Call its `report_problem` tool with the
same details.

---

## Non-negotiable rules

- Resolve `$ORIGIN` before authenticated calls; keep it in credentials.
- Prefer documented endpoints; do not invent request shapes.
- No token → First Run (or deploy skill if no instance).
- Verify artifact ids before update/delete.
- `ShareOut.create()` + SDK for live artifact data.
- Never `localStorage`/`sessionStorage` in a published artifact: it runs in an
  opaque-origin sandbox and both throw `SecurityError`. Use `sdk.json`.
- Design taste on anything visual.
- Speak the user's language, plainly, and end with the link ([Talk to the user](#talk-to-the-user)).
- Never loop on an error: follow its `hint`, then file a support ticket ([If you get stuck](#if-you-get-stuck)).
- Deploy/install → [deploy/SKILL.md](deploy/SKILL.md); do not improvise Cloudflare setup without [deploy/cloudflare.md](deploy/cloudflare.md).
