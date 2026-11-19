# Workspace Assistant

The **workspace assistant** is the chat helper on workspace Home. Signed-in members ask
questions about pages, connectors, and team — and (when enabled) run **read-only** queries
against warehouse connectors, propose schedules, or (on Home) open artifacts in the canvas.

It shares one engine with the **Home agent** (`/v1/home/agent/*`) and the workspace route
(`/v1/workspace/{id}/agent/*`). Same SSE protocol, named **threads**, confirmation cards,
and streaming artifact builds — scoped per workspace (or personal Home).

This is **not** the in-artifact visitor chat agent — see [agents/overview.md](../agents/overview.md).

Load [SKILL.md](SKILL.md) first.

## Availability

Gated by the `ai.web_agent` feature flag (`GET …/features`, or read-only under Admin → General → Features). On **self-host /
OSS**, enable the flag if the dock is missing — do **not** send users to a billing upgrade
page.

When disabled, the Home agent dock is hidden and the API returns `404`. There is no plan
or credit purchase, but a workspace admin can set a **monthly AI budget** (Admin → Billing);
once it is reached, new AI calls are refused with code `workspace_budget` until the first of
next month (UTC). (The in-artifact agent also has a per-member daily token cap.) If no AI provider is
configured (no platform key, no workspace BYO key), the Home agent doesn't error — it
replies in the chat thread itself: instance admins get an actionable message naming the
env vars to set (`ANTHROPIC_API_KEY`, `VERCEL_AI_GATEWAY`, or `OPENAI_API_KEY` — e.g.
`npx wrangler secret put ANTHROPIC_API_KEY`); other members are told to ask their admin.
Never send anyone to buy credits — there is nothing to buy. A reached budget is raised or
removed by a workspace admin in Admin → Billing.

## What it can do

| Capability | Notes |
| --- | --- |
| Orientation | Lists pages, connectors, and member count from a workspace snapshot |
| Proactive daily brief | Once per day, Home fetches `GET /v1/home/agent/brief` and docks a warm AI catch-up in the chat thread |
| Weekly workspace digest (email) | Monday retention email — new/updated pages (auto TL;DR), stale Sheets flags, activity highlights (product email; no API) |
| Read-only connector queries | Ad-hoc `SELECT` against connectors with **AI query** enabled (off by default) |
| Propose schedules | Suggests a cron job (e.g. email a page weekly) — requires explicit confirmation |
| Named threads | Multiple conversations per user — auto-titled from the first message, rename/delete via API |
| Per-client notes | Auto-reads each Client's private markdown notes into the workspace snapshot (byte-budgeted); admins can ask the assistant to update them via the `set_client_notes` tool |
| Workspace search | **`search_workspace`** tool — ranked fuzzy search over pages, folders, datasets, connectors, people, schedules, crew, and alerts (same engine as **⌘K** and `GET /v1/search`) |
| **Present a deck** | **`present_artifact`** — turn a published dashboard/report into a new private slides artifact (AI outline + reveal.js publish) |
| **Watch a metric** | **`watch_metric`** — one-click table watch; bell alert when a value moves ≥ threshold (hourly sweep) |
| **File library** | **`list_files`** / **`read_file`** — browse uploads, chat attachments, emailed-in files, and phone shares; see provenance and prior artifacts built from the same file |
| **Knowledge** | **`knowledge_search`** / **`knowledge_get`** / **`knowledge_entity`** / **`knowledge_facts`** / **`knowledge_status`** — when Knowledge is enabled: cited passages from uploaded Files and pages, distilled notes, entities and quoted facts (same as the MCP connector) |
| **Build from a file** | Pass `source_file_id` on confirmed **build artifact** after `read_file` — spreadsheets, decks, and CSVs become live pages |
| Canvas actions (Home only) | Home agent adds tools to search and open artifacts in the workspace canvas |
| Streaming builds | Confirming a **build artifact** action streams progress steps, then returns the new page URL. The page is published **private**, in the workspace the chat is scoped to (personal on personal Home) |

Destructive or write actions always go through a **confirmation** step. The assistant cannot mutate data stores, publish artifacts without confirmation, or run non-`SELECT` SQL.

> **Connector queries are opt-in per connector.** Admins tick **AI** ("Let workspace AI query this") on the connector in Home → **Data**. Use read-only credentials — the SQL guard allows only a single `SELECT` statement.

