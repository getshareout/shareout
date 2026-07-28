# Cloudflare setup for ShareOut

This is the **only** part that is inherently Cloudflare-specific. Everything else is
`npm` + this repo. Prefer loading companion skills (**wrangler**, **cloudflare**,
**workers-best-practices**, **durable-objects**) and the official docs links below
over guessing CLI flags.

**Install orchestration lives in [SKILL.md](SKILL.md)** — especially *Working in this
repo*, Path A/B, and *Second instance on the same account*. This file is the CF resource
checklist; do not skip `npm run deploy` / `provision:cf`.

---

## What ShareOut needs on Cloudflare

| Resource | Required? | Template name / binding | Why |
|----------|-----------|-------------------------|-----|
| Workers (script) | **Yes** | `name = "shareout"` | App + API |
| **Workers Paid** | **Yes** (practical) | account plan | Durable Objects |
| D1 | **Yes** | `shareout-db` → `DB` | Users, artifacts, metadata |
| R2 | **Yes** | `shareout-artifacts` → `ARTIFACTS` | HTML/files blobs |
| KV ×3 | **Yes** | `SLUGS`, `RATE_LIMIT_KV`, `PROXY_CACHE` | Slugs, rate limits, proxy cache |
| Durable Objects ×7 | **Yes** | REALTIME, COMMENTS, MINIDB, CHAT, … | Tables, collab, chat, presence |
| `SESSION_SECRET` | **Yes** | secret | Sessions + tokens |
| `SHAREOUT_BASE_URL` | **Yes** | var | Public origin of this instance |
| Custom domain | Optional | zone route / custom domain | Company URL |
| Email binding | Optional | `EMAIL` | OTP/mail vs logs |
| Workers AI / Vectorize | Optional | `AI`, `VECTORIZE` | Semantic search |
| Browser Rendering | Optional | `BROWSER` | Thumbnails |
| Queues | Optional | analytics views queue | Async analytics |

OSS template: [`shareout-app/wrangler.toml`](../../../shareout-app/wrangler.toml).

---

## Companion agent skills (load these)

