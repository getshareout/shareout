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
- Set `ADMIN_ALERTS_DISABLED=1` unless you configure Telegram ops alerts

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
