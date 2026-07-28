---
title: Your workspace (Home)
description: The redesigned ShareOut Home — lenses, tabbed pages, the Inspector, quick Edit mode, and the agent dock.
---

ShareOut **Home** is where you manage pages, see what needs attention, and open artifacts without leaving one surface. The redesigned workspace has three regions:

| Region | What it does |
| --- | --- |
| **Left rail** | Brand, **Create with AI**, lenses (Brief, All Artifacts, Assets, Schedules, Alerts, Analytics, Datasets, **Catalog**, **Knowledge**, Crew AI, Library, Connectors), **Admin** (owners/admins), Following, account menu |
| **Canvas** | Tab strip (Home + open pages); Brief widgets and artifact views; bottom **agent dock** |
| **Top bar** | **Notifications** bell (left of avatar), account menu, space switcher |
| **Right rail** | Context **Inspector** — Activity on Home; Details / Deliver / Comments / Automate / Editing on artifact tabs |

Rails and panes are resizable; widths are remembered in your browser.

## Brief — Needs You and Pulse

On **Home**, the canvas shows your **Brief** as draggable widgets and the right
rail shows **Activity**:

| Widget | What it shows |
| --- | --- |
| **Recently viewed** | Pages you opened lately |
| **Needs you** | Actionable rows (comments, shares, access requests, alerts, failed runs) |
| **Runs** | Recent schedule and crew executions |
| **Activity** | Live Pulse counts (publishes, views, creates, favorites, connections, skills…) |
| **For you** | Personalized recommendations |

Drag the grip on any widget to **reorder**; resize from the corner handle. Layout
is saved in your browser.

- **Needs You** — individual rows that need action: unresolved comments or replies (not yours), shares to you, access requests, metric alerts, failed tests, failed job or crew runs.
- **Pulse** — aggregated ambient counts inside the Activity widget. Pick **Today**, **7 days**, or **30 days**.