| Skill name | Use for |
|------------|---------|
| [wrangler](https://developers.cloudflare.com/workers/wrangler/) | `wrangler login`, `secret put`, `d1 create`, `deploy`, `tail` |
| [cloudflare](https://developers.cloudflare.com/workers/) | Workers platform, storage, networking |
| workers-best-practices | Binding/secrets review, anti-patterns |
| durable-objects | DO classes, migrations, SQLite DO behavior |
| cloudflare-email-service | Real outbound email for OTP |

If the agent environment uses Claude Code / skills marketplace, install or enable the
same names so the agent has current CLI and config guidance.

---

## Official Cloudflare docs (bookmark)

| Task | Doc |
|------|-----|
| Workers + first deploy | https://developers.cloudflare.com/workers/get-started/guide/ |
| Wrangler config | https://developers.cloudflare.com/workers/wrangler/configuration/ |
| Deploy button | https://developers.cloudflare.com/workers/platform/deploy-button/ |
| Custom domains | https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ |
| Routes | https://developers.cloudflare.com/workers/configuration/routing/routes/ |
| D1 | https://developers.cloudflare.com/d1/get-started/ |
| R2 | https://developers.cloudflare.com/r2/get-started/ |
| KV | https://developers.cloudflare.com/kv/get-started/ |
| Durable Objects | https://developers.cloudflare.com/durable-objects/get-started/ |
| Secrets | https://developers.cloudflare.com/workers/configuration/secrets/ |
| Pricing / Paid | https://developers.cloudflare.com/workers/platform/pricing/ |
| Email Workers | https://developers.cloudflare.com/email-routing/email-workers/ |

---

## Account prerequisites

**No account yet?** Agents: follow [SKILL.md — Path 0](SKILL.md#path-0--no-cloudflare-account-yet-agent--human)
(signup → Workers Paid → `wrangler login`). Companion **cloudflare** / **wrangler** skills
cover CLI after login; they do **not** create the account for the user.

1. Cloudflare account (email verified) — signup:
   https://dash.cloudflare.com/sign-up/workers-and-pages
2. **Workers Paid** subscription — Durable Objects are not available on free Workers
   in a way that runs full ShareOut. Pricing:
   https://developers.cloudflare.com/workers/platform/pricing/
3. `npx wrangler login` (or API token with Workers/D1/R2/KV edit) — verify with
   `npx wrangler whoami`.
4. Optional: domain already on Cloudflare for custom hostnames.

**Name collision:** if this account already runs ShareOut under the default names
(`shareout`, `shareout-db`, `shareout-artifacts`), rename in `wrangler.toml` before
`provision:cf` — see [SKILL.md — Second instance](SKILL.md#second-instance-on-the-same-account).

---

## Custom domain

After the worker works on `*.workers.dev`:

1. Cloudflare dashboard → Workers & Pages → **shareout** → **Settings → Domains & Routes**
   → **Add** → Custom domain (e.g. `shareout.company.com`).
2. Ensure DNS is on Cloudflare (or CNAME as instructed).
3. Set:

   ```toml
   SHAREOUT_BASE_URL = "https://shareout.company.com"
   ```

4. Redeploy (or update var in dashboard and trigger a new deployment).
5. Re-run smoke with `SHAREOUT_ORIGIN=https://shareout.company.com`.
6. If Google OAuth is enabled, update the OAuth client's authorized redirect URI to
   `https://shareout.company.com/auth/callback`.

Docs: https://developers.cloudflare.com/workers/configuration/routing/custom-domains/

---

## Workspace subdomains

Workspaces can publish under `https://{workspace-slug}.{your-apex}/…` when DNS allows it.

1. Apex app host = `SHAREOUT_BASE_URL` (e.g. `shareout.company.com`).
2. Add a **wildcard** DNS record `*.shareout.company.com` (or `*.company.com` if apex is
   the app) pointing at the same Worker / custom domain setup Cloudflare documents for
   multi-tenant Workers.
3. Confirm SSL covers the wildcard.
4. Create a workspace in the UI and set/use its subdomain; open
   `https://{slug}.shareout.company.com/…`.

If you skip wildcards, use path-style URLs only (`$ORIGIN/a/{slug}/`) — still fully valid.

Product behavior: [../team/subdomain.md](../team/subdomain.md).

---

## Optional Email (OTP that isn't in logs)

Without Email:

- Codes appear in `npx wrangler tail` (fine for solo admin bootstrap).

With Email:

1. Load **cloudflare-email-service** skill or follow Email Routing / Email Workers docs.
2. Uncomment / add `[[send_email]]` binding in `wrangler.toml` as supported by current
   Wrangler.
3. Set `EMAIL_DEFAULT_FROM` to an allowed from-address.
4. Test `/setup` or login OTP.

---

## Optional ARTIFACT_ORIGIN (CDN split)

Default self-host: artifacts served **same zone** as the app (simplest).

Hardening: serve untrusted HTML from a second hostname:

1. Second custom domain or workers route for content.
2. Set `ARTIFACT_ORIGIN=https://cdn.company.com` (no trailing slash).
3. Redeploy; verify published pages load SDK from `SHAREOUT_BASE_URL`.

---

## Secrets & vars cheat sheet

```bash
# Required
openssl rand -hex 32 | npx wrangler secret put SESSION_SECRET

# Optional Google SSO
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET

# Vars (dashboard or wrangler.toml [vars])
# SHAREOUT_BASE_URL=https://…
# SETUP_ADMIN_EMAIL=you@company.com
# ADMIN_ALERTS_DISABLED=1
# ARTIFACT_ORIGIN=https://…   # optional
```

Full table: [self-host secrets](../../../docs-site/src/content/docs/self-host/secrets.md).

---

## Verify Cloudflare side is healthy

```bash
npx wrangler whoami
npx wrangler deployments list
npx wrangler d1 migrations list DB --remote
npx wrangler tail     # while hitting /setup OTP
```

Then product smoke: [SKILL.md](SKILL.md#post-deploy-always).
