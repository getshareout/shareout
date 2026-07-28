# Changelog

All notable changes to the public ShareOut tree are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- Agent **deploy skill** (`skills/ShareOutSkill/deploy/`) — install ShareOut on Cloudflare with success criteria, CLI + Deploy-button paths, and Cloudflare companion skill links
- `skills/README.md` — single **source of truth** policy (monorepo skill tree vs `shareout-skill` mirror vs `$ORIGIN/v1/skill`)
- `tooling/scripts/mirror-skill-repo.sh` — keep `getshareout/shareout-skill` on par
- Self-host [Domain and DNS](docs-site/src/content/docs/self-host/domain.md) page
- Origin-aware product skill entry (`$ORIGIN`, credentials `origin` field, self-host unlocked model)

### Changed

- **Skill OSS hygiene (v2.51.0):** workspace overlay is role-based; `team/billing.md` is a hosted-only stub (no checkout/upsell on self-host); plan language stripped from team entry, API, subdomain, admin portal, assistant docs
- Official marketplace primer `official-skills/shareout.md` rewritten: origin-aware, short, points agents at `GET $ORIGIN/v1/skill` for the full tree
- README / AGENTS / self-host overview: agent install path + skill location clarified
- Self-host secrets docs: drop `BILLING_MODE` as a required knob (OSS unlocked by construction)
- `jsonWithApiErrors` optional extra headers (Set-Cookie / CORS) for OTP and file routes
- Pilot / editor SDK error helpers use the canonical envelope
- Bump `@cloudflare/workers-types` to v5 so `npm ci` resolves wrangler 4.114 peerOptional cleanly

### Security

- Branch protection on `main`: required `Checks` + `Gitleaks`, strict up-to-date, require PR (documented in MAINTAINING.md)

### Security

## [0.1.0-pre] — 2026-07-25

First public soft-launch cut of the open-source tree.

### Added

- Wave 4: `ROADMAP.md`, `MAINTAINING.md` (branch protection checklist); broader
  `jsonWithApiErrors` rollout (auth, tokens, folders, router API, slack, email, …)
- Wave 3: `npm run test:critical` (auth/access/publish/error contract) as a fail-fast CI step
- `jsonWithApiErrors` — artifact / publish / workspace JSON helpers normalize error bodies
- Capability lattice unit tests; RELEASING.md maintainer cut checklist
- Dependabot: grouped production/dev deps, lower open-PR limits (avoid CI storms)
- Canonical public API error envelope (`src/http/api-error.ts`) + golden contract tests
- Fail-closed tests for unset `ADMIN_BRIDGE_SECRET` on `/internal/admin/*`
- CI Wave 0/1: coverage floors on every PR, docs-site build job, prod `npm audit`,
  Dependabot (npm + Actions), `NOTICE`, `SUPPORT.md`, EditorConfig / Prettier / ESLint baselines
- Local `ci-check.sh` aligned with public CI (migrate fresh, coverage, audit, gitleaks, docs)
- `MARKETING_ORIGIN`, `DOCS_HOST`, `DOCS_ORIGIN` vars (optional; unset = no marketing/docs proxy)
- `.nvmrc` (Node 24) and `.github/ISSUE_TEMPLATE/config.yml`
- Guidance for self-hosters on retheming `Design/` and replacing `docs-site/`
- Self-host path: `/setup` checklist, email OTP without Google (billing removed from OSS tree)
- Deploy-to-Cloudflare wrangler template (no founder account IDs)
- Fresh D1 migrate smoke (`npm run db:migrate:fresh`) and hello publish smoke
- Docs: Self-host section (EN + ES) — overview, secrets, architecture, ops, threat model
- Public CI (gitleaks, worker checks, migrate smoke)

### Changed

- Scheduling job/template handlers return the same error envelope as the data API (`success: false`)
- Unhandled request errors include `success: false` and never echo exception text to clients
- `wrangler.test.toml`: placeholder IDs, neutral `shareout.test` origins, no product zone routes
- Anonymous `/` redirects to the login page when no `MARKETING_ORIGIN` is set
- npm package renamed `shareout-poc` → `shareout`; analytics/log hints use script name `shareout`

### Removed

- **All billing and payments.** Rebill and dLocal integrations, subscriptions, trials,
  seats, invoices, AI-credit metering and top-ups, checkout/billing/pricing pages and
  APIs, the founder revenue dashboards (`team-metrics/`), and every plan/tier gate.
  Feature access is no longer tiered: external sharing, the skill marketplace, the
  workspace library, public links, and the workspace assistant are on. Abuse limits
  are now instance settings (`STORAGE_QUOTA_BYTES`, `STORAGE_MAX_FILE_BYTES`,
  `PUBLIC_ARTIFACT_LIMIT`), unlimited by default
- Marketing landing page (no route referenced it) and the generated graphify cache
- Instance-specific deploy scripts (`ship.sh`, `rollback.sh`, `bootstrap-staging-secrets.sh`)

### Security

- `superadmin-recipients.json` ships empty — claim first admin via `/setup` or `SETUP_ADMIN_EMAIL`
- Vulnerability reports via GitHub private advisories (no shared alias)
- KV rate limits on email OTP, access-request create, and `/internal/admin/ask`
- `ADMIN_BRIDGE_SECRET` unset ⇒ internal admin bridge denies all
