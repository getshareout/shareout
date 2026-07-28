---
title: Workspace assistant
description: AI concierge on the workspace home — orientation, page creation, connector queries, schedules, and named chat threads.
---

import { Aside } from '@astrojs/starlight/components';

The **workspace assistant** is a chat helper on the workspace home page. Signed-in
members can ask questions about their pages, connectors, and team — and (when
enabled) run **read-only** queries against warehouse connectors.

It shares one agent engine with the [Telegram](/guides/telegram-bot/) and
[Slack](/guides/slack-bot/) bots — same tool selection, confirmation flow, and
conversation storage contract. Telegram and Slack now also get connector queries
and schedule proposals (not only the web surface). Web Home is scoped to one
workspace and one signed-in user.

## Availability

Gated by the `ai.web_agent` feature flag. **Pro and Teams workspaces** have it
on by default. **Free** workspaces see an upgrade prompt with a billing link
instead of the chat dock. Super-admins can still toggle it per workspace via the
[Features](/teams/admin/#features) API or admin UI.

When disabled, the Home agent dock is hidden and the API returns `404`. Chat runs
on the workspace's own provider key — see [Teams API → AI](/teams/api/).

## What it can do

| Capability | Notes |
| --- | --- |
| Orientation | Lists pages, connectors, and member count from a lightweight workspace snapshot |
| **Workspace search** | `search_workspace` — ranked fuzzy search across pages, folders, datasets, connectors, people, schedules, crew, and alerts (same engine as ⌘K) |
| **Create pages** | `create_artifact` builds and publishes a brand-new page from a description — requires confirmation before publish |
| **Build from a file** | Pass `source_file_id` on `create_artifact` after `read_file` — spreadsheets, decks, and CSVs become live pages |
| **File library** | `list_files` / `read_file` — browse uploads, chat attachments, emailed-in files, and phone shares; see provenance and prior artifacts built from the same file |
| Edit existing pages | `edit_page` for copy/layout changes on a page that already exists |
| Read-only connector queries | Ad-hoc `SELECT` against connectors with **AI query** enabled (off by default) |
| Propose schedules | Suggests a cron job (e.g. email a page weekly) — requires explicit confirmation |
| Named threads (web) | ChatGPT-style history drawer — create, rename, delete threads; auto-titled from first message |
| Inline widgets (web) | Rich cards in the thread (artifact previews, connector results) — not sent to Telegram/Slack |
| Conversation history | Last 20 turns per thread, stored server-side |
| Proactive daily brief | Once per day on Home open — short AI catch-up via `GET /v1/home/agent/brief` |
| **Present this** | `present_artifact` — AI-generate a slides deck from an existing published page |
| **Metric watch** | `watch_metric` — one-click table watch (bell-only anomaly alerts) |

Destructive or write actions always go through a **confirmation** step. The
assistant cannot mutate arbitrary data stores or run non-`SELECT` SQL, but
**can publish a new page** after you confirm a `create_artifact` proposal.

<Aside type="caution">
Connector queries are opt-in per connector. Admins toggle **AI query: On** in the
workspace connectors panel. Use read-only credentials — the SQL guard allows only
a single `SELECT` statement.
</Aside>

## UI

On [workspace Home](/everyone/your-workspace/), the bottom **Ask your workspace…**
pill opens a resizable chat **sheet** (default height `min(480px, 52vh)`). Drag the
top grip to resize; double-click toggles full viewport height. The panel includes
a thread history drawer, streaming text, and inline widgets. Replies arrive over
Server-Sent Events (SSE). Collapse with **Esc**, the scrim, or minimize — the
workspace stays visible behind the dimmed overlay.

**⌘K answer mode** is a separate, lighter path: type a question ending with `?` in
the command palette for a single-turn answer with page citations — no thread, no
tools, no publish. Use the dock when you need multi-turn chat, file attach, or
`create_artifact`.

### Voice input

When your browser supports recording, a **microphone** button appears in the composer.
Tap once to start recording, tap again to stop. Audio is transcribed server-side
(Whisper via Workers AI — same engine as the [Telegram bot](/guides/telegram-bot/))
and dropped into the text box for you to review before sending. Clips up to about
10 minutes are accepted; the browser must grant microphone permission.

### File attachments

A **paperclip** in the composer uploads a file into your asset library and attaches
it to the next message. The assistant sees a `[Attached file: … — file id …]` reference
and can call `read_file` to parse spreadsheets (sheet schemas + sample rows),
presentations (slide text), or plain text before proposing `create_artifact`.

If you **Share → ShareOut** from another app on a phone with the ShareOut PWA
installed, Home opens with the file already attached in the composer — ready to
ask *"turn this into a dashboard."*

Files emailed to the workspace inbox (`{slug}@inbox.shareout.site`) also appear in
`list_files` with an *emailed in* origin label. When a filename previously built
an artifact, the assistant is prompted to **update** that page instead of creating
a duplicate.

Streaming uses **reading-first** scroll behaviour (shared with the editor agent,
create builder, and visitor chat widgets):

- After you send a message, your turn stays anchored near the top while the answer
  streams into the space below — the view does not jump unless you are already at
  the live edge.
- Scroll away or select text inside the thread and new content **does not move you**;
  an unread badge and **jump to latest** appear instead.
- **In-thread search** filters messages without losing your place.
- Reopening a saved thread resumes at your **last user message**, not the bottom.

Home-scoped routes use `/v1/home/agent/…`; workspace-scoped routes use
`/v1/workspace/{workspaceId}/agent/…` — same capabilities, different scope key.

## REST API

All routes require a signed-in session or bearer token and workspace membership.
The `ai.web_agent` flag must be enabled.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/v1/home/agent/chat` or `/v1/workspace/{id}/agent/chat` | Send a message; SSE stream. Optional `thread_id`. |
| `POST` | `…/agent/confirm` | Approve a pending action (`{ "token": "…" }`) |
| `GET` | `…/agent/brief` | Proactive daily brief (Home only) |
| `GET` | `…/agent/media/{token}` | Fetch media the assistant attached to a reply |
| `GET` | `…/agent/threads` | List named threads (web only) |
| `POST` | `…/agent/threads` | Create a thread (`{ "title"?: "…" }`) |
| `POST` | `…/agent/threads/{id}/rename` | Rename (`{ "title": "…" }`) |
| `DELETE` | `…/agent/threads/{id}` | Delete thread and its messages |
| `POST` | `…/agent/transcribe?seconds=` | Transcribe voice clip (raw audio body) → `{ "text" }` |

### Chat (SSE)

```http
POST /v1/workspace/{workspaceId}/agent/chat
Authorization: Bearer {token}
Content-Type: application/json

{ "text": "Which connectors do we have?" }
```

The response is `text/event-stream`. Events include streamed text chunks, typing
indicators, and a final `done` event. Rate limits apply per user and per
workspace.

### Confirm a proposed action

When the assistant proposes something that needs approval (e.g. creating a
schedule), it returns a confirmation token. Post it within 10 minutes:

```http
POST /v1/workspace/{workspaceId}/agent/confirm
Authorization: Bearer {token}
Content-Type: application/json

{ "token": "pending-action-token" }
```

## Connector AI queries

Admins enable read-only SQL per connector:

```http
PATCH /v1/workspaces/{workspaceId}/connections/{connectionId}
Authorization: Bearer {token}
Content-Type: application/json

{ "agent_query_enabled": true }
```

Or use the **AI query: On/Off** toggle in the workspace connectors admin UI.
Only warehouse connectors (Snowflake, BigQuery, Postgres, etc.) support ad-hoc
queries. The assistant cannot query REST or OAuth platform connectors this way.

## Related

- [Workspace connections](/teams/connections/) — define connectors the assistant can see
- [Workspace admin](/teams/admin/) — feature flags and schedules
- [AI chat agent](/guides/ai-agent/) — visitor-facing assistant inside an artifact (different product surface)
