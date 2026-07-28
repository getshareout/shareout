# Slack Integration

Deliver artifacts to Slack — post to a channel, DM a user, or attach a rendered
snapshot/PDF — on a schedule, on an event, on demand, or from an AI Crew workflow.

> **Account-level DM bot:** For interactive chat with your pages in Slack (`/shareout`, AI agent, confirm-before-write), see [../agents/slack.md](../agents/slack.md). This doc covers **outbound delivery** only.

## Overview

Slack is a **workspace-level connection** (a Slack OAuth app, bot token stored
encrypted per workspace), unlike the per-artifact GitHub flow. Once a workspace has a
Slack connection, any artifact in that workspace can be delivered to Slack.

Slack is the first implementation of ShareOut's pluggable **destination layer** (see
[../api/destinations.md](../api/destinations.md)): the same delivery path is shared by
scheduled jobs, the one-shot share endpoint, and Crew's `notify_send` tool.

Key facts:

- **Connection scope:** per workspace, not per artifact. One workspace can hold several
  named Slack connections (e.g. `team`, `alerts`).
- **Bot scopes:** `chat:write`, `chat:write.public`, `channels:read`, `groups:read`,
  `files:write`, `im:write`, `team:read`. `im:write` enables DM delivery — if it's
  missing on an older connection, reconnect Slack.
- **Precondition:** Slack delivery fails until the workspace has a connection. Set one
  up before creating Slack jobs.

## Set up a workspace Slack connection

```text
1. GET /v1/workspaces/{id}/connections/slack/install?connection=team&returnUrl=…
2. Open the returned URL; authorize the Slack app for your workspace.
3. Slack redirects to /v1/oauth/slack/callback; ShareOut stores the bot token
   in connections (scope_type 'workspace', provider 'slack', name 'team').
4. List postable channels: GET /v1/workspaces/{id}/connections/team/slack/channels
```

## Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/v1/workspaces/{id}/connections/slack/install` | GET | Start Slack OAuth (302 to Slack) |
| `/v1/oauth/slack/callback` | GET | Shared OAuth callback (single redirect URI) |
| `/v1/workspaces/{id}/connections/{name}/slack/channels` | GET | List channels the bot can post to |
| `/v1/artifacts/{id}/deliver` | GET / POST | One-shot delivery status + send (email, Slack, Telegram) |
| `/v1/artifacts/{id}/deliver/slack-channels` | GET | Searchable channel list for Home Deliver picker |
| `/v1/artifacts/{id}/share/slack` | POST | Legacy one-shot Slack delivery (channel or DM) |
| `/v1/jobs` | POST | Recurring/event delivery (`action: "slack"`) |

## One-shot share — `POST /v1/artifacts/{id}/share/slack`

> **Home Inspector:** Prefer `POST /v1/artifacts/{id}/deliver` with `{ "action": "slack", "config": {…} }` — same config shape as jobs, plus a searchable channel picker via `GET /v1/artifacts/{id}/deliver/slack-channels` (no pasting channel IDs). See [../core/workspace-home.md](../core/workspace-home.md#inspector-right-rail).

```json
{
  "connection": "team",
  "targetType": "channel",
  "channelId": "C0123456789",
  "mode": "snapshot",
  "message": "Latest numbers"
}
```

DM a user instead:

```json
{ "connection": "team", "targetType": "dm", "slackUserId": "U0123456789", "mode": "pdf" }
```

- `mode`: `message` (text + link button), `snapshot` (PNG), `pdf`, or `both`.
- Channel posts require **owner/editor**; any viewer with access may DM **themselves**.

## Scheduled / event delivery

Use the Jobs API with `action: "slack"` and a `SlackConfig`. Full config reference and
cron/event semantics: [../api/jobs.md](../api/jobs.md#slackconfig).

```json
{
  "artifact_id": "art_abc123",
  "action": "slack",
  "schedule": "0 9 * * 1",
  "config": { "connection": "team", "channelId": "C0123456789", "mode": "snapshot" }
}
```

## Crew / AI workflows

A Crew run can deliver the current artifact to Slack via the `notify_send` tool
(one-shot) or `scheduled_job_create` (recurring). Pass `message` for the crew's own
narrative text (forwarded as `customMessage`; use `mode: "both"` to attach screenshot +
link). Both route through the destination
layer, so Slack, email, Discord, and webhooks behave identically. See
[../agents/overview.md](../agents/overview.md).

## Errors

| Error | Cause |
|-------|-------|
| `Slack connection '…' not found` | Workspace has no Slack connection by that name |
| `missing_scope` (on DM) | Connection lacks `im:write` — reconnect Slack |
| `channelId is required …` | Channel target without a `channelId` |
| `slackUserId is required …` | DM target without a `slackUserId` |

## Related

- [../api/jobs.md](../api/jobs.md) — scheduled & event jobs, `SlackConfig`
- [../api/destinations.md](../api/destinations.md) — the destination layer
- [overview.md](overview.md) — Data Platform connections
