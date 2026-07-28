---
title: Storing data
description: JSON keys, tables, and file blobs for every artifact.
---

Every artifact has its own storage — no separate database to provision. Three
shapes, one base path: `/v1/data/{artifactId}`.

## JSON store

A **key-value** store of JSON values per artifact. Each key holds one JSON
document (object, array, string, number, …). Good for settings, small state, and
cached snapshots.

```bash
# List keys
curl -H "Authorization: Bearer $TOKEN" \
  https://shareout.site/v1/data/art_abc123/json

# Read one key
curl -H "Authorization: Bearer $TOKEN" \
  https://shareout.site/v1/data/art_abc123/json/prefs

# Set a key (body is the JSON value itself)
curl -X PUT https://shareout.site/v1/data/art_abc123/json/prefs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "theme": "dark", "views": 42 }'
```

Limits (defaults): **1 MB per value**, **1000 keys** per artifact. Prefer
[tables](/sdk/tables/) for many structured records, or [datasets](/sdk/datasets/)
for large extracts.

From the browser SDK: `sdk.json.get/set/list` — see [JSON store](/sdk/json/).

## Tables

Structured rows for lists, submissions, and records. List the tables on an
artifact:

```bash
curl -H "Authorization: Bearer $TOKEN" \
  https://shareout.site/v1/data/art_abc123/tables
```

Tables also power **row-level access policies** — filter rows per viewer so each
customer sees only their own data. Set `access_policy` on publish.

## Shared workspace tables (Teams)

A table is private to its artifact by default. On a Teams workspace, the owning
artifact can share one of its tables so **other artifacts in the same workspace**
read or write it — one page collects, another displays. The data stays in the owner
artifact; sharing is an opt-in grant at `read` or `readwrite` level.

```bash
# Owner shares its "leads" table read-only with the workspace
curl -X POST https://shareout.site/v1/data/art_form/workspace/_share \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{ "table": "leads", "as": "leads", "access": "read" }'

# Another artifact reads it by its shared name (same table query API)
curl -X POST https://shareout.site/v1/data/art_dashboard/workspace/tables/leads/query \
  -H 'Content-Type: application/json' -d '{}'

# List everything shared into a workspace
curl -H "Authorization: Bearer $TOKEN" \
  https://shareout.site/v1/workspaces/wsp_123/shared-tables
```

Writing to a `read`-only shared table returns `403 FORBIDDEN`. From the browser SDK
this is `sdk.workspace.table(name)` / `sdk.workspace.shareTable(...)` — see
[Tables → Share a table across artifacts](/sdk/tables/#share-a-table-across-artifacts-teams).

## Blobs (files)

Upload images, video, audio, and documents as `multipart/form-data`:

```bash
curl -X POST https://shareout.site/v1/data/art_abc123/blobs \
  -H "Authorization: Bearer $TOKEN" \
  -F file=@chart.png
```

| Constraint | Value |
| --- | --- |
| Per file (hard cap) | 50 MB (artifact uploads) · up to 500 MB for datasets |
| Per artifact blobs | 500 MB total · max 1000 files |
| Instance storage | Set with `STORAGE_QUOTA_BYTES` (0 = unlimited) |

Allowed types: PNG, JPEG, GIF, WebP, SVG; MP4, WebM; MP3, WAV, OGG; PDF, TXT,
CSV, Markdown.

See the full endpoints in the [API reference](/api/operations/uploadblob/).

## Datasets & live sources

- **Datasets** — versioned JSON/CSV extracts in R2: [Datasets](/sdk/datasets/)
- **Connections** — REST / warehouse query + materialize: [Connections](/sdk/connections/)
- **Live data in published HTML** — [Live data](/sdk/live-data/)

## Instance storage caps (self-host)

Self-hosted instances do not use SaaS Free/Pro plan tables. Cap storage with Worker
env vars:

| Env | Meaning |
| --- | --- |
| `STORAGE_QUOTA_BYTES` | Total bytes per workspace (or personal owner). `0` / unset = unlimited |
| `STORAGE_MAX_FILE_BYTES` | Single-file cap for datasets and large uploads. `0` / unset = unlimited (still subject to the 500 MB code hard cap) |

Over-quota writes return `STORAGE_QUOTA_EXCEEDED` (507); oversize files return
`FILE_TOO_LARGE` (413).
