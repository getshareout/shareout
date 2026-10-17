# Artifact Crew (autonomous agents)

Each artifact can run a **crew** — an autonomous agent with tools to query data, refresh snapshots, write JSON summaries, deliver to destinations, and more. Crews are triggered on a schedule, by metric-alert follow-up (`on_trigger`), from the Telegram bot (`ask_crew`), or manually via the crew API.

> **Different from in-artifact chat:** `sdk.agent` is a visitor-facing widget inside the published page. Crew runs server-side with owner-scoped tools. See [overview.md](overview.md) for visitor chat.

## Refresh → narrate → deliver

A common automation chain for warehouse-backed dashboards:

1. **Refresh (deterministic)** — a `query_snapshot` cron job runs fixed SQL against a workspace connection and writes results into `sdk.json` (or a table/dataset). No LLM; SQL lives in job config. See [../api/jobs.md](../api/jobs.md#querysnapshotconfig).
2. **Narrate (crew)** — a scheduled crew reads the refreshed json, calls `json_set` to store a summary, and uses `connection_query` for small follow-up lookups if needed.
3. **Deliver (crew or job)** — `notify_send` posts the narrative (+ optional snapshot/PDF) to Slack/Telegram/email, or a separate delivery job runs on the same schedule.

Use `query_snapshot` when SQL is stable; use crew `materialize_query` when the agent should decide what to refresh interactively.

## Data tools

### `connection_query` (read)

Query a workspace connection by name. Works for REST (`query = "GET /endpoint"`) **and** SQL warehouses like BigQuery (`query` = SQL string; pass `params.projectId` for BigQuery). Returns rows to the crew context — best for aggregates and small result sets.

Runs on the **artifact owner's** per-user credentials when the connection is `per_user`, so unattended crews can query BigQuery the same way the interactive data API does.

### `materialize_query` (write)

Run a connection query and **save** results without loading every row into the conversation. Targets:

| `target.type` | Writes to |
|---------------|-----------|
| `table` | `sdk.table(name)` |
| `dataset` | `sdk.dataset(name)` |
| `json` | `sdk.json` key `name`; optional `path` merges at a field inside the key's object |

```jsonc
{
  "connection": "team_bigquery",
  "query": "SELECT * FROM `project.dataset.table` LIMIT 500",
  "params": { "projectId": "my-gcp-project" },
  "target": { "type": "json", "name": "snapshot", "path": "rows" }
}
```

### `json_set` (write)

Owner-scoped write to the artifact JSON store. Creates or replaces a key; optional `path` sets one field inside the key's object (same merge semantics as materialize json targets). Blocked when a row-level `access_policy` is active (JSON store is owner/editor-only under a policy).

Use for computed summaries, status flags, or narratives the page reads on next load.

## Delivery tools

### `notify_send` (write, always requires approval)

One-shot delivery via the shared destination layer (Slack, email, Discord, webhook). Pass a top-level `message` to send the crew's own narrative text — it is forwarded as the destination's `customMessage` (Slack `mode: "both"` attaches screenshot + link alongside the message).

```jsonc
{
  "destination": "slack",
  "message": "*Daily summary*\nRevenue up 12% vs yesterday.",
  "source": {
    "connection": "acme_snowflake",
    "query": "SELECT SUM(amount) FROM orders WHERE day = CURRENT_DATE",
    "asOf": "2026-06-22"
  },
  "config": {
    "connection": "team",
    "channelId": "C0123456789",
    "mode": "both"
  }
}
```

**Always pass `source`** when delivering data-derived numbers — `{ connection|label, query, asOf, tables?, columns?, filters? }`. A compact attribution footer is appended (`_Source: … · as of …_` plus Tables/Columns/Filters lines or a clipped one-line query) so recipients can trace where the figures came from. State the source + as-of in your narrative too. See [patterns/data-provenance.md](../patterns/data-provenance.md).

### `scheduled_job_create` (write)

Create a recurring delivery job (`POST /v1/jobs` under the hood). Config shapes match [../api/jobs.md](../api/jobs.md).

## Collaboration tools

### `comment_create` (write)

Post a comment on the artifact. Requires comments enabled and owner/editor identity.

### `action_item_create` / `action_item_list` (write / read)

Create or list **action items** — comments assigned to a workspace member or collaborator with an optional due date. The assignee is notified by email and Telegram. See [../sdk/comments.md](../sdk/comments.md#action-items).

## Workspace reporting

### `workspace_metrics_digest` (read)

One call returns a compact weekly picture of the artifact's **workspace** (never any other):
artifacts created / updated / deleted / live and the new ones with links; views (top pages,
member viewers, internal vs external, deck sessions); people (active creators and viewers,
new members, per-member activity and AI tokens); AI usage and cost by mode, kind, person and
artifact; scheduled job runs and failures, crew runs; storage now and per day; and usefulness
signals — comments and resolutions, action items (done / open / overdue), approvals, shares,
returning viewers, pages viewed by someone other than their creator, dormant pages, median
views per page, RUM p75. Includes the previous period with `deltas`, the workspace `admins`
(name + email) and `notes` explaining anything a source could not answer.

Only works when the crew **owner** is an owner/admin of the workspace (or an instance
super-admin); anyone else gets `{ "error": … }`.

```jsonc
{ "period": "previous_week", "tz_offset_minutes": -180 }   // last full Mon→Mon week in UTC-3
{ "period": "last_days", "days": 14, "compare": false }    // last 14 days ending now
```

`period` is `last_days` (default; `days` 1–31, default 7) or `previous_week`; `compare`
defaults to `true`. The exact UTC bounds used come back in `period.from` / `period.to`.

### Recipe: weekly workspace report

A crew on any artifact in the workspace, owned by a workspace admin, mails the admins every
Monday morning:

```jsonc
// POST /v1/data/{id}/crew/define — Sonnet 5.5 by default; any gateway model works
{
  "name": "Weekly workspace report",
  "model": "anthropic/claude-sonnet-5.5",
  "instructions": "Call workspace_metrics_digest with period \"previous_week\" and tz_offset_minutes -180. Write a short, plain HTML email: what was published, what people actually used (views, returning viewers, comments, action items), what is dormant, AI and job health, and the biggest changes vs the week before. Use only numbers from the tool and respect its notes. Send it with email_send to every address in admins.",
  "tools": {
    "read": ["workspace_metrics_digest"],
    "write": ["email_send"],
    "approval": { "email_send": "never" }
  }
}
// POST /v1/data/{id}/crew/triggers — Monday 11:00 UTC (08:00 in UTC-3)
{ "kind": "cron", "cron": "0 11 * * 1" }
```

## REST API

All routes live under the artifact's data API and are **artifact-owner only** (owner's
`Authorization: Bearer so_…` token or session; others get `403`). Responses use the data
envelope `{ "success": true, "data": … }`. One crew per artifact.

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/data/{id}/crew` | `{ crew, grants[] }`; `404` if none defined |
| POST | `/v1/data/{id}/crew/define` | Create or replace the crew (upsert). Body below. Grants are rewritten from `tools` |
| POST | `/v1/data/{id}/crew/run` | `{ "input": "…" }` (optional). Streams **SSE** events: `run_start`, `reasoning`, `tool_call`, `tool_result`, `finish`, `error`, `done`. `429 CONCURRENCY_LIMIT` when too many runs are active |
| GET | `/v1/data/{id}/crew/runs` | Last 20 runs |
| GET | `/v1/data/{id}/crew/runs/{runId}` | `{ run, events[] }` |
| GET | `/v1/data/{id}/crew/runs/{runId}/stream` | Replays a run's stored events as SSE |
| GET / POST | `/v1/data/{id}/crew/triggers` | List / create a trigger |
| PATCH / DELETE | `/v1/data/{id}/crew/triggers/{triggerId}` | Update (`enabled`, `cron`, `eventType`) / delete |
| GET | `/v1/data/{id}/crew/approvals?status=pending` | Pending write-tool approvals |
| POST | `/v1/data/{id}/crew/approvals/{approvalId}/approve` \| `/reject` | Approve (executes the tool) or reject |

```jsonc
// POST /v1/data/{id}/crew/define
{
  "name": "Daily narrator",
  "instructions": "Read json key `snapshot`, write a 3-line summary to `summary`, then notify Slack.",
  "model": "anthropic/claude-sonnet-5.5",   // optional — see "Model" below
  "maxIterations": 8,                 // clamped to the plan cap
  "runBudgetMicroUsd": 200000,        // optional
  "tools": {
    "read":  ["json_get", "table_query", "connection_query"],
    "write": ["json_set", "notify_send"],
    "approval": { "json_set": "never" },   // never | always | whenPublic
    "limits": { "connection_query": { "maxRows": 500, "maxCalls": 5 } }   // maxRows/maxCalls/maxBytes/maxResults
  }
}
```

**Model.** `model` takes any tool-capable [Vercel AI Gateway](https://vercel.com/ai-gateway/models)
model id (`provider/model`, e.g. `anthropic/claude-sonnet-5.5`, `openai/gpt-5`,
`deepseek/deepseek-v4.1-flash`), or a Claude id (`claude-haiku-4-5`). Omit it to follow the
workspace's gateway model (admin LLM settings), else the instance default. Anything else is a
`400 INVALID_REQUEST` — nothing silently runs on a different model. A gateway id is checked
against the live gateway catalog; if the catalog is unreachable, a well-formed
`provider/model` id is accepted. `GET /crew` returns the stored `model`. On instances
without a gateway key, a non-Claude model falls back to the native Anthropic entry's own
Claude model.

Tool names — read: `table_query`, `table_schema`, `json_get`, `file_list`, `file_read`,
`web_search`, `connection_query`, `action_item_list`, `workspace_metrics_digest`. Write: `json_set`, `table_insert`,
`table_update`, `comment_create`, `action_item_create`, `email_send`, `materialize_query`,
`scheduled_job_create`, `notify_send`, `pilot_verify`. Unknown names, or a name listed under
the wrong mode, are ignored silently — check `grants` in `GET /crew` after defining.

Triggers (`POST /crew/triggers`):

```jsonc
{ "kind": "cron", "cron": "0 9 * * 1-5" }                     // hourly-granular worker cron
{ "kind": "event", "eventType": "table.row.inserted" }          // only supported event
{ "kind": "condition", "condition": {                           // checked hourly
    "predicate": { "table": "orders", "where": { "status": "late" }, "op": "gt", "value": 5 },
    "cooldownSeconds": 86400 } }
```

There is no crew catalog/template endpoint; define each crew per artifact.

## Permissions & limits

- Crew tools run with **owner** identity (`principal.ownerId`) for data writes and warehouse queries.
- Write tools may require owner approval when the artifact is public (`whenPublic`) or always (`notify_send`).
- Feature flag `ai.crew` must be enabled for the workspace. See [../api/features.md](../api/features.md).
- Per-user connectors work for crew warehouse queries; scheduled `materialize`/`query_snapshot` jobs still need shared connectors or owner-linked credentials.

## Related

- [../api/jobs.md](../api/jobs.md) — `query_snapshot`, event triggers, delivery configs
- [../api/destinations.md](../api/destinations.md) — destination layer shared by jobs and crew
- [../integrations/slack.md](../integrations/slack.md) — Slack delivery from `notify_send`
- [telegram.md](telegram.md) — `ask_crew` from Telegram
