# ShareOut feature inventory

Every product surface in this repo (105), with its code entry point and its current
self-host state. Last re-verified against `main` on 2026-07-26. This is the **work queue for polish**: one agent takes one row,
verifies it end to end on a fresh self-hosted instance, and fixes what it finds.

Each row has a stable ID (`S01`…). Reference it in branch names and PR titles —
`polish/S14-crew-ai`, `fix(S03): ...`.

**Landed so far.** The six tracks: #42 (instance origin), #44 (paywall removal), #45
(password sign-in), #46 (first-run schema state), #47 (instance owner controls), #48
(instance config surface). Then the polish sweep: #51 (SDK origin), #52 (onboarding),
#53 (outbound footers), #54 (CORS), #55 (/create URL bar), #57 (password-artifact
redirect), #58 (workspace pages), #59 (ingest email), #61 (assistant inbox + Slack
subdomains), #62 (moderation domains), #63 (editor publish + upload URLs), #67
(crawl/agent discovery + plan vocabulary), #70 (admin instance view + Settings inbox),
#72 (agent-readable instance config), #74 (editor data origin + card share URLs).

**Most of those defects were not rows in this table.** They were found by grepping
`src/` for `shareout.site` and asking, per hit, "does this reach an outsider or gate
something functional?" — which produced roughly one real bug per file. A row-by-row
read of a feature list did not surface them. Treat this table as a map of *surfaces*,
not as the bug list.

**Status legend**

| | Meaning |
|---|---|
| ✅ | Works self-hosted with no founder-hosted assumptions. Polish = UX/docs only. |
| ⚠️ | Works, but carries hosted-only assumptions, dead plan/tier vocabulary, or an unverified first-run path. |
| ⛔ | Broken or misleading for a self-hoster as shipped. Fix before v0.1.0. **None open.** |

Status started as a code-read judgement. Rows re-verified on 2026-07-26 say so; later
polish closed more ⚠️ (LLM/email docs, warehouse pages, WhatsApp stub removal, deliberate
opt-in flags). Remaining ⚠️ are mostly **deploy rehearsal** (S01, S36) and **policy**
(S40). The first job on any row is still to confirm or correct it — including the ✅ ones.

**Definition of done for a row** — the polish checklist every agent applies:

1. Works on a fresh instance with only `SESSION_SECRET` + `SHAREOUT_BASE_URL` set,
   or fails with a message that names the exact missing env var and the command to set it.
2. No hardcoded `shareout.site`, `shareoutcdn.site`, founder emails, or plan/tier gating.
3. Empty state, loading state, and error state all render something a human understands.
4. Reachable and drivable by an agent through the REST API or the skill — not UI-only.
5. Documented in `docs-site/` (EN + ES) and, where an agent needs it, in `skills/ShareOutSkill/`.
6. One test covering the path that would break silently.

---

## A. Instance foundation

The layer a self-hoster touches in the first ten minutes. Highest leverage in the repo.

