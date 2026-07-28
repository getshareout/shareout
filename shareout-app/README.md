# ShareOut — Cloudflare Worker

The Worker: API, auth, workspaces, serving, and the app UI. Human onboarding:
[CONTRIBUTING.md](../CONTRIBUTING.md). Agents: [AGENTS.md](../AGENTS.md).

## Quick start

```bash
npm ci
npm run db:migrate    # local D1 (first time)
npm test              # no Cloudflare creds needed
npm run dev           # http://localhost:55162 — local D1/R2/KV
```

Copy secrets:

```bash
cp .dev.vars.example .dev.vars   # wrangler dev secrets — ask admin for values
```

Local login (after `npm run dev`):

```
http://localhost:55162/auth/dev?email=<your-email>&redirect=/home
```

## Prod data debugging (opt-in)

**Mutates real production data.** Admin / experienced devs only:

```bash
CLOUDFLARE_API_TOKEN=$(grep cloudfare_token .env | cut -d= -f2) npm run dev:prod
```

## Deploy

```bash
npm run deploy        # applies D1 migrations, then `wrangler deploy`
```

Needs `wrangler login` (or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`). Run the
full local suite first: `../tooling/scripts/ci-check.sh`.

## Layout

```
shareout-app/
├── src/              Worker (router, API, data, serve, pages)
├── sdk/              Browser SDK → npm run build:sdk
├── editor-client/    Visual editor → npm run build:editor
├── migrations/       D1 schema (npm run db:migrate / db:migrate:prod)
├── test/             Vitest (local Miniflare via wrangler.test.toml)
├── wrangler.toml     Prod + staging environments
└── package.json
```

## Common commands

| Command | Purpose |
|---------|---------|
| `npm test` | Unit + integration tests (local bindings) |
| `npm run typecheck` | TypeScript |
| `npm run build:sdk` | Rebuild SDK bundle (required before deploy if sdk/ changed) |
| `npm run build:editor` | Rebuild editor bundle |
| `npm run db:migrate:prod` | Apply D1 migrations to production (before ship if schema changed) |
| `npm run tail` | Stream production logs |
