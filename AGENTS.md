# ShareOut — Agent Guide (public)

**This repo is the only place ShareOut is worked on.** As of 2026-07-26 the private
`Grid Leo` checkout (`github.com/leorfer23/shareout`) is retired: do not commit, ship or
deploy from it, and do not port changes into it. If a task looks like it needs that repo
— production deploys, the marketing site, Cloudflare credentials — stop and ask, because
that surface has to move here rather than be edited there.

**Read this first.** This repo is the open-source ShareOut product: a Cloudflare Worker that publishes and hosts interactive HTML artifacts, plus the browser SDK, visual editor, agent skill docs, and design system.

**One guide for every agent: this file.** `CLAUDE.md` is the single line `@AGENTS.md`,
which Claude Code expands into this file. Edit here, never there — the pre-push check
fails if `CLAUDE.md` becomes anything else.

**Design system:** Any visual / UI / brand work MUST consult [Design/README.md](Design/README.md) first.

**Visual QA is the human's job.** Verify with types and tests; do not screenshot or drive a browser for UI eyeballing unless the user asks.

---

## Behavioral guidelines

1. **Think before coding** — surface assumptions and tradeoffs; ask when unclear.
2. **Simplicity first** — minimum code that solves the ask; no speculative features.
3. **Surgical changes** — touch only what the request requires; match existing style.
4. **Goal-driven** — define verifiable success criteria; loop until checked.

---

## Quick routing

| If the user wants to… | Go here | Do NOT start in… |
|------------------------|---------|------------------|
| Change product code (API, auth, serving, data) | `shareout-app/src/` | docs trees |
| Change the browser SDK | `shareout-app/sdk/src/` | `skills/ShareOutSkill/` (docs only) |
| Change the visual editor | `shareout-app/editor-client/` | `src/pages/` |
| **Edit the agent skill (canonical)** | `skills/ShareOutSkill/` | `getshareout/shareout-skill` (mirror only) |
| Install / deploy ShareOut (agent protocol) | `skills/ShareOutSkill/deploy/SKILL.md` | improvising Cloudflare without `deploy/cloudflare.md` |
| Publish / agent how-to (use an instance) | `skills/ShareOutSkill/SKILL.md` | worker source unless implementing |
| Workspace admin docs | `skills/ShareOutSkill/team/` | — |
| Design / UI / brand | `Design/README.md` | ad-hoc example HTML |
| Understand or change the database schema | `shareout-app/migrations/SCHEMA.md` then `CONVENTIONS.md` | hand-writing DDL without reading either |

**Skill source of truth:** [skills/README.md](skills/README.md) — monorepo wins;
`shareout-skill` and `GET $ORIGIN/v1/skill` are load paths, not alternate edit trees.

---

## Layout

```
shareout-app/          ← product (Worker, SDK, editor, tests)
docs-site/             ← Astro Starlight docs
skills/README.md       ← where the skill lives (read this)
skills/ShareOutSkill/  ← agent skill markdown (CANONICAL — edit here)
Design/                ← design system
tooling/scripts/       ← ci-check, gitleaks, boundary helpers
```

### Worker entry points

| File | Role |
|------|------|
| `shareout-app/src/index.ts` | Worker entry |
| `shareout-app/src/router/handle-fetch.ts` | Request dispatcher |
| `shareout-app/wrangler.toml` | Bindings (OSS template: no founder zones) |

### Self-host knobs

| Env | Meaning |
|-----|---------|
| `SHAREOUT_BASE_URL` | Public origin of this instance |
| `ARTIFACT_ORIGIN` | Optional CDN origin; unset = same-zone |
| `VENDOR_LIBS_DISABLED` | `1` to stop vendoring JS libraries (`/vendor/*`); artifacts keep their third-party CDN URLs |
| `VENDOR_PACKAGES_EXTRA` | Comma-separated npm packages this instance vendors on top of the built-in allowlist |
| `VENDOR_ALLOW_ANY` | `1` to vendor any npm package instead of an allowlist (`/vendor` becomes a caching npm proxy) |
| `SETUP_ADMIN_EMAIL` | Bootstrap admin when roster empty |
| `STORAGE_QUOTA_BYTES` / `STORAGE_MAX_FILE_BYTES` | Optional storage caps; unset = unlimited |
| `PUBLIC_ARTIFACT_LIMIT` | Optional per-account public-artifact cap; unset = unlimited |
| `GOOGLE_CLIENT_ID` / `SECRET` | Optional; email OTP always available |
| `MICROSOFT_CLIENT_ID` / `SECRET` | Optional Sign in with Microsoft (personal + work/school); callback `/auth/microsoft/callback`. Work accounts need the `xms_edov` optional claim |
| `MICROSOFT_TENANT` | Optional authority: `common` (default), `organizations`, `consumers`, or one tenant GUID |
| `D1_READ_REPLICAS` | `1` to read through D1 Sessions (read replicas; enable read replication on the database first); writes hand back an `x-d1-bookmark` header / `__d1b` cookie for read-your-writes. Unset = primary only |
| `CUSTOM_DOMAINS_CNAME_TARGET` | Turns on workspace custom domains; the hostname customers CNAME to. Alone = manual mode (DNS TXT check) |
| `CF_CUSTOM_HOSTNAMES_TOKEN` / `CF_CUSTOM_HOSTNAMES_ZONE_ID` | Optional; provision custom domains via Cloudflare for SaaS (token: Zone → SSL and Certificates: Edit) |
| `SUPPORT_ALERT_TELEGRAM_CHAT_ID` | Optional; Telegram chat pinged on every new support ticket (needs `TELEGRAM_BOT_TOKEN`) |

