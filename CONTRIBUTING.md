# Contributing to ShareOut

Thanks for helping. This repo is the **open-source product** (Worker, SDK, editor,
docs, design). Agent-oriented map: [AGENTS.md](AGENTS.md). Support expectations:
[SUPPORT.md](SUPPORT.md).

It is maintained by one person, so please open an issue before starting anything large —
a bug report or a short "here's what I want to build" beats a surprise 2,000-line PR.
Small fixes (docs, typos, obvious bugs) can go straight to a PR.

**Merging:** only the maintainer merges to `main`. Contributors open PRs from a **fork**
(or a branch they can push if granted write). Do not expect direct push access to `main`.

By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- **Node.js 24+** (`.nvmrc` pins 24)
- Cloudflare account for deploy (Workers Paid recommended for Durable Objects)

## Local setup

```bash
cd shareout-app
npm ci
npm run db:migrate
npm run dev                      # http://localhost:55162
```

No secrets to fill in: `npm run dev` creates `.dev.vars` from `.dev.vars.example` and
generates a local `SESSION_SECRET` if there isn't one. Sessions are signed with that secret,
and signing with an empty one fails as an opaque HMAC error on every auth route, so it has to
exist before anything works.

Dev login (no OAuth, no email provider):

```
http://localhost:55162/auth/dev?email=you@example.com&redirect=/home
```

That creates the user if it does not exist. Google sign-in and email codes are optional
extras — see `docs-site` → Self-host.

### Browser tests

```bash
npx playwright install chromium   # once
npx playwright test               # against a local dev worker
```

These need no credentials: the specs mint a token through `/auth/dev` when pointed at
localhost (a stale `~/.shareout/credentials` is ignored unless you set `SHAREOUT_CREDENTIALS`).
Set `SHAREOUT_CREDENTIALS` and/or `SHAREOUT_E2E_BASE_URL` to run against a deployed instance
instead — token minting is skipped for any non-loopback base URL.

Local collab e2e also needs a migrated D1 (`npm run db:migrate` in `shareout-app/`) and a
fresh editor bundle (`npm run build:editor` after editor-client changes). Specs are
local-only — no CI job runs Playwright.

## Checks before a PR

Prefer the full local mirror of public CI:

```bash
./tooling/scripts/ci-check.sh
```

That runs static gates, fresh D1 migrate, typecheck, **unit tests with coverage floors**,
workspace tests, bundles, `npm audit --omit=dev --audit-level=high` (runtime deps),
gitleaks, and the docs-site build.

Faster loop while iterating (skips migrate, coverage, audit, docs):

```bash
./tooling/scripts/ci-check-fast.sh
# optional pre-push hook:
./tooling/scripts/install-hooks.sh
```

Or the individual worker commands:

```bash
cd shareout-app
npm run check:boundaries
npm run check:domains
npm run check:migrations
npm run check:ui
npm run check:access-seams
npm run db:migrate:fresh
npm run typecheck
TZ=UTC npm run coverage          # enforces vitest coverage thresholds
```

Public CI (`.github/workflows/ci.yml`) must be green to merge. It also builds
`docs-site/` and fails on high-severity dependency advisories.

Fast feedback on the hottest paths (also run in CI before full coverage):

```bash
cd shareout-app
TZ=UTC npm run test:critical
```

Maintainer release steps: [RELEASING.md](RELEASING.md).

### Lint / format (optional locally; not a full-tree CI gate yet)

Configs ship so new code can match the house style without a repo-wide reformat:

```bash
cd shareout-app
npx prettier --check path/to/file.ts
npx eslint path/to/file.ts
```

`npm run format` / `npm run lint` exist; running them on the whole tree will
surface a large existing baseline — prefer formatting/linting only files you touch
until a dedicated cleanup PR lands.

## Design system

`Design/` is ShareOut's own design system and the product follows it. Your instance is
yours — retheme it freely (see [Design/README.md](Design/README.md)). PRs to this repo
should stay consistent with `Design/` rather than introducing a second style.

## Self-host docs

[Self-host overview](docs-site/src/content/docs/self-host/overview.md) — deploy, secrets,
architecture, ops, and threat model live under `docs-site/src/content/docs/self-host/`.

## Security

Report vulnerabilities privately — [SECURITY.md](SECURITY.md). Do not file public
issues for exploitable bugs.

## License

Contributions are under [Apache-2.0](LICENSE). See also [NOTICE](NOTICE).
