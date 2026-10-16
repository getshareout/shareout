# Changelog

All notable changes to the public ShareOut tree are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/).

## [Unreleased]

### Added

- **Guest comments without an account:** owners turn guests on per artifact (`_config.guestComments`) or per folder (`PUT /v1/workspaces/{wid}/folders/{fid}/guest-comments`, MCP `set_guest_comments`); a viewer of a public or unlocked password page confirms an email code and comments or replies as a guest (artifact-bound HMAC cookie, keyed email hash only, Origin-checked writes, per-IP and per-guest limits, no resolve/assign/react/approve); viewer toolbar **Comment as guest** (en/es). Migration `0016`
- **Review and sharing notifications** (feed + email + Telegram, under the product email preference, never to the actor): version approved → owner (once per approver per version); an outside person's first open in a shared folder → whoever shared it (once per person per folder per day); new versions → followers and collaborators with each version's note, debounced into one notice per artifact after 10 quiet minutes; a new folder shared with an existing external member → email linking `/shared?folder=<id>`
- **API / skill / MCP parity for the 2026-10-16 releases (skill v2.57.0):**
  - OpenAPI: version list / source / restore, data-API comments (list, resolve, assign, `versionId`), `GET /v1/home/review` + `POST /v1/home/approvals`, `Grant.expires_at`, folder-manager grant rules, `/v1/jobs` visibility
  - Skill: multi-page sites, review mode, folder access / expiring shares / client portal, knowledge source links and reverse lookup, Server-Timing
  - MCP tools: `list_versions`, `get_version_source`, `restore_version`, `list_comments`, `resolve_comment`, `assign_comment`, `approve_version`, `list_jobs`, `folder_access`, `folder_activity`, `share_with_person`, `revoke_share`, `knowledge_get`, `knowledge_from_artifact`; `publish_artifact` takes `message`; `get_artifact` names the live change note and a site's pages
  - Folder access is truthful: the pill, `folder_access` and the docs report the real audience (the most open of the folder setting, its grants and the non-deleted artifacts and files inside, which keep their own visibility); managers get the over-open items by name, other members the counts. Folder managers' shares now run the external-sharing entitlement (`collab.external_sharing`, `requireExternalSharingEnabled`) and the workspace's allowed email domains like admins'; listing and revoking stay open
  - MCP: `publish_artifact` / `update_artifact` take `files: [{ path, content, encoding? }]` for multi-page sites (same `/v1/publish` validation, limits, quota and moderation; the result links each page with `?page=`)
- Agent **deploy skill** (`skills/ShareOutSkill/deploy/`) — install ShareOut on Cloudflare with success criteria, CLI + Deploy-button paths, and Cloudflare companion skill links
- `skills/README.md` — single **source of truth** policy (monorepo skill tree vs `shareout-skill` mirror vs `$ORIGIN/v1/skill`)
- `tooling/scripts/mirror-skill-repo.sh` — keep `getshareout/shareout-skill` on par
- Self-host [Domain and DNS](docs-site/src/content/docs/self-host/domain.md) page
- Origin-aware product skill entry (`$ORIGIN`, credentials `origin` field, self-host unlocked model)

### Changed (API)

- `POST /v1/publish` (and data-API provision, Studio Home import, library modules) apply the MCP `files` path rule: backslashes, empty or `.` segments (`a//b`, `./x`), control characters and paths over 512 characters are now refused with `400 INVALID_PATH` and a `hint` naming the path. Names like `img/logo@2x.png` and `a+b.css` still publish; files already stored keep serving. Imported Word images and file names are renamed to safe paths.

### Changed

- **Skill OSS hygiene (v2.51.0):** workspace overlay is role-based; `team/billing.md` is a hosted-only stub (no checkout/upsell on self-host); plan language stripped from team entry, API, subdomain, admin portal, assistant docs
- Official marketplace primer `official-skills/shareout.md` rewritten: origin-aware, short, points agents at `GET $ORIGIN/v1/skill` for the full tree
- README / AGENTS / self-host overview: agent install path + skill location clarified
- Self-host secrets docs: drop `BILLING_MODE` as a required knob (OSS unlocked by construction)
- `jsonWithApiErrors` optional extra headers (Set-Cookie / CORS) for OTP and file routes
- Pilot / editor SDK error helpers use the canonical envelope
- Bump `@cloudflare/workers-types` to v5 so `npm ci` resolves wrangler 4.114 peerOptional cleanly
- `npm run sync:skill` (and `prune-skill-orphans.mjs`) have no default R2 bucket: pass `--bucket=<name>` or set `SKILL_R2_BUCKET`, and the target is printed before uploading; `provision:cf` no longer falls back to built-in worker / D1 / R2 names when `wrangler.toml` lacks one. MCP `files` accept asset names REST accepts (`logo@2x.png`, `a+b.css`); HTML pages keep the strict page-path rule

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