| ID | Surface | What it is | Entry point | State |
|----|---------|------------|-------------|-------|
| S01 | Deploy to Cloudflare | Button → Worker + D1 + R2 + KV + DO provisioning | `shareout-app/wrangler.toml`, `README.md` | ⚠️ never verified on a fresh Workers Paid account |
| S02 | Agent deploy skill | Agent-driven install: login, bindings, secrets, DNS, smoke | `skills/ShareOutSkill/deploy/` | ✅ written, unverified end to end |
| S03 | First-boot setup | Empty `users` table → `/setup` → first admin | `src/pages/setup.ts`, `src/router/serve-router.ts` | ✅ creates the admin inline (#45) and reports missing D1 schema (#46) |
| S04 | Sign-in — email OTP | 6-digit code, 10-min TTL, rate limited | `src/auth-otp.ts` | ✅ no longer the default path (#45); the login page says plainly when codes only reach the log |
| S05 | Sign-in — Google OAuth | Optional SSO + One Tap + device flow | `src/auth/google-oauth.ts`, `google-one-tap.ts`, `device-auth.ts` | ✅ optional, correctly detected |
| S06 | Sign-in — password | PBKDF2-SHA256, first-admin bootstrap, set/change | `src/auth/password.ts`, `auth/password-routes.ts` | ✅ added in #45 |
| S07 | Sessions & cookies | Signed session cookie, host-only in dev | `src/auth/session.ts`, `cookies.ts` | ✅ |
| S08 | Account linking | Link Google / email to a token-only account | `src/account-links.ts` | ✅ |
| S09 | Agent & API tokens | `so_` personal tokens, `sot_` workspace service accounts | `src/api-me-tokens.ts`, `src/agent-tokens.ts`, `src/workspaces-tokens.ts` | ✅ |
| S10 | Superadmin portal | `/admin` — overview, health, costs, artifacts, traffic, funnel, LLM tokens, operations, users, moderation, support, features, audit, storage, **instance** | `src/superadmin/`, `views/config.ts`, `views/bodies/instance.ts` | ✅ the Instance view (#70) renders config + gaps and calls the #47 write API; Settings links admins to it |
| S11 | Instance owner controls | Create workspaces, appoint workspace admins, grant instance admin | `src/router/api/admin.ts`, `src/superadmin/workspaces-provision.ts` | ✅ create + appoint now have UI (#70); workspace-level member management (invite, role change, remove, pending invites) was already complete. Remaining: instance-wide deactivate exists as `revokeUserAccess` with no UI |
| S12 | Feature flags | 28 toggles, platform + per-workspace | `src/features/registry.ts`, `flags.ts` | ✅ the best-designed config surface in the repo |
| S13 | Env / origin config | Derive every host from `SHAREOUT_BASE_URL` | `src/config/origins.ts`, `auth-providers.ts` | ✅ the fallback is deliberate, and no longer silent: `/health`, `/setup` and `/admin?view=instance` each say when it is unset. `isMarketingApex()` (#67) gates the surfaces that only make sense on the hosted apex |
| S14 | Tiers | — | — | ✅ removed in #44. `users.tier` is inert; nothing reads it |

## B. Workspace shell (the daily UI)

The left rail, in nav order. Ships EN + ES, follows browser locale.

| ID | Surface | Nav label | Entry point | State |
|----|---------|-----------|-------------|-------|
| S15 | Overview / Brief | Brief | `src/pages/home/`, `render-workspace/` | ✅ |
| S16 | All artifacts | All Artifacts | `home-views/artifacts-browser.ts`, `src/folders.ts` | ✅ card share URLs named the hosted domain until #74 |
| S17 | Schedules | My Schedules | `home-views/schedules.ts`, `src/scheduling/` | ✅ |
| S18 | Alerts | My Alerts | `src/metric-alerts/`, `src/metric-watch/` | ✅ |
| S19 | Analytics | Analytics | `home-views/analytics.ts`, `src/analytics.ts`, `view-tracking.ts` | ✅ |
| S20 | Datasets | Datasets | `home-views/datasets.ts`, `src/data/datasets/` | ✅ |
| S21 | Catalog | Catalog | `home-views/catalog.ts`, `src/catalog/` (lineage, manifest, search, seed) | ✅ |
| S22 | Knowledge | Knowledge | `home-views/knowledge.ts`, `src/knowledge/` (ingest, distill, consolidate) | ✅ |
| S23 | Crew AI | Crew AI | `home-views/crew.ts`, `src/crew/` — 24 tools, triggers, approvals, run loop | ✅ inert without an LLM key, by design and visibly: `/v1/admin/instance` names it (#48), and `self-host/ai.md` documents both providers, failover and per-workspace keys |
| S24 | Library | Library | `home-views/library.ts`, `src/workspace-library.ts` — versioned private JS modules | ✅ |
| S25 | Files / Assets | Assets | `home-views/assets.ts`, `src/assets/`, `src/data/blobs/` | ✅ |
| S26 | Connectors | Connectors | `home-views/connectors.ts`, `src/data/connections/` | ✅ |
| S27 | Workspace Admin | Admin | `home-views/admin.ts`, `src/router/api/workspace-*.ts` | ✅ members, roles, domain allowlist, session policy, audit. Settings showed a file-inbox address on the hosted domain until #70 |
| S28 | Following / Clients | Following | `home-views/clients.ts`, `src/sharees/` | ✅ |
| S29 | Deliveries view | — | `home-views/deliveries.ts` | ✅ |
| S30 | Onboarding checklist | — | `src/onboarding/` (state, tasks, status, welcome-email) | ✅ capability-aware since #52 — it could not reach 100% on an instance without email or AI |
| S31 | Starter kit seeding | — | `src/starter-kit/` | ✅ personal + team example artifacts, idempotent |
| S32 | Home chat agent | "Ask your space" | `src/chat-agent/` + `src/router/api/home-agent.ts` — 17 tools | ✅ same LLM path as S23 (`self-host/ai.md`); founder inbox address fixed in #61 |

## C. Artifact lifecycle

| ID | Surface | What it is | Entry point | State |
|----|---------|------------|-------------|-------|
| S33 | Publish API | `POST /v1/publish` — versioned bundle upsert | `src/publish/`, `src/publish.ts` | ✅ |
| S34 | Create with AI | Chat-first builder at `/create` | `src/pages/create.ts`, `create-gate.ts` | ✅ works when enabled; **`ai.create` defaults off** on purpose (high token cost) — turn on under Admin → Features after setting an LLM key (`self-host/ai.md`). Mock URL bar is instance-local (#55) |
| S35 | Visual editor | WYSIWYG at `/a/{slug}/edit`, Y.js collab, Ask AI | `editor-client/`, `src/editor/`, `editor-serve.ts` | ✅ **after three instance bugs**: publish returned another instance's URL and uploaded images embedded one (#63), and `EDITOR_CONFIG.baseUrl` sent credentialed data reads to the hosted host (#74) |
| S36 | Serving | R2 serve, canonical / namespaced / embed, sandbox iframe | `src/serve/`, `src/router/serve-router.ts` | ⚠️ **unverified**, not known-broken: the same-zone (no `ARTIFACT_ORIGIN`) sandbox path has never been exercised on a real instance |
| S37 | Viewers | CSV, Markdown, JSON, TXT | `src/viewers/` | ✅ |
| S38 | Versions & restore | Version list, deploy, soft delete, restore | `src/artifacts/` | ✅ |
| S39 | Publish approval | N nominated approvers before public, tied to content hash | `src/publish-approval.ts` | ✅ |
| S40 | Moderation | URL scan, abuse reports, rescan, notify | `src/moderation/` | ⚠️ the classifier's own-domain list is env-derived (#62) and bandwidth auto-pause is fixed (#44). Open question is policy, not code: a private instance may want it off by default |
| S41 | Screenshots | Puppeteer card thumbnails | `src/screenshots.ts` | ✅ already degrades — `if (!env.BROWSER) return null` at both entry points. The earlier ⚠️ was wrong |
| S42 | Present mode | Deck / presenter view | `src/present/`, `src/pages/slides-analytics.ts` | ✅ |
| S43 | PWA | Per-artifact manifest + install | `src/pwa.ts` | ✅ |

## D. Data plane

| ID | Surface | What it is | Entry point | State |
|----|---------|------------|-------------|-------|
| S44 | SDK tiers | `sdk.json` → `sdk.table()` → `sdk.realtime()` | `sdk/src/stores/` | ✅ |
| S45 | Blobs / files | Binary uploads per artifact | `src/data/blobs/`, `data/files/` | ✅ |
| S46 | Comments | Threaded in-artifact comments + notify | `src/data/comments/`, `comment-notify.ts` | ✅ |
| S47 | Realtime | Y.js Durable Object coordinators | `src/realtime/`, `src/data/minidb.ts` | ✅ requires Workers Paid — say so louder |
| S48 | Datasets | Governed inputs for artifacts + agents | `src/data/datasets/` | ✅ |
| S49 | Connections | Workspace credentials, SQL guard, rate limiter, cache | `src/data/connections/` | ✅ |
| S50 | Data Platform providers | BigQuery, Snowflake, Google Sheets, Google Analytics, Google Ads, Facebook Ads, Shopify, Tienda Nube, Slack | `src/data/platform/providers/` | ✅ all 9 have a docs page (BigQuery and Snowflake added). Each OAuth provider still needs the self-hoster's own client credentials, which each page now states |
| S51 | Sheets sync engine | Two-way Google Sheets | `src/data/sheets/` | ✅ |
| S52 | Slides backend | Deck data model | `src/data/slides/` | ✅ |
| S53 | Python (Pyodide) | In-browser execution | SDK `python-store` | ✅ |
| S54 | Secrets proxy | Artifact-scoped secrets | `src/data/secrets/` | ✅ |
| S55 | Access policy | Row-level filtering per viewer | `src/data/access-policy.ts`, `src/workspaces/access-policy.ts` | ✅ |
| S56 | Materialize | Persist artifact data to a warehouse table | `src/data/materialize.ts` | ✅ |
| S57 | GitHub export | Export / sync artifacts to a repo | `src/data/github/` | ✅ |
| S58 | CORS proxy | Artifact → external API | `src/proxy.ts`, `cors.ts` | ✅ the allowlist refused the instance's own origin until #54; the no-`Origin` fallback claimed the hosted host until #74 |

## E. Automation

| ID | Surface | What it is | Entry point | State |
|----|---------|------------|-------------|-------|
| S59 | Scheduled jobs | Cron-triggered artifact jobs | `src/scheduling/jobs/`, `handler.ts` | ✅ |
| S60 | Event triggers | artifact updated / viewed / comment added | `src/scheduling/jobs/event-triggers.ts` | ✅ |
| S61 | Crew AI runs | Multi-step agents: tools, triggers, approvals, limits, eval | `src/crew/` | ✅ same as S23 — inert without an LLM key, documented |
| S62 | Metric alerts | Rules over metric sources | `src/metric-alerts/` | ✅ |
| S63 | Metric watch | Watch a number, alert on change | `src/metric-watch/` | ✅ |
| S64 | Delivery destinations | Slack, Discord, Telegram, webhook, email, HTTP GET, materialize, sheets-append, asset | `src/delivery/destinations/` | ✅ 1:1 with `dest.*` flags |
| S65 | Run inspector | Run drawer, per-run logs | `src/runs/`, `src/pages/runs.ts` | ✅ |
| S66 | — | — | — | ✅ **removed.** What lived here was a single deployment's bespoke moderation pipeline, not a product feature: a Durable Object every self-hoster provisioned, a delivery destination bound to one external service, and its docs. Gone from code, wrangler bindings, the DO migration list, the job-action enum, both OpenAPI specs, the skill and the docs site |

## F. AI surfaces

| ID | Surface | What it is | Entry point | State |
|----|---------|------------|-------------|-------|
| S67 | In-artifact visitor chat | Visitor-facing assistant | `src/data/agent/` | ✅ same LLM path as S23; flag `ai.visitor_chat` on by default |
| S68 | Editor AI assistant | Rewrite / shorten / translate / fix | `editor-client/` + `src/editor/` | ✅ same LLM path as S23; flag `ai.editor_chat` on by default |
| S69 | Telegram bot | Account-level chat agent + connect flow | `src/telegram/`, `chat-platforms/telegram/`, `src/pages/telegram-connect.ts` | ✅ its help text told every self-hoster's users to "summarize the Acme adoption report" and try `/workspace acme` until #82 |
| S70 | Slack bot | DM chat agent, share handler, connect flow | `src/slack/`, `chat-platforms/slack/`, `src/pages/slack-connect.ts` | ✅ **`ai.slack_bot` defaults off** on purpose — needs a Slack app + OAuth; enable under Features after `docs-site` guides/slack-bot |
| S71 | — | — | — | ✅ **removed** in #77. WhatsApp was a non-product stub under `chat-platforms/whatsapp/`; code, registry entry, and UI ads are gone. Link-preview crawlers still match the WhatsApp UA (serve only) |
| S72 | LLM provider config | Instance key or per-workspace BYO key | `src/data/agent/anthropic.ts`, `src/router/api/workspace-llm.ts` | ✅ documented, and `/v1/admin/instance` says when it is unset and what that disables (#48) |
| S73 | Knowledge for agents | Ingest → distill → consolidate | `src/knowledge/`, `knowledge-context.ts` | ✅ |
| S74 | Skill marketplace | Per-workspace skill artifacts, vote, install, pin | `src/skill-marketplace.ts`, `src/official-skills/` | ✅ |

## G. Sharing & delivery

| ID | Surface | What it is | Entry point | State |
|----|---------|------------|-------------|-------|
| S75 | Visibility model | private / workspace / public + artifact password | `src/visibility-config.ts`, `src/serve/access.ts`, `src/access/allow-open.ts` | ✅ |
| S76 | Collaborators | owner / editor / viewer per artifact | `src/router/api/artifacts.ts` | ✅ |
| S77 | Sharee portal | External client portal, grants, tokens, activity | `src/sharees/` | ✅ |
| S78 | Access requests | Request → approve access to an artifact | `src/router/api/access-requests.ts` | ✅ |
| S79 | Custom subdomains | `team.example.com` → workspace | `src/subdomain.ts`, `src/enterprise.ts` | ✅ paywall gone (#44), `docs-site/self-host/domain.md` covers DNS + zone, and subdomain detection is env-derived (#57, #61) |
| S80 | Workspace invites | Email invite + copy-link invite + accept page + auto-join by domain | `src/workspaces/invite.ts`, `invites-admin.ts`, `invite-accept-page.ts` | ✅ no longer email-dependent — **Copy link** on a pending invite mints a join URL (`resend` with `notify:false`) and returns it. The claim is hashed at rest, so before this the code was unrecoverable the instant the send failed |
| S81 | Email gateway | One chokepoint: audience, prefs, suppressions, unsubscribe | `src/email/gateway.ts`, `catalog.ts`, `layout.ts` | ✅ `self-host/email.md` documents the binding, the sender var, and Cloudflare's verified-destination rule — the usual reason a correct config still sends nothing |
| S82 | Artifact email | Send templated email with artifact data | `src/delivery/destinations/email.ts`, `src/scheduling/email.ts` | ✅ bypasses the lifecycle gateway by design |
| S83 | Inbound email | Artifact receives mail; workspace ingest | `src/email/inbound.ts`, `inbox-store.ts`, `workspace-ingest.ts` | ✅ Email Routing + `EMAIL_INBOX_DOMAIN` documented in `self-host/email.md`; the Settings address hides itself when the binding is absent (#70) |
| S84 | Weekly digest | Scheduled workspace digest | `src/email/weekly-digest.ts`, `lifecycle-cron.ts` | ✅ |
| S85 | Unsubscribe & prefs | Per-category opt-out, suppression list | `src/email/preferences.ts`, `suppressions.ts`, `unsubscribe-token.ts` | ✅ |

## H. Operations

| ID | Surface | What it is | Entry point | State |
|----|---------|------------|-------------|-------|
| S86 | Observability | Per-hour metrics, alerts, digest, health view | `src/observability/` | ✅ the empty roster is deliberate and documented in the file itself — a fork must not ship someone's chat id. Admins come from `SETUP_ADMIN_EMAIL` / `INSTANCE_ADMIN_EMAILS` |
| S87 | Audit log | Workspace + platform audit trail | `src/audit.ts`, `src/router/api/workspace-audit.ts` | ✅ |
| S88 | Storage quota | Env-driven caps, per-file limit | `src/storage-quota.ts` | ✅ unlimited by default |
| S89 | Storage snapshots | Periodic usage rollup | `src/storage-snapshots.ts` | ✅ |
| S90 | Rate limiting | Per-IP / per-user limits | `src/rate-limit.ts`, `quota.ts`, `idempotency.ts` | ✅ |
| S91 | Turnstile | Bot check on public forms | `src/turnstile.ts` | ✅ optional |
| S92 | Support tickets | In-product ticket + admin view | `src/support/`, `superadmin/views/bodies/support.ts` | ✅ **the earlier ⚠️ was wrong** — `src/support/` contains no founder host or address; tickets stay on the instance |
| S93 | Search | Cross-artifact search | `src/search/` | ✅ |
| S94 | Health endpoint | `/health` — origin, schema state, warnings | `src/router/api/misc.ts` | ✅ assertable by a deploy check (#42, #46) |
| S103 | Crawl & agent discovery | `robots.txt`, `sitemap.xml`, `sitemap-product.xml`, `llms.txt`, IndexNow | `src/pages/seo.ts` | ✅ was the worst offender in the repo and was never a row: it published a sitemap of the hosted domain, advertised a route this worker does not serve, pitched plans that do not exist, and pinged IndexNow with the hosted verification key on every publish. Now branches on `isMarketingApex()` (#67) |
| S104 | Teams preview page | `/teams/preview` — sample workspace | `src/pages/teams-preview.ts` | ✅ showed a `*.shareout.site` host and two CTAs to a route this worker does not serve (#67) |
| S105 | Agent-driven configuration | Read gaps, apply fixes, verify | `src/superadmin/instance-config.ts`, `skills/ShareOutSkill/deploy/configure.md` | ✅ `/v1/admin/*` accepts a personal token so an agent can read config (#72). Note: **only feature flags are runtime-mutable** — secrets, vars and bindings need wrangler plus a redeploy, so there is no config PATCH and should not be |

## I. Developer surfaces

| ID | Surface | What it is | Entry point | State |
|----|---------|------------|-------------|-------|
| S95 | REST API | 98 documented paths | `src/router/api/`, `src/discovery/openapi.spec.json` | ✅ |
| S96 | Agent skill | Served at `/v1/skill` | `skills/ShareOutSkill/`, `src/skill.ts`, `src/skill-origin.ts` | ✅ fixed in #42 — bundle ships with the Worker, origin rewritten on the way out |
| S97 | Skill plan vocabulary | "Personal / Pro / Teams", checkout | `skills/ShareOutSkill/SKILL.md` | ✅ removed in #44 |
| S98 | Browser SDK | Embedded bundle at `/sdk/shareout.js` | `sdk/src/`, `src/sdk-serve.ts` | ✅ fixed in #51 — starter-kit and AI-generated pages load the SDK from the serving instance |
| S99 | Design system | Tokens, components, CSS-in-TS, `.so-` classes | `Design/`, `src/design-system/` | ✅ documented as rebrandable |
| S100 | Docs site | Astro Starlight, EN + ES, ~200 pages | `docs-site/` | ✅ billing pages removed in #44 |
| S101 | Migrations | 152 numbered D1 files | `shareout-app/migrations/` | ✅ documented in README / self-host / deploy skill, and detected at runtime (#46) |
| S102 | Test suite | Vitest (Workers pool), Playwright e2e | `shareout-app/tests/` | ✅ critical subset on PR, full on main/nightly |

---

## How to pick up a row

```bash
git fetch origin
git worktree add -b polish/S23-crew-ai ../shareout-wt/S23-crew-ai origin/main
cd ../shareout-wt/S23-crew-ai/shareout-app && npm ci
```

Work the six-point checklist at the top. Open one PR per row. If a row turns out
to be bigger than one PR, split it and say so in the issue rather than
half-finishing it.
