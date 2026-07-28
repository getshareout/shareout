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