---

## Local development

```bash
cd shareout-app
npm ci
npm run db:migrate
npm run dev   # http://localhost:55162
```

Login: `/auth/dev?email=<you>&redirect=/home` (localhost only).

Starting a task? `./tooling/scripts/new-worktree.sh <branch>` creates
`../shareout-wt/<last part of the branch name>` (next to the primary checkout) off
`origin/main`, installs the pre-push hook, and clones `node_modules` from the primary
checkout — copy-on-write on APFS, so near-zero extra disk — when what the primary has
installed (`node_modules/.package-lock.json`) matches the new lockfile. Otherwise it runs
`npm ci --prefer-offline` (~5 s with a warm npm cache). The gate scripts use the same
installed-vs-lockfile test (`tooling/scripts/install-deps.sh`) before every run.

Testing, pushing and landing: [Gate contract](#gate-contract).

---

## Gate contract

There is no hosted CI, by design, and `main` has no branch protection: these local
checks are the whole gate. `npm` commands run in `shareout-app/`; scripts run from the
repo root.

- **Pushing a feature branch runs light checks, no tests.** The pre-push hook runs the
  static guards (`check:*`, plus the `CLAUDE.md` import check), eslint at
  `--max-warnings 0` on the files the branch changed, the worker typecheck and the
  `sdk`/`editor-client`/`chat-core` typechecks, gitleaks over the branch's commits, then
  `check:bundles` and `check:bundle-size`.
  Same run by hand: `SHAREOUT_CHECK_MODE=light ./tooling/scripts/ci-check-fast.sh`.
- **While you work, test narrowly:** `npm run typecheck`, then
  `TZ=UTC npx vitest run <test files>` or `npm run test:affected` (maps your diff to its
  tests through vitest's module graph, and runs the own suite of any workspace you
  touched; when `package.json`, the lockfile or a test/TS config changed it runs
  everything — name the files instead).
- **Never run the full suite on a feature branch** — not `npm test`, `npm run coverage`,
  `SHAREOUT_FULL_TESTS=1` or `ci-check.sh`. Parallel worktrees on one machine starve
  each other into timeouts. Tests run on the result that will land, never per branch.
- **Opening a PR:** push, open a PR against `main` that lists the checks you ran, and
  stop — merging is the maintainer's call.
- **Landing one PR (default):** `./tooling/scripts/land.sh <pr-number>`. Under a
  machine-wide lock (one land at a time), it rebases the PR head onto `origin/main` in
  a throwaway worktree, regenerates and commits the bundles, runs the light checks and
  `test:affected` (affected root tests + touched workspace suites), pushes the rebased
  head with `--force-with-lease` (hooks run), and squash-merges with
  `--match-head-commit`, refusing if `main` moved meanwhile — so what merges is exactly
  what was tested. `--dry-run` prints the plan and changes nothing. It never bypasses
  hooks; if the rebase conflicts it stops, and you rebase the branch yourself.
- **Landing a batch:** `./tooling/scripts/integrate.sh -n <name> <branch> [<branch>…]`
  merges the branches onto `origin/main` in a throwaway worktree, regenerates the
  bundles, then runs typecheck, the full suite, the workspace suites and the bundle
  checks. Fix failures on `integration/<name>`; pushing that branch runs the hook with
  tests; the batch lands as one `integration/<name>` PR.
- **Committed bundles:** build outputs (`public/_bundles/*`, `src/discovery/*`,
  `src/official-skills/*.generated.ts`) live in git. After editing `sdk/`,
  `editor-client/`, `chat-core/` or `skills/ShareOutSkill/`, run `npm run build:sdk` /
  `build:editor` / `build:chat-core` / `build:skill` and commit the output.
  `npm run check:bundles` rebuilds all of them and fails if a committed copy was stale;
  commit what it rebuilt. They are marked `merge=generated` (a merge keeps one side), so
  never hand-merge them — regenerate and commit.

---

## Mental model

```
skills/ShareOutSkill/  → how to use / deploy ShareOut (docs; SoT)
  GET $ORIGIN/v1/skill → runtime zip for agents (synced from SoT)
  getshareout/shareout-skill → public mirror only
shareout-app/          → ShareOut itself (platform)
```

## Public API errors

Use `src/http/api-error.ts` (`apiErrorResponse` / `simpleApiError`) for JSON errors.
Envelope: `{ success: false, error, code, request_id?, hint?, … }`. Do not invent a
third shape; do not put stack traces or secrets in client-facing messages.