## UI

On workspace Home, **Ask your workspace…** sits in a bottom **chat composer** with two states: a **resting pill** (workspace fully visible) and an open **sheet** (bottom panel over a dim scrim). The sheet shows the thread list and composer; drag the top grip to resize, double-click the grip to toggle full height, minimize or Escape to return to the pill. Streaming replies arrive over Server-Sent Events (SSE). Inline **confirmation cards** and rich widgets render in the thread.

### Voice input

When the browser supports recording, a **microphone** button appears in the composer. Tap once to start recording, tap again to stop. Audio is transcribed server-side (Whisper via Workers AI — same engine as the [Telegram bot](../agents/telegram.md#voice-messages)) and dropped into the text box for you to review before sending. Clips up to about 10 minutes are accepted; the browser must grant microphone permission.

### File attachments

A **paperclip** in the composer uploads a file into your asset library and attaches it to the next message. The assistant sees a `[Attached file: … — file id …]` reference and can call **`read_file`** to parse spreadsheets (sheet schemas + sample rows), presentations (slide text), or plain text before proposing a **build artifact**.

If you **Share → ShareOut** from another app on a phone with the ShareOut PWA installed, Home opens with the file already attached in the composer — ready to ask *"turn this into a dashboard."*

Files emailed to the workspace inbox (`{slug}@inbox.example.com`) also appear in **`list_files`** with an *emailed in* origin label. When a filename previously built an artifact, the assistant is prompted to **update** that page instead of creating a duplicate.

## REST API

All routes require a signed-in session or bearer token and workspace membership. The `ai.web_agent` flag must be enabled. If no AI provider is configured, the route still responds normally (no error) — the reply text itself explains the gap, differently for admins vs. members (see Availability above). No billing gate.

**Home agent** (personal or workspace Home — includes canvas tools):

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/v1/home/agent/brief?workspace=` | Proactive daily catch-up (`workspace` slug/id optional for team Home) |
| `POST` | `/v1/home/agent/chat` | Send a message; SSE stream. Body: `{ "text": "…", "threadId?": "…" }` |
| `POST` | `/v1/home/agent/transcribe?seconds=` | Transcribe a voice clip from the mic (raw audio body, `Content-Type` = blob MIME). Returns `{ "text": "…" }`. |
| `POST` | `/v1/home/agent/confirm` | Approve a pending action `{ "token": "…" }` — JSON or SSE for builds |
| `GET` | `/v1/home/agent/threads` | List named threads |
| `GET` | `/v1/home/agent/threads/{id}?before=` | Paginated messages in a thread |
| `POST` | `/v1/home/agent/threads/{id}/rename` | `{ "title": "…" }` |
| `DELETE` | `/v1/home/agent/threads/{id}` | Delete a thread |
| `GET` | `/v1/home/agent/media/{token}` | Fetch media the assistant attached |

**Workspace-scoped route** (same behavior, no canvas tools):

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/v1/workspace/{workspaceId}/agent/chat` | SSE chat — body `{ "text", "threadId?" }` |
| `POST` | `/v1/workspace/{workspaceId}/agent/confirm` | Confirm pending action |
| `GET` | `/v1/workspace/{workspaceId}/agent/threads` | List threads |
| `GET` | `/v1/workspace/{workspaceId}/agent/threads/{id}` | Thread messages |
| `POST` | `/v1/workspace/{workspaceId}/agent/threads/{id}/rename` | Rename thread |
| `DELETE` | `/v1/workspace/{workspaceId}/agent/threads/{id}` | Delete thread |
| `GET` | `/v1/workspace/{workspaceId}/agent/media/{token}` | Fetch attached media |

Prefer `/v1/home/agent/*` when driving the Home dock; both paths share thread storage per workspace.

### Chat (SSE)

```http
POST /v1/home/agent/chat
Authorization: Bearer {token}
Content-Type: application/json

{ "text": "Which connectors do we have?" }
```

The response is `text/event-stream`. Notable events:

| Event | Meaning |
| --- | --- |
| `thread` | New thread created `{ id, title }` — omitted when continuing an existing `threadId` |
| `text` | Streamed assistant reply chunk |
| `confirm` | Action needs approval — includes `token` and rich `card` |
| `build_step` | Progress label during confirmed artifact build |
| `build_done` | Build finished — `url`, `slug`, `artifactId` |
| `done` | Turn complete |
| `error` | User-safe error message |

Omit `threadId` to start a new thread (auto-titled from the first message). Rate limits apply per user and per workspace.

### Confirm a proposed action

When the assistant proposes something that needs approval (e.g. creating a schedule or building a page), it returns a confirmation token. Post it within 10 minutes:

```http
POST /v1/home/agent/confirm
Authorization: Bearer {token}
Content-Type: application/json

{ "token": "pending-action-token" }
```

Build actions stream SSE progress; other actions return `{ "ok": true, "text": "…" }`.

## Per-client notes (external sharing)

When the workspace uses **Clients** (external sharing), each Client can hold workspace-private markdown notes — account intel, preferences, history. These notes are **never shared with the client**.

| Behavior | Detail |
| --- | --- |
| Auto-read | On each chat turn, the assistant snapshot includes each Client's notes (within a byte budget) so replies stay context-aware |
| Write-back | Workspace **admins** can ask the assistant to save what it learns; it calls the `set_client_notes` account tool (`client`, `content`, optional `note` filename) |
| REST | `GET/PUT/DELETE /v1/workspaces/{id}/sharees/{sid}/context[/{name}]` — member read, admin write |

Manage in **Admin → Sharing → [client] → Notes about this client**. See [external-sharing.md](external-sharing.md#client-notes-ai-memory-about-a-client).

## Setup checklist (onboarding)

When a user joined a workspace in the last **14 days** (counted from accepting the invite) — or the account is that new, on **Personal home** — the chat prepares a localized **setup checklist**, with no model call. It does not pop open: the **Ask your workspace…** pill shows an unread dot. Until the user has a first artifact, the greeting offers starter chips instead; after that a **Get set up** card shows a progress ring and **only the next undone step**, with one button that does it. External sharees get no checklist.

| Track | Steps, in order (`src/onboarding/tasks.ts`) |
| --- | --- |
| **Admin** (`owner`/`admin`) | `first_artifact` · `data_source` · `invite_team` (skippable) · `alert` |
| **Member** | `first_artifact` (opens the **New** menu) · `connect_agent` (skippable) · `explore` · `comment` |
| **Personal** (solo home) | `first_artifact` · `try_assistant` · `share_page` |

- Each step's button runs its action: `ask` seeds a guided chat, `nav` opens a lens, `page` opens a connect page in a new tab, `skill` opens the skill library, `invite` opens **Invite people**, `new` opens the **New** menu.
- Skippable steps have **Skip** and don't count toward the percentage, so 100% stays reachable.
- Ask *"how do I get started?"* anytime — the assistant calls **`show_onboarding`** to render the same checklist in the dock.
- Steps cross themselves off from live signals: returning to the tab after connecting an agent or a data source updates the card.
- At **100%**, a one-shot celebration fires once (`POST /v1/home/onboarding/celebrate`); established workspaces are backfilled so it never retro-triggers.
- Dismiss with the checklist control (`POST /v1/home/onboarding/dismiss`). Status: `GET /v1/home/onboarding?workspace=`.

## Connector AI queries

Admins enable read-only SQL per connector:

```http
PATCH /v1/workspaces/{workspaceId}/connections/{connectionId}
Authorization: Bearer {token}
Content-Type: application/json

{ "agent_query_enabled": true }
```

Or tick **AI** ("Let workspace AI query this") on the connector in Home → **Data**. Only warehouse connectors (Snowflake, BigQuery, Postgres, etc.) support ad-hoc queries.

## Related

- [admin-portal.md](admin-portal.md) — Admin → AI & models (model, BYO key) and Billing (budget)
- [external-sharing.md](external-sharing.md) — per-client notes for external sharing Clients
- [workspace-connections.md](workspace-connections.md) — define connectors the assistant can see
- [api.md](api.md) — endpoint table
- [../api/features.md](../api/features.md) — `ai.web_agent` flag
- [../agents/overview.md](../agents/overview.md) — visitor-facing in-artifact AI chat (different surface)
- [../core/workspace-home.md](../core/workspace-home.md) — bottom chat composer on Home
