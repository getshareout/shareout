# Slack Bot (Account-Level Agent)

Chat with your ShareOut pages from Slack DMs. After linking your account, a strictly-scoped AI assistant can find, read, and summarize your artifacts, run live REST data sources, send snapshots/PDFs, and — with your explicit **Confirm** button — pause alerts, share pages, run a crew, publish content edits, or write to a page's data.

> **Different from artifact chat:** `sdk.agent` is a **visitor-facing** chat widget inside a published artifact. The Slack bot is an **account-level** assistant that operates across all artifacts you can access.
>
> **Different from scheduled Slack delivery:** [../integrations/slack.md](../integrations/slack.md) covers one-shot and cron/event **outbound** posts to channels or DMs. This doc covers the **conversational** DM bot (`/shareout` + free text).

## Quick start

1. Install the ShareOut Slack app on a workspace and connect it under **Workspace → Connections** (OAuth bot token).
2. Open **ShareOut → Settings → Connect Slack**.
3. Pick the workspace connection; ShareOut matches your login email to your Slack profile (`users:read.email`).
4. Open a **DM with ShareOut** in Slack and try `/shareout help` or ask naturally: *"summarize the sales dashboard"*.

To disconnect, send `/shareout unlink` in the DM or link again from Settings (replaces the prior link).

## Commands

All commands use the `/shareout` slash command (subcommands mirror Telegram where possible):

| Command | Action |
|---------|--------|
| `/shareout help` | Show command list |
| `/shareout artifacts` | List pages in current scope (Block Kit cards) |
| `/shareout search {text}` | Search pages by name/slug |
| `/shareout workspaces` | List workspaces you can access |
| `/shareout workspace {slug}` | Switch scope to one workspace |
| `/shareout workspace all` | Search all accessible pages |
| `/shareout personal` | Personal pages only |
| `/shareout status` | Linked account + current scope |
| `/shareout settings` | Link to ShareOut settings |
| `/shareout support <what went wrong>` | Open a support ticket |
| `/shareout unlink` | Disconnect this DM |
| `/shareout snapshot {page}` | Agent sends a PNG |
| `/shareout pdf {page}` | Agent sends a PDF |
| `/shareout alerts` / `/shareout schedules` | List alerts / scheduled jobs |

Free-text messages (no slash) go to the same AI agent as Telegram.

## Workspace scope

Scope persists per linked Slack DM in `messaging_links.selected_workspace_id` (same semantics as Telegram: `null` = all, `__personal` = personal only, else workspace id).

## Artifact action cards

`/shareout artifacts` and `/shareout search` return **Block Kit cards** (up to 10):

| Button | Action |
|--------|--------|
| **Open Page** | Opens the live artifact URL |
| **Snapshot** | Renders PNG and sends in DM |
| **PDF** | Renders PDF and sends in DM |
| **Ask AI** | Starts an agent turn about that page |

Write proposals (share, edit, crew, table/json writes) show **Confirm / Cancel** buttons; nothing runs until Confirm.

## What the bot can do

Same tool suite as the Telegram account assistant (shared `chat-agent/` loop). See [telegram.md](telegram.md#what-the-bot-can-do) for the full tool table — capabilities and confirmation rules are identical.

## Security model

Identical to Telegram: every tool resolves access through the same gates as the data API (owner, collaborator, workspace member, row-level `access_policy`). Credentials stay server-side.

Linking stores `messaging_links` with `platform = 'slack'`, `session_key = '{team_id}:{user_id}'`, and the workspace `connection_name` holding the bot token used for replies.

## Rate limits & feature flag

Per-user AI chat quota (`checkAiChatLimit`). Gated by feature flag **`ai.slack_bot`** (see [../api/features.md](../api/features.md)).

## For operators (not agent authors)

Production requires:

- Workspace Slack connection (OAuth bot token with `im:history`, `im:write`, `users:read.email`, `commands`, etc.)
- `SLACK_SIGNING_SECRET` worker secret
- Slack app manifest endpoints:
  - Events: `$ORIGIN/slack/events` (`message.im`)
  - Slash command: `$ORIGIN/slack/commands` (`/shareout`)
  - Interactivity: `$ORIGIN/slack/interactions`
- D1 migrations `0074_messaging_links`, `0075_messaging_links_connection`

Webhook handlers return HTTP 200 quickly; turns serialize per DM in `ChatSessionDO` with deduplicated event ids.

**Not yet:** channel `@mentions`, `chat.unfurl` (Phase 5).

## Related

- [telegram.md](telegram.md) — Telegram account bot (feature parity reference)
- [../integrations/slack.md](../integrations/slack.md) — Outbound Slack delivery (jobs, alerts, one-shot share)
- [../api/jobs.md](../api/jobs.md) — Scheduled delivery (`action: slack`)
- [overview.md](overview.md) — In-artifact `sdk.agent` chat widget
