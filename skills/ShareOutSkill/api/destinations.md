# Destinations (the delivery layer)

ShareOut delivers an artifact to a **destination** — Slack, email, Discord, a webhook,
an HTTP endpoint, or a materialized dataset. Every destination implements one shared
interface, so the same delivery runs identically whether it's triggered by a schedule,
an artifact event, a one-shot API call, or an AI Crew workflow. Slack is just one
destination; email is another; more can be added without changing callers.

## Destination kinds

| Kind | What it does | Config |
|------|--------------|--------|
| `slack` | Post to a Slack channel or DM a user (message / snapshot / PDF) | `SlackConfig` |
| `email` | Send to recipients (templates, artifact content) | `EmailConfig` |
| `discord` | Post to a Discord webhook | `DiscordConfig` |
| `telegram` | Message / snapshot / PDF to a linked Telegram chat | `TelegramConfig` |
| `webhook` | HTTP request with artifact payload | `WebhookConfig` |
| `http_get` | Simple GET ping | `HttpGetConfig` |
| `materialize` | Re-run a connection query → store as dataset/table/json | `MaterializeConfig` |
| `query_snapshot` | Deterministic multi-query refresh against one connection | `QuerySnapshotConfig` |

All config shapes are documented in [jobs.md](jobs.md).

## How delivery is triggered

| Path | Use |
|------|-----|
| `POST /v1/jobs` (`action: <kind>`) | Recurring (cron) or event-driven delivery |
| `POST /v1/artifacts/{id}/deliver` | One-shot delivery (email, Slack, or Telegram) from Home Inspector or API |
| `POST /v1/artifacts/{id}/share/slack` | Legacy one-shot Slack delivery (channel or DM) |
| Crew `notify_send` tool | One-shot delivery from an AI workflow |
| Crew `scheduled_job_create` tool | Recurring delivery created by an AI workflow |

Whichever path is used, the destination's config is the same shape — learn the config
once, use it everywhere.

## Access & permissions

- **Owner/editor** of an artifact can deliver to any destination (channels, arbitrary
  recipients).
- **Viewers** with access can schedule **self-delivery only** — a Slack DM to themselves,
  an email to their own account address, or a Telegram message to their own linked chat.
- A job's **creator or the artifact owner** can pause/delete/run it; the owner sees every
  schedule on their artifact via `GET /v1/jobs?artifact_id=…`.
- Every scheduled run **re-checks** the creator still has access; if access was revoked,
  the job auto-pauses.

## Related

- [jobs.md](jobs.md) — scheduling, config interfaces, cron/events
- [../integrations/slack.md](../integrations/slack.md) — Slack connection setup
- [templates.md](templates.md) — email templates
