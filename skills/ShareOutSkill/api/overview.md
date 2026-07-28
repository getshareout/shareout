# REST API Overview

ShareOut REST API for artifact management, data access, and integrations.

## Base URL

```
$ORIGIN
```

Resolve `$ORIGIN` from `~/.shareout/credentials` → `origin`, else env `SHAREOUT_ORIGIN` /
`SHAREOUT_BASE_URL`. Hosted example: `$ORIGIN`. Self-host example:
`https://shareout.<account>.workers.dev` or your custom domain.

All paths below are relative to `$ORIGIN` (e.g. `POST $ORIGIN/v1/publish`).

**No instance yet?** Install first: [../deploy/SKILL.md](../deploy/SKILL.md).

## Authentication

For protected endpoints, include one of:
- `Authorization: Bearer {token}` header
- `shareout_session` cookie (Google auth)
- `shareout_access` cookie (password/credentials)

### Token Storage

```bash
~/.shareout/credentials
```

```json
{ "token": "so_xxx...", "origin": "https://your-instance.example" }
```

### Token kinds

- `so_…` — personal token, scoped to one user, full access to that user's resources.
- `sot_…` — **workspace Agent token** (service account): non-human, scoped to one
  workspace, with action scopes. For a customer's AI agent, backend, or CI/CD. See the
  Teams overlay → [team/agent-tokens.md](../team/agent-tokens.md).

## Endpoints Index

| Domain | File | Endpoints |
|--------|------|-----------|
| **Publish** | [artifacts.md](artifacts.md) | `/v1/publish`, `/v1/artifacts` |
| **Search** | [search.md](search.md) | `/v1/search` (ranked fuzzy search: pages, folders, datasets, connectors) |
| **Auth** | [artifacts.md](artifacts.md) | `/auth/google`, `/auth/callback` |
| **Data** | [artifacts.md](artifacts.md) | `/v1/data/{id}/json`, `/v1/data/{id}/tables` |
| **Shared tables (Teams)** | [team/workspace-tables.md](../team/workspace-tables.md) | `/v1/data/{id}/workspace/_share`, `/v1/data/{id}/workspace/tables/{name}`, `/v1/workspaces/{id}/shared-tables` |
| **Blobs** | [blobs.md](blobs.md) | `/v1/data/{id}/blobs` |
| **Jobs** | [jobs.md](jobs.md) | `/v1/jobs` (scheduled tasks) |
| **Webhooks** | [webhooks.md](webhooks.md) | Webhook payloads |
| **Support** | [support.md](support.md) | `/v1/support/tickets` (raise & track tickets) |
| **Errors** | [errors.md](errors.md) | Error codes |
| **Artifact Types** | [artifact-types.md](artifact-types.md) | CSV, Markdown, JSON, TXT viewers |

## Standard Response

```typescript
interface DataResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}
```

## Error Response

```json
{
  "success": false,
  "error": "Resource not found",
  "code": "NOT_FOUND"
}
```

## Common Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `ARTIFACT_NOT_FOUND` | 404 | Artifact doesn't exist |
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Access denied |
| `INVALID_REQUEST` | 400 | Bad request format |
| `INTERNAL_ERROR` | 500 | Server error |

## Cloudflare Protection

ShareOut uses Cloudflare. Python `requests` triggers 1010 block.

**Solution:** Build payload in Python, pipe to curl:

```bash
ORIGIN=$(python3 -c "import json,os; c=json.load(open(os.path.expanduser('~/.shareout/credentials'))); print(c.get('origin') or os.environ.get('SHAREOUT_ORIGIN','$ORIGIN'))")
TOKEN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.shareout/credentials')))['token'])")
python3 build_payload.py | curl -sS -X POST "$ORIGIN/v1/publish" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @-
```

## Rate Limits

| Endpoint | Limit |
|----------|-------|
| Publish | 60/hour per user |
| Data API | 1000/min per artifact |
| Email | 50/day per user, 10/day per artifact |
| CORS Proxy | 100/min per artifact |

## Related

- [Artifacts](artifacts.md) - Publish, serve, manage
- [Artifact Types](artifact-types.md) - CSV, Markdown, JSON, TXT support
- [Blobs](blobs.md) - File storage
- [Jobs](jobs.md) - Scheduled tasks
