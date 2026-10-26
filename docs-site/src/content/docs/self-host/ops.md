---
title: Self-host ops
description: Upgrades, backups, and health checks for a self-hosted ShareOut Worker.
---

## Running the instance

`/admin` is the instance-owner portal. Access comes from any of:

| Source | Use |
|--------|-----|
| `INSTANCE_ADMIN_EMAILS` | Comma-separated emails. **The self-host way** — no source edit, no fork. |
| `SETUP_ADMIN_EMAIL` | The first admin, so they cannot lock themselves out. |
| `superadmin-recipients.json` | Ships empty. Optional if you prefer a committed roster (and it is where Telegram chat-id overrides live). |

While *nothing* names an admin, the earliest user is treated as one so a fresh
instance is never locked out. Naming anyone ends that fallback.

### Provision a customer workspace

Every new customer account goes through one call. It creates the workspace with its
slug (also its subdomain) and language, applies branding and policy defaults, creates
starter folders, invites the first admins with the normal invite email, and stores
any data connectors you give it — in one step, typically well under a minute of
operator time once the spec is written.

In the portal: **`/admin` → Instance → Provision a workspace**. From a file, with an
instance admin's personal token (`so_`; workspace Agent `sot_` tokens are refused):

```bash
cd shareout-app
cp scripts/provision-workspace.example.yaml acme.yaml   # edit it
SHAREOUT_ORIGIN=https://shareout.example.com \
SHAREOUT_ADMIN_TOKEN=so_... \
ACME_API_KEY=... \
node scripts/provision-workspace.mjs acme.yaml
```

The spec (YAML or JSON):

| Field | Meaning |
|-------|---------|
| `name`, `slug` | Required. The slug is the subdomain: 2–63 lowercase letters, digits, hyphens; reserved names (`www`, `api`, `admin`, `app`, …) are refused. |
| `locale` | `es` or `en` — invites, emails and the workspace speak it. |
| `admins` | Required. The first one owns the workspace (or set `owner_email`). Nobody has to have signed in yet. |
| `subdomain` | `true` turns on `<slug>.<your instance>`. |
| `branding` | `accent_color` (`#RRGGBB`), `hide_footer`, `logo` (`{ url }` fetched over https, or `logo_file` next to the spec). PNG/JPG/WEBP/SVG, max 512 KB. |
| `policy` | `allowed_domains`, `allowed_emails`, `external_sharing`, `guest_comments` (on the starter folders), `knowledge`, `features` (any key from `GET /v1/admin/features`). |
| `folders` | Starter folders, e.g. `[Clientes, Proveedores, Reportes]`. |
| `connectors` | Same body as `POST /v1/workspaces/{id}/connections`. Write secrets as `${ENV_VAR}`; the CLI fills them in from the environment so they never live in the file. |
| `templates` | Installs every instance-library template tagged with this name, once (a re-run skips templates the workspace already has). `pending` when no template carries the tag. |
| `custom_domain` | Attaches the hostname to the workspace and makes it primary once live. `pending` with the DNS records until it verifies, or while custom domains are off on the instance; re-run the spec to check again. |
| `if_exists` | `match` (default) adopts an existing slug only if its name matches; `update` adopts and renames; `fail` refuses. |

**Safe to re-run.** The run is keyed by slug: it fills in what is missing and reports
the rest `unchanged`. It never creates a second workspace, folder, membership or
connector, never resends a live invite (pass `resend_invites: true` to do it), and
never overwrites a stored connector credential — rotate those in the workspace.

**Reading the result.** The CLI prints, and the API returns, the workspace links, each
admin's invite status (`invited`, `already_invited`, `active`, `failed`; with the join
link when the email did not go out), one line per step (`created`, `updated`,
`unchanged`, `skipped`, `pending`, `failed`) and the next steps. If a step fails — a
logo URL that 404s, a connector the provider refuses — the others still run, the API
answers `207` and the CLI exits `2`. Fix the spec and run it again.

Validation errors come back before anything is written, in the standard envelope
(`code`, `param`, `hint`): `INVALID_SLUG`, `SLUG_RESERVED`, `SLUG_TAKEN` (409, a
different workspace already has the slug), `INVALID_EMAIL`, `ADMIN_OUTSIDE_POLICY`,
`PUBLIC_EMAIL_DOMAIN`, `INVALID_FEATURE`, `INVALID_COLOR`, `INVALID_LOGO`,
`LOGO_TOO_LARGE`, `LOGO_INVALID_CONTENT_TYPE`.

