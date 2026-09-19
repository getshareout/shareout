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
| `INTERNAL_ERROR` | 500 | Server error. On visitor chat / pilot / admin-chat routes, also returned (with `message: "AI provider not configured (set VERCEL_AI_GATEWAY, ANTHROPIC_API_KEY or OPENAI_API_KEY)"`) when the instance has no platform AI key and the workspace has no BYO key — see [error-recovery below](#error-recovery) |
| `CONFIG_ERROR` | 500 | Server is missing required configuration |

## Artifact Errors

| Code | Status | Description |
|------|--------|-------------|
| `ARTIFACT_NOT_FOUND` | 404 | Artifact doesn't exist |
| `VERSION_NOT_FOUND` | 404 | Version doesn't exist |
| `SLUG_TAKEN` | 409 | Slug already in use |
| `INVALID_SLUG` | 400 | Slug format invalid |
| `VISIBILITY_HELD` | 202 | `PATCH` accepted but public visibility was held by instance policy (`OPEN_VISIBILITY_DISABLED`, publisher not in the rollout) — no paid entitlement involved. Visibility falls back to `workspace` (approval-gated) or `private`; response includes `message` and, for `POST /v1/publish`, a `notice` string instead — see [Error recovery](#error-recovery) |
| `MODERATION_HELD` | 202 | `PATCH` accepted but an automated content-safety check on the transition to `public` didn't clear instantly. Artifact stays `private`; response includes `message` and optional `reason`. Re-checked automatically within the hour and restored to `public` on its own — no re-publish needed. See [artifacts.md § Visibility](artifacts.md#patch-v1artifactsid) and [Error recovery](#error-recovery) |

## Data Errors

| Code | Status | Description |
|------|--------|-------------|
| `KEY_NOT_FOUND` | 404 | JSON key doesn't exist |
| `ROW_NOT_FOUND` | 404 | Table row doesn't exist |
| `TABLE_NOT_FOUND` | 404 | Table doesn't exist |
| `INVALID_FILTER` | 400 | Invalid query filter |
| `FILE_TOO_LARGE` | 413 | Dataset file exceeds the 500MB cap |
| `STORAGE_QUOTA_EXCEEDED` | 507 | Instance-wide storage cap reached — an operator setting (`STORAGE_QUOTA_BYTES`), unset by default (unlimited); delete data or ask the operator to raise it |

## Blob Errors

| Code | Status | Description |
|------|--------|-------------|
| `BLOB_NOT_FOUND` | 404 | Blob doesn't exist |
| `FILE_TOO_LARGE` | 413 | Exceeds 50MB per file (500MB/file for asset-library buckets) |
| `STORAGE_LIMIT_EXCEEDED` | 413 | Artifact storage full — 500MB/artifact (10GB/bucket for asset libraries) |
| `STORAGE_QUOTA_EXCEEDED` | 507 | Instance-wide storage cap reached — an operator setting (`STORAGE_QUOTA_BYTES`), unset by default (unlimited) |
| `BLOB_LIMIT_EXCEEDED` | 400 | Max 1000 blobs per artifact (10,000 for asset-library buckets) |
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
| `INVALID_REQUEST` | 400 | Covers several job-creation failures via a shared message, not a distinct code each: the 5-jobs-per-UTC-day limit (`Job limit reached (5 per user)`, per-user not per-artifact), and over 10 recipients on `email`/`asset_delivery` destinations (`Maximum 10 recipients per email` / `per delivery`) |
| `INVALID_SCHEDULE` | 400 | Invalid cron expression |
| `CONNECTION_MISSING` | 400 | Job names a connection (`query_snapshot`, `materialize`, `sheets_append`, Slack bot) that doesn't exist on the artifact or its workspace — check `sdk.connection` / workspace connectors before creating the job, not after |

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

## Error Recovery

What to actually do when you hit these, beyond retrying blindly:

**429 rate limited** (`RATE_LIMITED` / `RATE_LIMIT_EXCEEDED`) — on publish (`POST
/v1/publish` and the session `/create` builder — both enforce the same cap), the body
and headers are actionable: `error` states the limit and reset time in words ("Daily
publish limit reached (100 per day). It resets at HH:MM UTC, in about N hours."), plus
`limit` / `remaining` / `reset` (unix seconds) / `retryAfter` (seconds) fields and
`X-RateLimit-Remaining` / `X-RateLimit-Reset` / `Retry-After` headers. Other surfaces
(AI chat, scheduled jobs) may only return the code — see the specific doc
([jobs.md](jobs.md), [team/workspace-assistant.md](../team/workspace-assistant.md)) for
their windows. Don't retry-loop past the limit — batch the work locally (build/validate
the full payload before making calls) and back off using `retryAfter`/`Retry-After` when
present, or wait for the stated reset.

**413 too large** (`FILE_TOO_LARGE` / `STORAGE_LIMIT_EXCEEDED` / `STORAGE_QUOTA_EXCEEDED`)
— check which cap: per-file (split the upload), per-artifact/per-bucket (delete unused
data or move heavy media to `sdk.blobs`/asset buckets instead of inline JSON), or the
instance-wide `STORAGE_QUOTA_BYTES` operator setting (only an operator can raise this —
don't tell the user to "upgrade," there's no plan to upgrade to; the message itself says
so: "ask your ShareOut admin to raise STORAGE_QUOTA_BYTES").

**Public artifact limit** — not an error at all: if the instance sets
`PUBLIC_ARTIFACT_LIMIT` and the account is at the cap, `POST /v1/publish` succeeds
(`201`) but silently publishes **privately** instead, with a `notice`: "Public artifact
limit reached (N per account). Published privately. Make another artifact private, or
ask your ShareOut admin to raise PUBLIC_ARTIFACT_LIMIT." Tell the user their page is
private, not that the publish failed.

**Visibility held** (`VISIBILITY_HELD` / `MODERATION_HELD`, both `202`) — these are not
failures, the write succeeded. Tell the user their page is "publishing shortly" / "under
automated review," not that it's broken or that they need to pay for anything:
- `VISIBILITY_HELD` — an operator has restricted public links on this instance and this
  publisher isn't in the rollout. Visibility fell back to `workspace` or `private`; only
  an instance operator can change the policy (`OPEN_VISIBILITY_DISABLED`).
- `MODERATION_HELD` — an automated content-safety check didn't clear instantly. It
  re-checks within the hour and goes public automatically — do not re-publish to "fix" it.

**No AI provider configured** — this instance has no platform AI key and the workspace
has no BYO key ([team/workspace-connections.md](../team/workspace-connections.md)). This
is a self-host configuration gap, not something the end user or a retry fixes. Two
different surfaces handle it differently:
- Visitor chat / pilot / admin-chat (raw REST): `INTERNAL_ERROR` (500), `message: "AI
  provider not configured (set VERCEL_AI_GATEWAY, ANTHROPIC_API_KEY or OPENAI_API_KEY)"`.
- The Home/workspace assistant ([team/workspace-assistant.md](../team/workspace-assistant.md)):
  no error at all — it replies in-thread, with an actionable "set this env var" message
  for admins and "ask your admin" for everyone else.

Either way, tell them to ask the instance operator to set a provider key or add a
workspace BYO key in Admin → AI — never suggest a billing upgrade.

## Related

- [Overview](overview.md) - API intro
