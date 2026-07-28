# Workspace Home

ShareOut **Home** (`/home`) is the signed-in workspace surface: manage pages, see what needs attention, and open artifacts in tabs without leaving one shell. Load [../SKILL.md](../SKILL.md) first.

> **Teams workspaces** share the same Home chrome. Use the avatar switcher to move between **Personal** and each team workspace. See [../api/folders.md](../api/folders.md) and [../team/folders.md](../team/folders.md) for folder models.

## Layout

| Region | What it does |
| --- | --- |
| **Left rail** | Brand, **Create with AI**, lenses (Brief, All Artifacts, Assets, Schedules, Alerts, Analytics, Datasets, **Catalog**, Crew AI, Library, Connectors), **Admin** (owners/admins), Following, account menu |
| **Canvas** | Tab strip (Home + open pages); Brief widgets and artifact views; bottom **chat composer** (resting pill or growable sheet) |
| **Top bar** | **Notifications** bell (left of avatar), account menu, space switcher |
| **Right rail** | Context **Inspector** — Activity on Home; Details / Deliver / Comments / Automate / Editing on artifact tabs |

Rails and panes are resizable; widths persist in the browser.

## Brief — Needs You and Pulse

On **Home**, the canvas shows your **Brief** as draggable widgets and the right rail shows **Activity**:

| Widget | What it shows |
| --- | --- |
| **Recently viewed** | Pages you opened lately |
| **Needs you** | Actionable rows (comments, **@mentions of you**, action items assigned to you, shares, access requests, alerts, failed runs, files emailed to the workspace inbox, **stale Sheets data**, **metric watches**, **unused-page cleanup**) |
| **Runs** | Recent schedule and crew executions |
| **Activity** | Live Pulse counts (publishes, views, creates, favorites, connections, skills…) |
| **For you** | Personalized recommendations |

Drag the grip on any widget to **reorder**; resize from the corner handle. Layout is saved in your browser.

- **Needs You** — individual rows that need action: unresolved comments or replies (not yours), **@mentions of you** (their own kind, defaulting to `self` audience so they survive a workspace turning the general comment stream down), **action items** assigned to you, shares to you, access requests, metric alerts, failed tests, failed job or crew runs, **files emailed to the workspace inbox**, **Google Sheets connections that stopped syncing**, **metric watches that moved sharply**, **monthly unused-page cleanup suggestions**
- **Pulse** — aggregated ambient counts inside the Activity widget. Pick **Today**, **7 days**, or **30 days**

Workspace owners and admins can tune who sees each event kind under **Activity → settings**. See [../team/activity-feed.md](../team/activity-feed.md).

## Pro search (⌘K)

One ranked, typo-tolerant search engine powers every jump surface in Home:

| Surface | How to open |
| --- | --- |
| **Command palette** | **⌘K** / **Ctrl+K** anywhere in Home — searches pages, folders, datasets, connectors, people, schedules, crew, and alerts; **question-shaped queries** open **Ask mode** (answer + citations via `POST /v1/ask`) |
| **Inline quick-jump** | Type in the search box above artifact cards in **All Artifacts** — same results, opens as an in-studio tab |

Empty search shows **recents**. Results are grouped (Pages, Folders, Data, People, Schedules, Crew, Alerts, Actions) with thumbnails, owner avatars, view counts, and status pills. **↑↓** navigate, **Enter** opens, **Esc** closes.