Every step writes an audit row (`workspace.provision.<step>`, plus one
`workspace.provision` for the run) with the acting admin's email. Credential values are
never returned, logged or audited.

### Stand up a workspace for a team

The owner does not have to have signed in yet — they land in it on first sign-in.

```bash
curl -sS -X POST "$ORIGIN/v1/admin/workspaces" \
  -H "Cookie: $ADMIN_SESSION" -H 'Content-Type: application/json' \
  -d '{"name":"Marketing","owner_email":"ana@acme.test"}'
```

### Appoint an admin on any workspace

You do not need to be a member of it.

```bash
curl -sS -X POST "$ORIGIN/v1/admin/workspaces/$WORKSPACE_ID/members" \
  -H "Cookie: $ADMIN_SESSION" -H 'Content-Type: application/json' \
  -d '{"email":"beto@acme.test","role":"admin"}'
```

Roles are `owner`, `admin`, `member`. Both calls are written to the workspace audit
log with the acting admin's email.

### Check what the instance is configured for

`GET /v1/admin/instance` (instance admin) answers it in one document — and, more
usefully, lists what is unset and what each gap disables:

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Cookie: $ADMIN_SESSION" | jq .gaps
```

```json
[
  {
    "setting": "VERCEL_AI_GATEWAY or OPENAI_API_KEY",
    "disables": "Crew AI, the home assistant, in-artifact chat, editor AI, knowledge distillation, auto-summaries",
    "fix": "npx wrangler secret put OPENAI_API_KEY (or VERCEL_AI_GATEWAY)"
  }
]
```

No secrets are returned — only whether each is present. An empty `gaps` array is the
signal that the instance is fully configured.

### Answer support requests

Every help request — the in-app **Help & support** panel, the Home assistant, the API,
Telegram, Slack, `support@` email — lands in one queue at `/admin?view=support`. Nothing
is pushed to you; you (or your agents) read the queue. Open a ticket to see its context
(category, severity, page, request id, browser), the thread and an AI-drafted reply, then
answer and set its status. The reply reaches the requester on the channel they used, by
email for in-app and API requests, and in their notification bell.

An agent can work the same queue with a personal API token created by an instance admin:

```bash
curl -sS "$ORIGIN/v1/support/tickets?scope=all&status=open&since=2026-10-09T00:00:00Z" \
  -H "Authorization: Bearer $SHAREOUT_ADMIN_TOKEN"

curl -sS -X POST "$ORIGIN/v1/support/tickets/$TICKET_ID/reply" \
  -H "Authorization: Bearer $SHAREOUT_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"body":"Fixed on our side — try again."}'
