# ShareOut — Agent Guide (public)

**This repo is the only place ShareOut is worked on.** As of 2026-07-26 the private
`Grid Leo` checkout (`github.com/leorfer23/shareout`) is retired: do not commit, ship or
deploy from it, and do not port changes into it. If a task looks like it needs that repo
— production deploys, the marketing site, Cloudflare credentials — stop and ask, because
that surface has to move here rather than be edited there.

**Read this first.** This repo is the open-source ShareOut product: a Cloudflare Worker that publishes and hosts interactive HTML artifacts, plus the browser SDK, visual editor, agent skill docs, and design system.

**Synced copies:** `AGENTS.md` and `CLAUDE.md` are identical.

**Design system:** Any visual / UI / brand work MUST consult [Design/README.md](Design/README.md) first.

**Visual QA is the human's job.** Verify with types and tests; do not screenshot or drive a browser for UI eyeballing unless the user asks.

---

## Behavioral guidelines

1. **Think before coding** — surface assumptions and tradeoffs; ask when unclear.
2. **Simplicity first** — minimum code that solves the ask; no speculative features.
3. **Surgical changes** — touch only what the request requires; match existing style.
4. **Goal-driven** — define verifiable success criteria; loop until checked.

Prefer the `ponytail` skill (lazy-senior / YAGNI) for coding tasks when available.

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
| `SETUP_ADMIN_EMAIL` | Bootstrap admin when roster empty |
| `STORAGE_QUOTA_BYTES` / `STORAGE_MAX_FILE_BYTES` | Optional storage caps; unset = unlimited |
| `PUBLIC_ARTIFACT_LIMIT` | Optional per-account public-artifact cap; unset = unlimited |
| `GOOGLE_CLIENT_ID` / `SECRET` | Optional; email OTP always available |

---

## Local development

```bash
cd shareout-app
npm ci
npm run db:migrate
npm run dev   # http://localhost:55162
```

Login: `/auth/dev?email=<you>&redirect=/home` (localhost only).

Checks: `npm test`, `npm run check:domains`, `npm run typecheck`.

Rebuild after SDK/editor changes: `npm run build:sdk` / `npm run build:editor`.

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