Type a **question** (e.g. *"Which dashboards track churn?"*) to switch the palette to **answer mode** — one AI turn over pages you can access, with cited sources you can open. See [../api/search.md](../api/search.md#ask-your-workspace-answer-mode).

The same engine backs `GET /v1/search` and the workspace assistant's **`search_workspace`** tool — see [../api/search.md](../api/search.md).

## Notifications

A **bell** in the top bar (left of your avatar) opens a right-docked panel — same glass-sheet language as account and help panels. A red badge counts items that need you.

**Unread** and **Seen** tabs split the feed: **Unread** holds approvals and activity still waiting on you; **Seen** lists notifications you opened or dismissed within the current window (muted, read-only).

| Card type | What it shows |
| --- | --- |
| **Approval** | Publish-approval requests — **Approve** / **Reject** when you are a pending voter; otherwise an awaiting-review status |
| **Activity** | Comments, action items, replies, shares, access requests, failed runs, metric alerts, **metric watches**, **stale data**, **unused-page cleanup**, and files emailed to the workspace inbox from **Needs you** — dismiss individually or **Mark all read** |

Opening an activity card navigates to the target and marks it **seen** (leaving the unread count). Dismiss or **Mark all read** also moves items to **Seen**.

Badge count = pending approvals you can decide + undismissed activity items. Dismiss via `POST /v1/home/dismiss-event` (`{ "eventId" }` or `{ "eventIds": [] }`). See [../team/api.md](../team/api.md#home-activity).

## Workspace lenses

Beyond Brief, the left rail opens full-page lenses inside Home — no separate admin app required:

| Lens | Who | What you do there |
| --- | --- | --- |
| **Assets** | Workspace members (personal scope on Personal home) | Upload files, folders, per-file visibility, versions, comments, **Share with a person**, bundle collections, gated `/d/<token>` download links — see [../team/assets.md](../team/assets.md) |
| **Knowledge** | Workspace members (paid plan to enable) | Opt-in learned library — tree/table browse, Guidance (house rules), nightly consolidator — see [../team/knowledge.md](../team/knowledge.md) |
| **Catalog** | Everyone | Browse the optional [data catalog](../team/catalog.md) — sources, events, lineage, glossary |
| **Datasets** | Workspace members | Browse and create workspace datasets |
| **Crew AI** | Owners/admins | Manage crew automations |
| **Library** | Everyone | Browse and **+ New module** for workspace/personal JS libraries |
| **Connectors** | Workspace members | List, create, and OAuth-install data connectors |
| **Admin** | Owners/admins | Admin portal — Overview, Artifacts, Members, **Sharing**, Automation, AI, Security, Support, Settings (Guidance/house-style files moved to **Knowledge** lens) |

Each lens has native create flows — you stay in Home instead of handing off to chat. See [../team/admin-portal.md](../team/admin-portal.md) for tab details and [../team/SKILL.md](../team/SKILL.md#workspace-admin-surfaces) for governance APIs.

## All Artifacts — folder drill-in

The **All Artifacts** lens lists pages with filter chips (Recent, Favorites, Shared with me, Mine). A **Folders** row at the top shows Team Space or personal folders; click a folder to drill in (Drive-style breadcrumb **All › {folder}**). Create, rename, or delete folders from the same view (owners/admins for Team Space; owners for personal). Deleting a folder unfiles its pages — it does not delete artifacts.

## Open pages in tabs

Click a page card to open it in a **tab** beside Home — like an IDE. Many pages can stay open; a **dirty dot** on a tab means unsaved edits in quick Edit mode.

- **Drag to reorder** — grab any open page tab (Home stays pinned) and drag it left or right.
- **Open in new tab** — the ↗ icon on a card opens the live page in a separate browser tab.
- **Device preview** — on an open HTML page tab, toggle the phone icon to frame the canvas as a mobile viewport.
- **Full screen** — the expand icon beside the device toggle requests native fullscreen on the live preview iframe; press **Esc** to exit.

## Quick Edit (Edit-Lite) vs Live Studio

Each HTML page tab has a **View / Edit** toggle:

| Mode | Best for |
| --- | --- |
| **View** | Preview the live page inside Home |
| **Edit** | Quick copy and layout tweaks without opening Live Studio |

In **Edit** you can:

- Click text to rewrite inline; change color, size, links, images (URL or upload)
- Insert, reorder, duplicate, or delete blocks (text, heading, image, button, divider)
- Use **AI on selection** (rewrite, shorten, grammar, translate, or a custom prompt)
- **Undo / redo**, autosave drafts, and **Publish** when ready
- Open **full editor ↗** (`/a/{slug}/edit`) for bindings, data model, collab, and full Inspect tools

Edit mode is for owners, named **editor** collaborators, and workspace **owners/admins**. Plain workspace members need an explicit **Can edit** invite. See [editor.md](editor.md#access--feature-gating).

Keyboard shortcuts in Edit: **⌘/Ctrl+S** publish, **⌘/Ctrl+Z** undo, **Esc** deselect.

Edit-Lite is single-player; Live Studio adds Yjs multi-editor collab. Same draft/publish API and the full Edit-Lite vs Live Studio comparison: [editor.md](editor.md).

## Inspector (right rail)

On an artifact tab the Inspector is a stack of collapsible sections (drag to reorder — your layout is remembered per browser):

| Section | Purpose |
| --- | --- |
| **Details** | Star, title, visibility (segmented control), folder tree, compact meta pills, **Shared with** card (inline invite + per-viewer breakdown), tags (auto-filled on publish when empty — see [../modules/_shared/publishing.md](../modules/_shared/publishing.md#auto-tldr-and-tags-search-index)), tests, **Present this** (AI deck — see below) |
| **Deliver** | One-shot send to **email**, **Slack**, or **Telegram** — runs immediately, no agent turn. Pick a Slack channel from a searchable picker (no pasting channel IDs). **Schedule** opens Automate to create a recurring job. If Telegram or Slack is not connected yet, **Connect** walks you through linking; **Check again** refreshes status after OAuth. |
| **Watches** | One-click **metric watches** on table metrics — list, create, delete; bell alerts when a value moves ≥ threshold — see [../api/metric-watch.md](../api/metric-watch.md) |
| **Comments** | Full thread, replies, @mentions, composer |
| **Automate** | Schedules and crew triggers for this page |
| **Editing** | Property panel when Edit mode is on (formatting, blocks, AI) |

On **Home**, the Inspector shows **Activity** (Needs You + Pulse) instead.

Deliver uses the same destination layer as [../api/jobs.md](../api/jobs.md) — `POST /v1/artifacts/{id}/deliver` with `action` `email`, `slack`, or `telegram`. See [../team/api.md](../team/api.md#artifact-delivery-one-shot).

### Present this (AI deck)

From **Details**, **Present this** turns the open published page into a **new private slides deck** in the same workspace — AI reads the production HTML, outlines 5–9 slides, renders a reveal.js deck, and publishes it through the normal path (slug, versions, auto-summary). Rate limit: **10 decks per user per UTC hour**. API:

```http
POST /v1/artifacts/{id}/present
Authorization: Bearer {token}
```

Returns `{ "artifact_id", "url" }` with `201`. The workspace assistant also exposes **`present_artifact`** for the same flow.

## Deep-link routing

Home reflects the active lens or open artifact tab in the URL hash so views are linkable and browser back/forward works:

| Hash | Opens |
| --- | --- |
| `#l/brief` | Brief (default Home) |
| `#l/artifacts` | All Artifacts lens |
| `#l/assets` | Assets lens |
| `#l/knowledge` | Knowledge lens |
| `#l/knowledge/{path}` | A specific Knowledge note |
| `#l/catalog` | Data Catalog list |
| `#l/catalog/{entryId}` | A specific catalog entry |
| `#l/admin` | Admin lens |
| `#l/{lens}` | Any left-rail lens (`datasets`, `crew`, `library`, `connectors`, …) |
| `#a/{slug}` | Artifact tab by slug |

Share a link with a teammate to land on the same lens or open page.

## Workspace chat (bottom composer)

At the bottom of the canvas, **Ask your workspace…** is a two-state composer:

| State | What you see |
| --- | --- |
| **Resting** | A pill along the bottom edge — workspace canvas stays fully visible. |
| **Sheet** | A bottom panel over a dim scrim with the full chat thread list and composer. |

Tap the pill (or focus the composer) to open the sheet. **Minimize**, click the scrim, or press **Escape** to return to resting. Drag the **top grip** to resize the sheet height (280px up to nearly full viewport); **double-click the grip** toggles full height ↔ default. Height persists per browser (`localStorage` key `wsx_sheet_h`). On first open the sheet defaults to a compact height — `min(480px, 52vh)` — so the workspace stays visible behind it.

The chat uses **named threads** — multiple conversations, inline confirmation cards, and (on Home) canvas tools to search and open artifacts. It can orient you, run read-only connector queries when enabled, propose schedules, and stream artifact builds after confirmation. Same guardrails as the [workspace assistant](../team/workspace-assistant.md).

Tap the **microphone** in the composer to dictate a message — audio is transcribed into the text box before you send (see [workspace assistant → Voice input](../team/workspace-assistant.md#voice-input)).

Once per day, when the assistant is enabled, Home fetches a short **proactive brief** (`GET /v1/home/agent/brief`) — a warm AI summary of what needs you and recent runs — and docks it in the chat thread. First-time welcome copy also appears there instead of on the Brief canvas.

### Setup checklist (new members)

When you join a workspace in the last **14 days**, the sheet auto-opens with a localized **setup checklist** — a warm greeting and progress ring, no model call. Tasks are live-derived from real state (publish, connect data, Telegram, Slack, alert, skill for admins; explore, comment, Telegram, skill+publish for members). On **Personal home**, a shorter personal track runs (publish, try assistant, share, skill). External sharees get no checklist.

- Each item has an inline action button (connect, publish, open Connectors, etc.).
- **Slack** is skippable and excluded from the percentage so 100% stays reachable.
- Ask *"how do I get started?"* anytime and the agent can surface the same checklist via its `show_onboarding` tool.
- Returning after connecting Telegram (or finishing connector OAuth) automatically crosses items off.
- At **100%**, a one-shot celebration fires once (`POST /v1/home/onboarding/celebrate`).
- Dismiss with the checklist control (`POST /v1/home/onboarding/dismiss`). Status: `GET /v1/home/onboarding?workspace=`.

See [../team/workspace-assistant.md](../team/workspace-assistant.md#setup-checklist-onboarding) for admin vs member tracks and API details.

## Localization

The Home studio shell (rails, lenses, Admin, chat composer, onboarding copy) ships in **English and Spanish** — strings follow the browser locale (`en` / `es`). Artifact content and agent replies are not auto-translated.

## Account menu

Your avatar in the **chrome bar** (top of the canvas on all screen sizes) opens a menu to switch **Personal vs team spaces**, manage **linked accounts** (see Google accounts on one login), connect Telegram (direct deep link from Settings → Telegram), open recently deleted pages (**Trash** in the All Artifacts lens), or sign out.

On narrow viewports the left rail collapses into a **mobile drawer**; lens and tab state still sync to the URL hash.

## Create with AI

**Create with AI** in the left rail starts an in-studio generation flow (`POST /v1/create/generate`) so new pages land in your workspace without leaving Home. Gated by `ai.create` — see [../api/features.md](../api/features.md).

## Related

- [editor.md](editor.md) — Live Studio at `/a/{slug}/edit`; Edit-Lite comparison
- [../team/assets.md](../team/assets.md) — asset library, deliverables, gated download links
- [../team/activity-feed.md](../team/activity-feed.md) — Needs You + Pulse API and visibility settings
- [../team/workspace-assistant.md](../team/workspace-assistant.md) — workspace AI on Home
- [../modules/_shared/permissions.md](../modules/_shared/permissions.md) — who can edit vs view
- [../api/folders.md](../api/folders.md) — personal vs team folders on Home
