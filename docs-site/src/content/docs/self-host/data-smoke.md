---
title: Data plane smoke
description: One command to verify JSON, tables, and datasets on a self-hosted instance.
---

After deploy, confirm that **working with data** works on *your* Worker — not only
that the process boots.

## What it checks

`npm run smoke:data` (script: `shareout-app/scripts/data-plane-smoke.sh`) runs against
a live origin with an API token:

1. `GET /health` (optional `schema: ready`)
2. `POST /v1/publish` — private smoke artifact
3. **JSON** — `PUT` / `GET` `/v1/data/{id}/json/smoke_settings`
4. **Tables** — insert + query `/tables/smoke_rows`
5. **Datasets** — `upload-url` → `PUT` bytes → `confirm` → `/content`
6. Deletes the artifact (unless you keep it)

## Run it

```bash
cd shareout-app
export SHAREOUT_ORIGIN=https://shareout.<your-account>.workers.dev
export SHAREOUT_TOKEN=so_…   # Settings → API tokens
npm run smoke:data
```

Keep the artifact for debugging:

```bash
KEEP_SMOKE_ARTIFACT=1 npm run smoke:data
```

## Prerequisites

| Need | Why |
| --- | --- |
| Workers deploy with D1 migrations applied | Tables + datasets metadata |
| `SESSION_SECRET` set | Auth for tokens |
| R2 bound as `ARTIFACTS` | Dataset file storage |
| Personal token (`so_…`) | Owner writes to data routes |

If `health.schema` is not `ready`, apply migrations:

```bash
npx wrangler d1 migrations apply DB --remote
```

## Failures to expect

| Symptom | Fix |
| --- | --- |
| publish 401 | Token wrong or revoked |
| json/tables 403 | Token not owner of artifact (shouldn't happen with same token) |
| dataset upload 5xx | R2 binding missing or misconfigured |
| confirm `UPLOAD_INCOMPLETE` | PUT to `uploadUrl` failed (check CORS/presign for direct R2) |

## Related

- [Self-host overview](/self-host/overview/)
- [Storing data](/guides/data/)
- [Datasets](/sdk/datasets/)
- [Dashboard data sources](/dashboards/data-sources/)