```

Full reference: the skill's `api/support.md` (section *Triage as super-admin*).

### AI providers

AI is **off until you supply a key**. Every AI surface degrades quietly rather than
erroring, which is why it is worth checking `gaps` rather than waiting to notice.

| Level | How | Applies to |
|-------|-----|------------|
| Instance | `npx wrangler secret put OPENAI_API_KEY` (or `VERCEL_AI_GATEWAY`) | Every workspace, billed to you |
| Workspace | `PUT /v1/workspaces/{id}/llm` `{provider, apiKey}` | That workspace only, billed to them |

Per-workspace keys are encrypted at rest and need `CREDENTIALS_KEY` set — the endpoint
refuses without it rather than storing something it cannot protect. The same secret
encrypts stored connector credentials.

### Multilingual Knowledge search

The original Knowledge indexes (`KNOWLEDGE_VECTORS`, `VECTORIZE`) embed with an
English-only model, so a Spanish question rarely finds an English document by meaning.
The multilingual index, `KNOWLEDGE_VECTORS_V2`, embeds with `@cf/baai/bge-m3` (or
`@cf/qwen/qwen3-embedding-0.6b` via `KNOWLEDGE_EMBED_MODEL`) and keeps one namespace per
workspace. Switching is done per step, and each step can be undone:

1. **Create** the index and its metadata indexes, in this order:

   ```bash
   npx wrangler vectorize create shareout-knowledge-v2 --dimensions=1024 --metric=cosine
   npx wrangler vectorize create-metadata-index shareout-knowledge-v2 --property-name=source_kind --type=string
   npx wrangler vectorize create-metadata-index shareout-knowledge-v2 --property-name=source_id --type=string
   npx wrangler vectorize create-metadata-index shareout-knowledge-v2 --property-name=embed_model --type=string
   ```

2. **Bind** it (uncomment `KNOWLEDGE_VECTORS_V2` in `wrangler.toml`) and deploy. New and
   changed passages, notes and pages are now written to both indexes; searches still read
   the old ones.
3. **Backfill** what already exists, from the stored text (nothing is re-fetched). One paced
   Workflow per workspace; call again with `after=<next>` until `next` is `null`:

   ```bash
   curl -sS -X POST "$ORIGIN/v1/admin/knowledge/vectors/backfill?limit=10" \
     -H "Authorization: Bearer $SHAREOUT_ADMIN_TOKEN"
   ```

   One workspace: `POST /v1/workspaces/{id}/knowledge/vectors/backfill`. Progress:
   `GET /v1/workspaces/{id}/knowledge/vectors` — a workspace is covered when
   `workspace.chunks.missing` is 0 and `workspace.passes` names the model. Reruns only embed
   what is missing; the 03:00 UTC knowledge pass also starts a few for workspaces with gaps.
   It is metered like ingest (`knowledge_embedding`, source `vectors-backfill`): bge-m3 costs
   $0.012 per million tokens.
4. **Cut over**: set `KNOWLEDGE_VECTORS_READ = "v2"` and deploy. Each workspace reads the new
   index once it is covered and keeps reading the old one until then; an empty answer
   from the new index also falls back. Unset the variable to roll back.

Changing `KNOWLEDGE_EMBED_MODEL` later works the same way: deploy, backfill, and reads stay on
the old index until the new model covers a workspace. If you recreate the index, backfill
with `{"reset": true}` (per workspace) or `&reset=1` (admin) so every vector is written again.

## Upgrades

1. Pull the latest public release (or re-export sync if you mirror privately).
2. From `shareout-app/`:

   ```bash
   npm ci
   npm run db:migrate:prod          # apply new D1 migrations
   npm run deploy                   # or deploy:with-migrations
   ```

3. Smoke: open `/home`, publish with `npm run smoke:hello` if you keep a token handy.

Always apply D1 migrations **before** relying on new schema in a deploy.

## Backups

| Store | Suggestion |
|-------|------------|
| D1 | Periodic `wrangler d1 export` (or Cloudflare’s backup features when available) |
| R2 | Bucket versioning / sync to a second bucket |
| Durable Objects | Application-level export of critical tables; DOs are not a single SQL dump |

Test a restore on a staging worker before you need it.

## Observability

- Worker logs: `npx wrangler tail`
- In-product: Admin → Health (when signed in as admin), if enabled on your build
- There is no super-admin notification channel — use `/admin?view=health` and Worker logs

### Server-Timing

Signed-in requests to `/home`, `/v1/home/*`, `/v1/artifacts` and `/v1/artifacts/*` answer
with a `Server-Timing` header that breaks the request down by phase. Anonymous requests
get no header. Values carry only phase names, counts and milliseconds — no ids or data.

```http
Server-Timing: auth;dur=12, host;dur=4, d1;desc="9 calls, 3 waves";dur=41, kv;desc="1 calls, 1 waves";dur=3, app;dur=63
```

| Entry | Meaning |
| --- | --- |
| `auth` | Resolving the session or API token |
| `host` | Looking up the workspace for a subdomain |
| `render` | Building the `/home` document |
| `d1` | D1 statements: `calls`, `waves` (rounds of queries that ran one after another — the number that drives latency) and busy ms |
| `kv` | KV reads, same format |
| `app` | Total time in the Worker |

To read it, open DevTools → **Network**, select the request, and open the **Timing**
tab: Chrome and Edge list the entries under *Server Timing*. Or from a shell:

```bash
curl -sS -o /dev/null -D - "$ORIGIN/v1/home/activity-feed" -H "Cookie: $SESSION" | grep -i server-timing
```

`/home` streams its HTML, so its header only covers the work before the first byte. The
full breakdown, including the page's own queries and render, is at the end of the document
as an HTML comment: `<!-- server-timing: … -->` (view source and scroll to the bottom).

Workers clocks only advance across I/O, so a CPU-only phase such as `render` can read
close to 0 in production.

## Security basics (pre-public checklist)

Before exposing an instance to the internet:

- Rotate any secret that ever leaked into a gist or chat
- Keep `SESSION_SECRET` long and unique per instance
- Prefer private artifacts + auth until you understand open visibility
- Review Cloudflare WAF / bot settings on your zone
- Report product vulns via the repo [SECURITY.md](https://github.com/getshareout/shareout/blob/main/SECURITY.md)

A deeper threat-model pass (admin bridges, rate limits, sandbox) should land
before a widely announced OSS launch — treat this page as operator hygiene, not
an audit report.
