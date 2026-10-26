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

Working on several branches at once? `./tooling/scripts/new-worktree.sh <branch>` adds a
worktree off `origin/main` and clones `node_modules` from this checkout instead of
installing a second copy — copy-on-write on APFS, so it costs almost no disk. It clones
only when what this checkout has installed (`node_modules/.package-lock.json`) matches the
new worktree's lockfile, and runs `npm ci --prefer-offline` otherwise (~5 s with a warm
npm cache).

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
local-only.

## Checks before a PR

There is no hosted CI, by design — these local checks are the gate. Before a PR from a
single checkout:

```bash
./tooling/scripts/ci-check.sh
```

That runs static gates, fresh D1 migrate, typecheck, the **full unit suite**, workspace
tests, bundles, `npm audit --omit=dev --audit-level=high` (runtime deps), gitleaks, and
the docs-site build. Coverage floors are opt-in — `SHAREOUT_COVERAGE=1` roughly doubles
the run; run them when a change could move coverage.

Running several worktrees (or agents) on one machine? Don't run the full suite in each:
push light and integrate once, as described under
[Hooks, worktrees and generated files](#hooks-worktrees-and-generated-files) and in
[AGENTS.md → Gate contract](AGENTS.md#gate-contract).

Faster loop while iterating (skips migrate, coverage, audit, docs, and runs only the
tests your change touches):

```bash
./tooling/scripts/ci-check-fast.sh
# optional pre-push hook:
./tooling/scripts/install-hooks.sh
```

Tests there are the critical-path subset plus whatever your diff reaches through
vitest's module graph. Force the whole suite with `SHAREOUT_FULL_TESTS=1`.

### Hooks, worktrees and generated files

`install-hooks.sh` runs once per machine. It installs the pre-push hook in the shared
`.git` dir, so it covers every worktree, and it configures the `generated` merge driver.
Skip one push with `git push --no-verify` or `SHAREOUT_SKIP_HOOK=1`.

- **Feature branches push light; tests run on what lands.** Pushing a feature branch
  runs static checks, eslint on changed files, the worker and workspace typechecks,
  secret scan and bundle checks, but no tests (`SHAREOUT_CHECK_MODE=light`). Many
  worktrees each running the suite on one machine starve each other into timeout
  failures. To land several branches together, combine them and run everything once:

  ```bash
  ./tooling/scripts/integrate.sh -n <name> <branch-a> <branch-b> …
  ```

  It merges them onto `origin/main` in a throwaway worktree on `integration/<name>`,
  regenerates bundles, and runs the full suite. Fix failures there, push it (pushes to
  `main` and `integration/*` run the tests), and land it as one PR.

- **Landing a single PR (maintainers): `./tooling/scripts/land.sh <pr-number>`.** This
  is the default way to merge one PR. Under a machine-wide lock it rebases the PR onto
  `origin/main` in a throwaway worktree, regenerates and commits the bundles, runs the
  light checks plus `test:affected` (affected root tests and touched workspace
  suites), force-pushes the rebased head with `--force-with-lease`, then squash-merges
  with `--match-head-commit` — and refuses if `main` moved during the run. What merges
  is exactly what was tested. `--dry-run` prints the plan without changing anything.
  Hooks are never bypassed; `integrate.sh` stays the tool for batches.

- **Generated files.** Committed build outputs (`public/_bundles/*`, `src/discovery/*`,
  `src/official-skills/*.generated.ts`) are marked `merge=generated` in
  `shareout-app/.gitattributes`. With the driver installed, a merge or rebase keeps one
  side instead of conflicting. Don't hand-merge them: `npm run check:bundles` (last step
  of the pre-push check) rebuilds them and fails if the committed copy is stale, so
  regenerate and commit.
- **Name guard in worktrees.** `check:customer-names` reads its blocklist from the
  `CUSTOMER_NAMES` env var and from the gitignored `tooling/customer-names.local`. In a
  linked worktree it also reads that file from the main checkout, so a fresh worktree
  pushes without copying it.

Or the individual worker commands:

```bash
cd shareout-app
npm run test:affected            # only the tests your change reaches
npm run check:boundaries
npm run check:domains
npm run check:migrations
npm run check:ui
npm run check:access-seams
npm run db:migrate:fresh
npm run typecheck
TZ=UTC npm test                  # whole unit suite (~3m)
TZ=UTC npm run coverage          # enforces vitest coverage thresholds (~10m)
```

Fast feedback on the hottest paths:

```bash
cd shareout-app
TZ=UTC npm run test:critical
```

Maintainer release steps: [RELEASING.md](RELEASING.md).

### Lint / format

ESLint is part of the gate at `--max-warnings 0`: the pre-push check lints the files your
branch changed (vs its merge base with `origin/main`), and `ci-check.sh` lints the whole
tree. The tree is clean, so any warning it reports is in a file you touched — fix it
rather than suppress it.

```bash
cd shareout-app
npm run lint:changed -- path/to/file.ts   # what the hook does, for chosen files
npm run lint                              # whole tree (~12 s)
npx prettier --check path/to/file.ts
```

Prettier is not a gate: `npm run format` on the whole tree would reformat a large
existing baseline, so format only the files you touch.

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
