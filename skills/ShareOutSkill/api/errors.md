# REST API: Error Codes

Standard error codes and their meanings. Response wrapper (`success`/`error`/`code`) is in [overview.md](overview.md#error-response).

## General Errors

| Code | Status | Description |
|------|--------|-------------|
| `UNAUTHORIZED` | 401 | Authentication required |
| `FORBIDDEN` | 403 | Access denied |
| `NOT_FOUND` | 404 | Resource not found |
| `INVALID_REQUEST` | 400 | Bad request format |
| `CONFLICT` | 409 | Version conflict |
| `RATE_LIMITED` | 429 | Rate limit exceeded |
| `FEATURE_DISABLED` | 403 | Module not enabled for this workspace — see [features.md](features.md) |
| `AI_CREDIT_EXHAUSTED` | 402 | Monthly included AI credit spent — upgrade, wait for UTC month reset, or add BYO provider key |
| `INTERNAL_ERROR` | 500 | Server error |

## Artifact Errors

| Code | Status | Description |
|------|--------|-------------|
| `ARTIFACT_NOT_FOUND` | 404 | Artifact doesn't exist |
| `VERSION_NOT_FOUND` | 404 | Version doesn't exist |
| `SLUG_TAKEN` | 409 | Slug already in use |
| `INVALID_SLUG` | 400 | Slug format invalid |
| `VISIBILITY_HELD` | 400 | Open visibility blocked — free account without paid entitlement; response includes `notice` |

## Data Errors

| Code | Status | Description |
|------|--------|-------------|
| `KEY_NOT_FOUND` | 404 | JSON key doesn't exist |
| `ROW_NOT_FOUND` | 404 | Table row doesn't exist |
| `TABLE_NOT_FOUND` | 404 | Table doesn't exist |
| `INVALID_FILTER` | 400 | Invalid query filter |
| `FILE_TOO_LARGE` | 413 | Dataset file over the plan's per-file cap (Free 25MB · Pro/Teams 500MB) |
| `STORAGE_QUOTA_EXCEEDED` | 507 | Workspace storage limit reached (Free 50MB · Pro 5GB · Teams 10GB/seat) — upgrade or delete data |

## Blob Errors

| Code | Status | Description |
|------|--------|-------------|
| `BLOB_NOT_FOUND` | 404 | Blob doesn't exist |
| `FILE_TOO_LARGE` | 413 | Exceeds 50MB per file, or the plan's per-file cap (Free 25MB) |
| `STORAGE_LIMIT` | 413 | Artifact storage full (500MB/artifact) |
| `STORAGE_QUOTA_EXCEEDED` | 507 | Workspace storage limit reached (Free 50MB · Pro 5GB · Teams 10GB/seat) |
| `BLOB_LIMIT` | 413 | Max 1000 blobs |
| `INVALID_TYPE` | 400 | MIME type not allowed |

## Collaborator Errors

| Code | Status | Description |
|------|--------|-------------|
| `CANNOT_REMOVE_OWNER` | 400 | Cannot remove artifact owner |
| `USER_NOT_FOUND` | 404 | Transfer target not a user |

## Email Errors

| Code | Status | Description |
|------|--------|-------------|
| `EMAIL_RATE_LIMITED` | 429 | Daily email cap |
| `CONFIG_ERROR` | 500 | Email binding missing |
| `INVALID_RECIPIENT` | 400 | Invalid email address |

## Job Errors

| Code | Status | Description |
|------|--------|-------------|
| `JOB_NOT_FOUND` | 404 | Job doesn't exist |
| `JOB_LIMIT` | 400 | Max 10 jobs per artifact |
| `INVALID_SCHEDULE` | 400 | Invalid cron expression |
| `RECIPIENT_LIMIT` | 400 | Max 10 recipients |

## Comments Errors

| Code | Status | Description |
|------|--------|-------------|
| `COMMENTS_DISABLED` | 403 | Comments disabled |
| `COMMENT_NOT_FOUND` | 404 | Comment doesn't exist |
| `NAME_REQUIRED` | 400 | Author name required |
| `AUTH_REQUIRED` | 401 | Session required |
| `REPLIES_DISABLED` | 403 | Replies disabled |
| `MAX_DEPTH` | 400 | Reply depth limit |

## Proxy Errors

| Code | Status | Description |
|------|--------|-------------|
| `BLOCKED_DESTINATION` | 403 | URL blocked |
| `HOST_NOT_ALLOWED` | 403 | Host not in allowlist |
| `PROXY_RATE_LIMITED` | 429 | Rate limit exceeded |
| `FILE_TOO_LARGE` | 413 | Response exceeds 10MB |
| `PROXY_ERROR` | 502 | Upstream request failed |

## Sheets Errors

| Code | Status | Description |
|------|--------|-------------|
| `SHEETS_NOT_CONNECTED` | 401 | OAuth not completed |
| `SHEETS_ACCESS_DENIED` | 403 | Sheet not shared |
| `FETCH_ERROR` | 500 | Google Sheets API error |

## PWA Errors

| Code | Status | Description |
|------|--------|-------------|
| `INVALID_ICON` | 400 | Missing PNG signature |
| `INVALID_SHORT_NAME` | 400 | Short name > 12 chars |

## Related

- [Overview](overview.md) - API intro
