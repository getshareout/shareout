# Configure a running ShareOut instance

For an agent configuring an instance **after** it is deployed and reachable. For the
deploy itself, read [SKILL.md](SKILL.md) first.

The instance tells you what is unset and what each unset thing turns off. You do not
have to know ShareOut's settings in advance — read the gaps, fix them, read again.

---

## What can and cannot be changed at runtime

This matters more than anything else here, so it comes first.

| Kind | Where it lives | Changed by |
|------|----------------|------------|
| Secrets (`OPENAI_API_KEY`, `CREDENTIALS_KEY`, `SESSION_SECRET`…) | Worker secrets | `npx wrangler secret put` |
| Vars (`SHAREOUT_BASE_URL`, `INSTANCE_ADMIN_EMAILS`…) | `wrangler.toml [vars]` | edit + redeploy |
| Bindings (D1, R2, KV, `EMAIL`, AI, Vectorize, Browser) | `wrangler.toml` | edit + redeploy |
| Feature flags | D1, per instance and per workspace | REST, takes effect immediately |

**A Worker cannot write its own secrets, vars or bindings.** There is no endpoint that
sets `OPENAI_API_KEY`, and any tool that claims to is wrong. Everything except feature
flags needs a `wrangler` command from a checkout with credentials, followed by a
redeploy. Plan for that: if you cannot run `wrangler`, you can *report* what is unset
but you cannot fix it — say so instead of pretending the change landed.

---

## 1. Authenticate

`/v1/admin/*` requires an instance admin. Two ways in:

- a browser session (a human on `/admin`), or
- a **personal** API token (`so_…`) whose owner is an instance admin:

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Authorization: Bearer $SHAREOUT_TOKEN"
```

Workspace agent tokens (`sot_…`) are **refused** here on purpose. They are scoped to one
workspace; letting one read instance configuration or provision workspaces would be a
privilege escalation. If you only hold an `sot_` token, you cannot configure the
instance — ask the operator for a personal token or for a human to open `/admin`.

Who counts as an instance admin: anyone in `INSTANCE_ADMIN_EMAILS`, or
`SETUP_ADMIN_EMAIL`, or — while neither is set — the earliest user to sign up.

---

## 2. Read the gaps

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Authorization: Bearer $SHAREOUT_TOKEN"
```

Returns the whole picture — `origin`, `schema`, `auth`, `ai`, `email`, `storage`,
`sharing`, `bindings`, `admins` — plus the part to act on:

```json
{
  "gaps": [
    {
      "setting": "VERCEL_AI_GATEWAY or OPENAI_API_KEY",
      "disables": "Crew AI, the home assistant, in-artifact chat, editor AI, knowledge distillation, auto-summaries",
      "fix": "npx wrangler secret put OPENAI_API_KEY (or VERCEL_AI_GATEWAY)"
    }
  ]
}
```

`fix` is the literal command or edit. Values are **presence only** — the response never
contains a secret, so it is safe to show an operator.

An empty `gaps` array means every optional setting this build reads is configured.

---

## 3. Apply each fix

The gaps you will actually meet, in the order they hurt:

| Gap | What stays broken until you fix it |
|-----|------------------------------------|
| `D1 schema` | Everything. No tables exist. `npx wrangler d1 migrations apply DB --remote` |
| `SHAREOUT_BASE_URL` | The skill and API docs hand agents the hosted instance's URLs instead of this one, so published content can land on someone else's server |
| `VERCEL_AI_GATEWAY` / `OPENAI_API_KEY` | Every AI feature is inert — crews, assistant, in-artifact chat, editor AI, summaries |
| `CREDENTIALS_KEY` | Per-workspace AI keys and stored connector credentials |
| `EMAIL` binding | Sent mail. One-time codes, invites and digests go to the Worker log. **Password sign-in still works**, which is why an instance is usable without it |
| `INSTANCE_ADMIN_EMAILS` | A stable owner. Until set, the earliest user is treated as admin |

Two of these have a full page each, because they are the ones that need an account
somewhere else: **AI provider** (`docs-site/self-host/ai.md`) and **Email**
(`docs-site/self-host/email.md`).

Secrets:

```bash
npx wrangler secret put OPENAI_API_KEY
openssl rand -hex 32 | npx wrangler secret put CREDENTIALS_KEY
```

Vars and bindings: edit `shareout-app/wrangler.toml`, then `npm run deploy`. Secrets
take effect immediately; vars and bindings need the redeploy.

---

## 4. Verify

Re-read the gaps and confirm the one you fixed is gone:

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Authorization: Bearer $SHAREOUT_TOKEN" \
  | jq '.gaps[].setting'
```

`/health` is the other check, and needs no auth:

```bash
curl -sS "$ORIGIN/health" | jq '{schema, warnings}'
```

`"schema": "ready"` with no `warnings` is the signal the instance is actually finished.

Do not report a setting as configured because the command exited 0. Read it back.

---

## 5. Feature flags — the one thing you can change over REST

Flags are stored in D1 and apply immediately, instance-wide or per workspace:

```bash
# turn a feature off for the whole instance
curl -sS -X POST "$ORIGIN/v1/admin/features" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"target":"global","key":"<feature>","value":false}'

# override it for one workspace
curl -sS -X POST "$ORIGIN/v1/admin/features" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"target":"<workspace_id>","key":"<feature>","value":true}'
```

`"value": null` clears an override and returns the flag to its default. Unknown keys are
rejected — list the real ones with `GET /v1/admin/features?target=global`.

---

## 6. Stand up people and workspaces

Also admin-only, also available to a personal token:

```bash
# a workspace for someone who may not have an account yet — they land in it on first sign-in
curl -sS -X POST "$ORIGIN/v1/admin/workspaces" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"name":"Marketing","owner_email":"lead@company.com"}'

# appoint owner / admin / member without being a member yourself
curl -sS -X POST "$ORIGIN/v1/admin/workspaces/$WORKSPACE_ID/members" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"email":"person@company.com","role":"admin"}'
```

Inviting people *into* a workspace you administer is a workspace-level operation and
lives in the workspace Admin → Members tab, not here.

---

## Checklist

- [ ] `GET /v1/admin/instance` returns `200` with your token
- [ ] `gaps` is empty, or every remaining gap is one the operator chose to leave
- [ ] `/health` reports `"schema": "ready"` with no warnings
- [ ] `SHAREOUT_BASE_URL` is this instance's own origin — check it, because getting it
      wrong sends agents and published URLs to another host
- [ ] An admin exists by name (`INSTANCE_ADMIN_EMAILS`), not by accident of sign-up order

Everything above is visible to a human at `/admin?view=instance`, which renders the same
data and the same fix commands.
