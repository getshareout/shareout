# REST API: Feature Flags

ShareOut features can be turned on/off per workspace by the platform owner. An
account may not have every module enabled. **Before using a gated module (AI
agents, schedules, alerts, a specific delivery destination, an integration),
check what is enabled — and always handle a `FEATURE_DISABLED` rejection.**

## Check what's enabled

```
GET /v1/features
GET /v1/features?workspace_id=<id>
GET /v1/features?artifact_id=<id>
```

Auth: ShareOut API token or session. With `artifact_id`/`workspace_id` you get
that workspace's effective flags (you must have access); with no param you get
the personal/global defaults.

Response:

```json
{
  "scope": { "workspace_id": "wsp_123" },
  "features": { "ai.crew": true, "dest.slack": false, "automation.scheduled_jobs": true },
  "disabled": ["dest.slack"],
  "catalog": [
    { "key": "ai.crew", "label": "CrewAI agents", "category": "ai", "description": "...", "enabled": true }
  ]
}
```

- `features` — quick `key → boolean` map. Read this to decide what to attempt.
- `disabled` — the keys that are off (what to avoid / ask the owner to enable).
- `catalog` — full registry with labels/categories for display.

## Handling a rejection

Any gated endpoint returns **403 `FEATURE_DISABLED`** when the feature is off:

```json
{
  "error": "\"Slack\" is not enabled for this workspace. Ask the workspace owner/admin to enable it, or use a different approach. See GET /v1/features for the full list of what is enabled.",
  "code": "FEATURE_DISABLED",
  "feature": "dest.slack",
  "feature_label": "Slack",
  "docs": "/v1/features"
}
```

When you get this: don't retry the same call. Pick a different enabled approach
(e.g. another delivery destination), or tell the user the module is off for
their account and that a workspace owner can enable it. Call `GET /v1/features`
to see the alternatives.

## Feature keys

| Key | Module |
|-----|--------|
| `ai.crew` | CrewAI agents |
| `ai.visitor_chat` | In-artifact AI chat |
| `ai.editor_chat` | Editor AI assistant |
| `ai.create` | AI Creator at `/create` (chat-first artifact builder) |
| `ai.telegram_bot` | Telegram bot |
| `ai.slack_bot` | Slack DM bot |
| `ai.web_agent` | Workspace home assistant (concierge + read-only connector queries) |
| `automation.scheduled_jobs` | Schedules & crons |
| `automation.event_triggers` | Event-triggered jobs |
| `automation.notifications` | Alerts & notifications |
| `dest.slack` / `dest.discord` / `dest.webhook` / `dest.email` / `dest.http_get` / `dest.materialize` | Delivery destinations (individually) |
| `integ.data_platform` | Data Platform connectors (Sheets, GA, Shopify, Snowflake, BigQuery, Postgres) |
| `integ.connections` | Workspace connections |
| `integ.github` | GitHub export |
| `integ.cors_proxy` | CORS proxy |
| `collab.realtime` | Realtime collaboration |
| `collab.comments` | Comments |
| `module.visual_editor` | Live Studio (HTML visual editor at `/a/{slug}/edit`) |
| `module.slides` / `module.python` / `module.blobs` / `module.email_templates` | Modules |

> Workspace members can also view (read-only) their enabled features at
> `GET /v1/workspaces/<id>/features`. Only ShareOut platform owners change them.
