# Telegram Bot (Account-Level Agent)

Chat with your ShareOut pages from Telegram — by **text or voice**. After linking your account, a strictly-scoped AI assistant can find, read, and summarize your artifacts, run live REST data sources, send snapshots/PDFs, and — with your explicit ✅ confirmation — pause alerts, share pages, run a crew, publish content edits, or write to a page's data (add/update table records, set JSON values).

> **Different from artifact chat:** `sdk.agent` is a **visitor-facing** chat widget inside a published artifact. The Telegram bot is an **account-level** assistant that operates across all artifacts you can access.

## Quick start

1. Open **ShareOut → Settings → Connect Telegram**
2. Tap the deep link (one-time code, 15-minute TTL)
3. Message the bot — ask it to find a page, summarize a report, pull fresh numbers, or send a snapshot

If the link expires, generate a fresh one from Settings. A slash-command menu is registered on link for common actions.

## Voice messages

Send a **voice note** (or forward an audio file) instead of typing. The bot transcribes it with Cloudflare Workers AI Whisper (`@cf/openai/whisper-large-v3-turbo`, automatic language detection — Spanish/English/etc.), echoes back what it heard (`🎙️ "…"`), then handles the transcript exactly like a typed message — **spoken slash commands work too** (e.g. saying "snapshot the sales dashboard").

- **Limits:** up to ~10 minutes / 20 MB per clip. Longer/larger clips are politely rejected.
- **Cost tracking:** each transcription is logged to the `ai_usage_events` ledger (audio-seconds + computed cost) for visibility in **Admin → Tokens → AI usage**. It is *tracking-only* — not billed to any workspace balance, consistent with the account-agent's LLM turns.
- **Requires** the `[ai]` Workers AI binding (already used for semantic search).

## Workspace scope

Telegram remembers which pages to search/list for this chat:

| Command | Action |
|---------|--------|
| `/workspaces` | Show workspace picker (inline buttons) |
| `/workspace {name}` | Switch to a workspace by name/slug |
| `/personal` | Personal pages only (exclude workspace artifacts) |
| `/status` | Show linked account email and current scope |

Default scope includes **all pages** you can access across personal + workspaces. Workspace selection persists per chat (`0062_telegram_workspace_selection` migration). Linked accounts (identity groups) are honoured — a personal login can see artifacts from linked workspace accounts.

## Artifact action cards

`/artifacts` and `/search` return **tappable cards** (up to 10) instead of plain text:

| Button | Action |
|--------|--------|
| **Open Page** | Opens the live artifact URL |
| **Snapshot** | Renders PNG and sends in chat |
| **PDF** | Renders PDF and sends in chat |
| **Ask AI** | Starts an agent turn about that page |
| **Share** | Starts a share-by-email flow |

Slash shortcuts mirror the cards: `/snapshot {page}`, `/pdf {page}`, `/refresh {page}`, `/share {page} with {email}`, `/edit {page}: {change}`, `/crew {page}: {task}`, `/support {what went wrong}` (alias `/bug`), `/alerts`, `/schedules`.

## What the bot can do

### Read & media tools (immediate)

| Tool | Capability |
|------|------------|
| `list_artifacts` | List pages you can access |
| `search_artifacts` | Search by name/slug |
| `read_artifact` | Read HTML-as-text, JSON state, scoped table samples, blob metadata |
| `list_data_sources` | List live REST connections on an artifact |
| `run_data_source` | Execute a live REST query (owner or workspace member only) |
| `send_snapshot` | Render a page to PNG and send it in chat |
| `send_pdf` | Render a page to PDF and send it in chat |

**Not yet wired:** live warehouse queries (Snowflake/BigQuery). Those reports are read via materialized data + HTML content instead.

### Write tools (✅/❌ confirmation required)

Destructive or mutating actions **never run until you tap Confirm** on an inline keyboard. Permission is re-checked at execution time.

| Tool | Capability | Who |
|------|------------|-----|
| `list_alerts` | List your metric alerts (id, name, metric, enabled) | Any linked user |
| `list_jobs` | List your scheduled jobs | Any linked user |
| `manage_alert` | Pause, resume, or delete a metric alert | Alert owner |
| `manage_job` | Pause, resume, or delete a scheduled job | Job owner |
| `share_artifact` | Invite collaborators by email | **Owner only** |
| `ask_crew` | Run the page's crew with a custom instruction | Owner or editor |
| `edit_page` | Change content/copy/layout via the editor agent; publishes live on ✅ | Owner or editor |
| `add_table_row` | Add a record to a page's SDK data table (`sdk.table()`) | Owner or editor |
| `update_table_row` | Change an existing record — by row id, or every row matching a filter | Owner or editor |
| `set_json_value` | Set a key in a page's JSON store (`sdk.json`) | Owner or editor |

`edit_page` reuses the server-side editor agent (`proposeEdit` → staged edits → publish on confirm). If the agent only answers a question (no staged files), the bot relays the reply instead of showing buttons.

The data-write tools go through the same handlers as the data API (row/key limits and validation are identical) and honour the row-level `access_policy` — so a row-scoped editor can only write within their scope, and the JSON store stays owner/editor-only when a policy is active. The bot adds to **existing** tables only (it won't create one from chat); ask `read_artifact` first to learn a table's columns or the JSON keys before shaping the write.

## Security model

Every tool call resolves access through the same gate as the data API:

| Access path | Bot sees artifact? |
|-------------|-------------------|
| Owner | Yes — full access |
| Collaborator (explicit share) | Yes — role + row-level `access_policy` honoured |
| Workspace member + `visibility: workspace` | Yes — viewer role + row-level policy |
| Private artifact in workspace (not shared) | **No** |
| Public link only | **No** (unless you are owner/collaborator) |

- Credentials stay server-side; the bot never receives API tokens.
- Row-level `access_policy` filters apply to table samples (unlike Crew, which bypasses them).
- Live connection queries require owner or workspace-member access (`canRunConnections`).
- Write proposals are stored per-chat in the coordinator DO and consumed once on tap.

## Rate limits

Per-chat rate limiting reuses the same AI chat quota as in-app agent chat (`checkAiChatLimit`). Gated by feature flag `ai.telegram_bot` (see [../api/features.md](../api/features.md)).

## Linking details

- One ShareOut user can link multiple Telegram chats.
- Linking stores a `messaging_links` row (`platform='telegram'`, session_key = chat id ↔ user_id).
- Unlink by removing the connection in Settings (or `/unlink` if implemented in UI).
- **Delivery destination:** omit `chatId` in a Telegram job/alert config to deliver to your own linked chat (see [../api/jobs.md](../api/jobs.md#telegramconfig)).

## Related

- [overview.md](overview.md) — In-artifact `sdk.agent` chat widget
- [../api/jobs.md](../api/jobs.md) — Scheduled delivery (including `action: telegram`)
- [../api/metric-alerts.md](../api/metric-alerts.md) — Metric alerts (including Telegram destination)
- [../api/destinations.md](../api/destinations.md) — Shared delivery layer
- [../integrations/slack.md](../integrations/slack.md) — Slack delivery
- [../core/access-policy.md](../core/access-policy.md) — Row-level viewer filtering