Workspace owners and admins can tune who sees each event kind under **Activity → settings** (see [Workspace admin → Activity visibility](/teams/admin/#activity-visibility)).

## Pro search (⌘K)

One ranked, typo-tolerant search engine powers every jump surface in Home:

| Surface | How to open |
| --- | --- |
| **Command palette** | **⌘K** / **Ctrl+K** anywhere in Home — searches pages, folders, datasets, connectors, people, schedules, crew, and alerts |
| **Inline quick-jump** | Type in the search box above artifact cards in **All Artifacts** — same results, opens as an in-studio tab |

Empty search shows **recents**. Results are grouped (Pages, Folders, Data, People, Schedules, Crew, Alerts, Actions) with thumbnails, owner avatars, view counts, and status pills. **↑↓** navigate, **Enter** opens, **Esc** closes.

**Answer mode:** end your query with **`?`** to ask a one-shot question over your workspace pages — e.g. `revenue last quarter?`. The palette shows an **Ask** row; **Enter** calls `POST /v1/ask` and renders the answer inline with **Sources** links to the cited pages. This is read-only (no tools, no publish) — distinct from the bottom **Ask your workspace…** dock, which runs the full [workspace assistant](/teams/workspace-assistant/).

The same search engine backs `GET /v1/search` and the workspace assistant's **`search_workspace`** tool — see [Teams API → Search](/teams/api/#search).

## Notifications

A **bell** in the top bar (left of your avatar) opens a right-docked panel — same glass-sheet language as account and help panels. A red badge counts items that need you.

**Unread** and **Seen** tabs split the feed: **Unread** holds approvals and activity still waiting on you; **Seen** lists notifications you opened or dismissed within the current window (muted, read-only).

| Card type | What it shows |
| --- | --- |
| **Approval** | Publish-approval requests — **Approve** / **Reject** when you are a pending voter; otherwise an awaiting-review status |
| **Activity** | Comments, replies, shares, access requests, **action items** assigned to you, files emailed to the workspace inbox, failed runs, **metric alerts**, **metric watches**, **stale data** (Sheets not synced in 7+ days), and **unused pages** (monthly janitor) from **Needs you** — dismiss individually or **Mark all read** |

Opening an activity card navigates to the target and marks it **seen** (leaving the unread count). Dismiss or **Mark all read** also moves items to **Seen**.

Badge count = pending approvals you can decide + undismissed activity items. The panel is primed on page load from the activity feed and publish-approval queue.

### Weekly workspace digest

Every **Monday at 13:00 UTC**, each active workspace emails its **internal members**
a **product** email summarizing the last seven days: published/updated pages (with
auto-generated descriptions), top viewed pages, open comments raised that week, and
any **stale-data** flags. Dead weeks are skipped. Opt out under account email
preferences (**product** category). Distinct from the personal marketing weekly digest.

## Workspace lenses

Beyond Brief, the left rail opens full-page lenses inside Home — no separate admin
app required:

| Lens | Who | What you do there |
| --- | --- | --- |
| **Datasets** | Workspace members | Browse and create workspace datasets |
| **Catalog** | Everyone | Browse the optional [data catalog](/teams/catalog/) — sources, lineage, glossary |
| **Knowledge** | Members (admins enable) | Browse the optional [workspace knowledge](/teams/knowledge/) — notes learned from your pages |
| **Crew AI** | Owners/admins | Manage crew automations |
| **Library** | Everyone | **Recommended by ShareOut** official skills, browse workspace skills, and **+ New module** for JS libraries |
| **Assets** | Everyone | Upload reusable files, version deliverables, bundle and send client download links — see [Files & deliverables](/everyone/assets/) |
| **Connectors** | Workspace members | List, create, and OAuth-install data connectors |
| **Admin** | Owners/admins | Control panel — Overview, Artifacts, Members, **Sharing**, Automation, AI, Security, Support, Settings |

Each lens has native create flows — you stay in Home instead of handing off to chat.
Admin also links to Connectors, Schedules, Alerts, and Crew for cross-cutting tasks.

See [Workspace admin](/teams/admin/) for the full Admin lens reference.

## Deep links & mobile

Home URLs are bookmarkable:

| Hash | Opens |
| --- | --- |
| `#l/brief` | Brief lens (default Home) |
| `#l/artifacts` | All Artifacts |
| `#l/assets` | Assets (files & deliverables) |
| `#l/catalog` | Data Catalog list |
| `#l/catalog/{entryId}` | A specific catalog entry |
| `#l/admin` | Admin lens |
| `#a/{slug}` | Artifact tab for that page |

Browser back/forward navigates between lenses and tabs. On phones the left rail
becomes a **hamburger drawer** instead of a fixed sidebar.

In **All Artifacts**, folders appear above your page cards — click a folder to
drill in (Drive-style) with a **breadcrumb** to climb back. Create, rename, or
delete folders from the header (team folders require `owner`/`admin`; personal
folders are yours). Deleting a folder orphans its pages back to All Artifacts —
it never deletes the pages themselves. Recent, Favorites, Shared, and Mine
filters still show everything; folders are navigation, not a filter that hides pages.

Use the filter row to show **Recently deleted** pages (soft-deleted artifacts you
can restore).

## Open pages in tabs

Click a page card to open it in a **tab** beside Home — like an IDE. Many pages can stay open; a **dirty dot** on a tab means unsaved edits in quick Edit mode.

- **Drag to reorder** — grab any open page tab (Home stays pinned) and drag it left or right.
- **Open in new tab** — the ↗ icon on a card opens the live page in a separate browser tab.
- **Device preview** — on an open HTML page tab, toggle the phone icon to frame the canvas as a mobile viewport.
- **Full screen** — the expand icon beside the device toggle requests native fullscreen on the live preview iframe; press **Esc** to exit.

## Quick Edit vs full editor

Each HTML page tab has a **View / Edit** toggle:

| Mode | Best for |
| --- | --- |
| **View** | Preview the live page inside Home |
| **Edit** | Quick copy and layout tweaks without opening Live Studio |

In **Edit** you can:

- Click text to rewrite it inline; change color, size, links, images (URL or upload)
- Insert, reorder, duplicate, or delete blocks (text, heading, image, button, divider)
- Use **AI on selection** (rewrite, shorten, grammar, translate, or a custom prompt)
- **Undo / redo**, autosave drafts, and **Publish** when ready
- Open **full editor ↗** (`/a/{slug}/edit`) for bindings, data model, collab, and advanced Inspect tools

Edit mode is for owners, named editor collaborators, and workspace **owners/admins**. Plain workspace members need an explicit **Can edit** invite.

Keyboard shortcuts in Edit: **⌘/Ctrl+S** publish, **⌘/Ctrl+Z** undo, **Esc** deselect.

## Inspector (right rail)

On an artifact tab the Inspector is a stack of collapsible sections (drag to
reorder — your layout is remembered per browser):

| Section | Purpose |
| --- | --- |
| **Details** | Star, title, visibility (segmented control), folder tree, compact meta pills, **Shared with** card (inline invite + per-viewer breakdown), tags, tests |
| **Deliver** | One-shot send to **email**, **Slack**, or **Telegram** — runs immediately, no agent turn. Pick a Slack channel from a searchable picker (no pasting channel IDs). **Schedule** opens Automate to create a recurring job. If Telegram or Slack is not connected yet, **Connect** walks you through linking; **Check again** refreshes status after OAuth. |
| **Watches** | One-click **metric watches** on this page's tables — row count, column sum, or last value. Alerts in the bell when the value moves ±20% from its baseline (hourly check). See [Metric alerts → Watches](/guides/metric-alerts/#metric-watches). |
| **Comments** | Full thread, replies, @mentions, composer |
| **Automate** | Schedules and crew triggers for this page |
| **Editing** | Property panel when Edit mode is on (formatting, blocks, AI) |

On **Home**, the Inspector shows **Activity** (Needs You + Pulse) instead.

Deliver uses the same destination layer as [scheduled jobs](/guides/jobs/) —
`POST /v1/artifacts/{id}/deliver` with `action` `email`, `slack`, or `telegram`.
See [Teams API → Artifact delivery](/teams/api/#artifact-delivery-one-shot).

## Agent chat (bottom panel)

At the bottom of the canvas, **Ask your workspace…** is a resting pill that opens
a **resizable bottom chat panel** over the workspace (dims the canvas behind it).
Drag the top grip to grow or shrink the panel; double-click the grip toggles
full-height. Your chosen height is remembered per browser. **Esc**, the scrim, or
the minimize control collapse back to the pill — there is no separate right-sidebar
chat dock.

The assistant can orient you, **create brand-new pages** from a description, run
read-only connector queries when enabled, and propose schedules — same guardrails
as the [workspace assistant](/teams/workspace-assistant/). Destructive actions
always need confirmation; publishing a new page requires an explicit approve step.

Tap the **microphone** in the composer to dictate a message — audio is transcribed
into the text box before you send (see [Workspace assistant → Voice input](/teams/workspace-assistant/#voice-input)).

Once per day, when the assistant is enabled, Home fetches a short **proactive brief**
(`GET /v1/home/agent/brief`) — a warm AI summary of what needs you and recent runs —
and docks it in the chat thread (without taking over the screen on mobile).

### Setup checklist (new members)

When you join a workspace in the last **14 days**, the dock auto-opens with a
localized **setup checklist** — no model call, just a warm greeting and a progress
ring. Tasks are live-derived from real state (publish, connect data, Telegram,
Slack, alert, skill for admins; explore, comment, Telegram, skill+publish for
internal members). External sharees get no checklist.

- Each item has an inline action button (connect, publish, open Connectors, etc.).
- **Slack** is skippable and excluded from the percentage so 100% stays reachable.
- Ask *"how do I get started?"* anytime and the agent can surface the same checklist
  via its `show_onboarding` tool.
- Returning to the tab after connecting Telegram (or finishing a connector OAuth)
  automatically crosses items off.
- At **100%**, a one-shot blue ring moment fires once (`POST /v1/home/onboarding/celebrate`);
  established workspaces are backfilled so it never retro-triggers.

Dismiss with the checklist's dismiss control (`POST /v1/home/onboarding/dismiss`).
Status: `GET /v1/home/onboarding?workspace=`.

## Account menu

Your avatar opens a menu to switch **Personal vs team spaces**, manage **linked
accounts** (see Google accounts on one login), connect Telegram (Settings can
deep-link straight to the bot), or sign out.

## Create with AI

**Create with AI** in the left rail starts an in-studio generation flow (`/v1/create/generate`) so new pages land in your workspace without leaving Home.

## Related

- [Change anything](/everyone/the-editor/) — plain-language editing overview
- [Visual editor (Live Studio)](/spec/editor/) — full `/edit` studio reference
- [Work together](/everyone/collaborators/) — invites and access
- [Workspace assistant](/teams/workspace-assistant/) — AI on workspace home
