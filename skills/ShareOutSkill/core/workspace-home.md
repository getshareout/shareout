# Workspace Home

ShareOut **Home** (`/home`) is the signed-in workspace surface: manage pages, see what needs attention, and open artifacts in tabs without leaving one shell. Load [../SKILL.md](../SKILL.md) first.

> **Teams workspaces** share the same Home chrome. Use the avatar switcher to move between **Personal** and each team workspace. See [../api/folders.md](../api/folders.md) and [../team/folders.md](../team/folders.md) for folder models.

## Layout

| Region | What it does |
| --- | --- |
| **Left rail** | Brand, **New**, **Search** (⌘K), then **Home** · **Artifacts** · **AI skills** · **Automations** · **AI tasks** (owners/admins) · **Data** · **Knowledge** · **Catalog** · **Admin** (owners/admins); **Help & support** and **Documentation** at the bottom. Spanish UI: Nuevo, Buscar, Inicio · Artefactos · Skills de IA · Automatizaciones · Tareas con IA · Datos · Conocimiento · Catálogo · Admin |
| **Canvas** | Home, the active lens, or an open artifact; bottom **chat composer** (resting pill or growable sheet) |
| **Top bar** | Open-artifact tab row, **Notifications** bell, account menu (space switcher inside) |
| **Right rail** | **Inspector** for the open artifact — **Details** / **Comments** / **Automate** tabs (**Editing** in Edit mode). Hidden on Home |

On **Personal** home the rail shows only Home, Artifacts, AI skills and Automations; AI tasks, Data, Knowledge, Catalog and Admin need a team workspace (template.ts `buildNav`). Analytics and Connect stay reachable from the account menu, ⌘K and `?view=` but are not rail items.

Rails and panes are resizable; widths persist in the browser.

## Home — Needs you, For you, Recent

**Home** is a fixed, calm layout (no right rail): a one-line narration ("Since you were away: …" / "All caught up…") and up to three lists, each hidden while empty:

| List | What it shows |
| --- | --- |
| **Needs you** | Actionable rows, dismissable with ×. Shown only when non-empty |
| **For you** | Personalized recommendations (`/v1/home/for-you`) |
| **Recent** | Pages you opened merged with Pulse activity (publishes, comments, runs…), newest first, top 10 |

When all three are empty Home shows **Create your first page**. Spanish UI: **Te necesita** / **Para vos** / **Reciente**.

- **Needs You** — individual rows that need action: unresolved comments or replies (not yours), **@mentions of you** (their own kind, defaulting to `self` audience so they survive a workspace turning the general comment stream down), **action items** assigned to you, shares to you, access requests, metric alerts, failed tests, failed job or crew runs, **files emailed to the workspace inbox**, **Google Sheets connections that stopped syncing**, **metric watches that moved sharply**, **monthly unused-page cleanup suggestions**, and **AI page builds that ended while nobody was watching** (`page_build`)
- **Pulse** — aggregated ambient activity; it now feeds the **Recent** list instead of its own widget

The **More** menu (⋯, top right of Home) holds **Customize** (drag to reorder, resize from the corner, **Done**; layout saved per workspace in the browser), the activity window **Today** / **7d** / **30d** (how far back Pulse — and so **Recent** — looks), and, for owners and admins, **Activity visibility** — who sees each event kind. See [../team/activity-feed.md](../team/activity-feed.md).

## Pro search (⌘K)

One ranked, typo-tolerant search engine powers every jump surface in Home:

| Surface | How to open |
| --- | --- |
| **Command palette** | **⌘K** / **Ctrl+K** anywhere in Home, or **Search** in the rail — searches pages, folders, datasets, connectors, people, schedules, AI tasks, alerts and AI skills; the last row is always **Ask AI: “…”** (answer + citations via `POST /v1/ask`) |
| **Quick search in Artifacts** | The **Quick search…** box above the **Artifacts** list filters that list client-side (`data-qs-local`) — no jump dropdown |

An empty palette shows your **recent searches** (the last 8; × removes one, **Clear** empties the list; they follow you across devices) and **recently opened** pages. A search is remembered when you open a result or press **Enter**, not as you type.

Results come in two sections. **Pages, folders, people and actions** rank in the browser from a local index on every keystroke, so they appear as you type with no wait. **Page text** (*In page text*), **Knowledge passages** (*In Knowledge*), data, schedules, AI tasks, alerts and AI skills come from the server a moment later, below. Matching ignores case and accents (`clasificacion` finds *Clasificación*). **↑↓** navigate, **Enter** opens the highlighted row (the first one by default), **Esc** closes. Endpoints: [../api/search.md](../api/search.md#palette-endpoints-search-index-deep-search-recent-searches).

Pick the **Ask AI: “…”** row (always last, an explicit opt-in — typing a question mark does not switch modes) for **answer mode** — one AI turn over pages you can access, with cited sources you can open. See [../api/search.md](../api/search.md#ask-your-workspace-answer-mode).

The same engine backs `GET /v1/search` and the workspace assistant's **`search_workspace`** tool — see [../api/search.md](../api/search.md).

## Notifications

A **bell** in the top bar (left of your avatar) opens a right-docked panel — same glass-sheet language as account and help panels. A red badge counts items that need you.

**Unread** and **Seen** tabs split the feed: **Unread** groups **Needs your approval**, **Action items** and **Recent** (the Needs-you activity); **Seen** lists notifications you opened or dismissed within the current window (muted, read-only).

| Card type | What it shows |
| --- | --- |
| **Approval** | Publish-approval requests — **Approve** / **Reject** when you are a pending voter; otherwise an awaiting-review status |
| **Action item** | Action items assigned to you with a due chip — **Done** / **Reopen** |
| **Activity** | Comments, replies, shares, access requests, failed runs, metric alerts, **metric watches**, **stale data**, **unused-page cleanup**, files emailed to the workspace inbox, and unwatched **page builds** from **Needs you** — × dismisses one |

**Opening the bell marks every activity item in it as read**: the client posts all their ids to `POST /v1/home/dismiss-event` (`markViewed` in client-script/notifications.ts), the badge drops them at once, and they show under **Seen** next time — and leave Home's **Needs you** too. The **Mark all read** button is therefore hidden in practice. Approvals stay until decided; action items until marked **Done**.

Badge count = pending approvals you can decide + unread activity items + open action items. Dismiss via `POST /v1/home/dismiss-event` (`{ "eventId" }` or `{ "eventIds": [] }`). See [../team/api.md](../team/api.md#home-activity).

## Workspace lenses

Beyond Home, the left rail opens full-page lenses inside Home — no separate admin app required:

| Lens | Who | What you do there |
| --- | --- | --- |
| **Artifacts** (`artifacts`) | Everyone | Pages and uploaded files, folder drill-in — see below |
| **AI skills** (`library`) | Everyone | **Skills** and **Modules** chips; **New module** for workspace/personal JS libraries |
| **Automations** (`schedules`) | Everyone | Schedules; the **Alerts** chip opens the `alerts` lens |
| **AI tasks** (`crew`) | Owners/admins, team workspace | Manage crew automations |
| **Data** (`connectors`) | Workspace members | **Data sources** (list, create, OAuth-install connectors); the **Tables** chip opens `datasets` |
| **Knowledge** | Workspace members (owner/admin to enable) | Opt-in learned library — tree/table browse, Guidance (house rules), nightly consolidator — see [../team/knowledge.md](../team/knowledge.md) |
| **Catalog** | Workspace members | Browse the optional [data catalog](../team/catalog.md) — sources, events, lineage, glossary |
| **Admin** | Owners/admins | Admin portal — sidebar of one page per topic (People, Content, AI & billing, Security, Workspace; Reports for some admins). Guidance/house-style files live in the **Knowledge** lens |

**Assets is retired** (no rail item, ⌘K entry, `#l/assets` or `?view=assets` — they fall back to Home). Everything uploaded in Home (**New → Upload files**, drag/drop, paste) becomes an artifact (documents, images, video; `import-rules.ts`), and types with no viewer are refused. Existing `dlv_` files, `/v1/files` links and the `/v1/workspaces/{id}/assets` API keep working — see [../team/assets.md](../team/assets.md).

Each lens has native create flows — you stay in Home instead of handing off to chat. See [../team/admin-portal.md](../team/admin-portal.md) for tab details and [../team/SKILL.md](../team/SKILL.md#workspace-admin-surfaces) for governance APIs.

## All Artifacts — folder drill-in

The **Artifacts** lens lists pages with filter chips (Recent, Favorites, Shared with me, Mine). A **Folders** row at the top shows Team Space or personal folders; click a folder to drill in (Drive-style breadcrumb **All › {folder}**). Create, rename, or delete folders from the same view (Team Space: owners/admins for any folder, members for the ones they created unless an admin turned that off; owners for personal). Deleting a folder unfiles its pages — it does not delete artifacts.

## Open pages in tabs

Click a page card to open it in a **tab** beside Home — like an IDE. Many pages can stay open; a **dirty dot** on a tab means unsaved edits in quick Edit mode.

- **New tabs open first**, right after Home; tab names stay as opened.
- **Drag to reorder** — grab any open page tab (Home stays pinned) and drag it left or right.
- **All open tabs** — once tabs overflow the row, a list button names every open tab (with a **Find a tab** filter past 8).
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

- Hover outlines and click selects **any authored element** (`data-wsx-id`) — text, image, link or container block. The **Editing** rail shows an **Elements** tree (hover highlights, click selects and scrolls). There is no insert palette (removed in #205)
- Text: rewrite inline, bold/italic/underline/strike/link, color and size, **Convert to…** paragraph or heading. Blocks: background, padding, align. Every element: move up/down, **Duplicate**, **Delete**. Images: URL or upload; links: URL and new-tab
- **Ask AI** on the selection or, with nothing selected, the whole page (*What should change on this page?*). Presets by kind — text: **Rewrite**, **Shorten**, **Fix grammar**, **Translate**; block: **Tidy spacing**, **Make it a card**; image: **Write alt text**; plus a free prompt. The result opens as an **AI proposal** in place: **Before / After** toggle, **Keep change** (one undo step, saved to the draft), **Try again**, **Discard** (Esc). Everything else is locked until one is picked. Uses the full editor's `/editor/chat/normal` contract
- **Undo / redo**, autosave drafts, and **Publish** when ready
- Open **full editor ↗** (`/a/{slug}/edit`) for bindings, data model, collab, and full Inspect tools

Edit mode is for owners, named **editor** collaborators, and workspace **owners/admins**. Plain workspace members need an explicit **Can edit** invite. See [editor.md](editor.md#access--feature-gating).

Keyboard shortcuts in Edit: **⌘/Ctrl+S** **saves the draft now** (`saveNow` — publishing is only ever the **Publish** button), **⌘/Ctrl+Z** undo, **⌘/Ctrl+Shift+Z** / **⌘/Ctrl+Y** redo, **Esc** deselect.

Conflicts show in one bar above the edit surface:

- **409 `DRAFT_CONFLICT`** on save or publish (the draft changed in another tab, device or by the agent): *This draft changed somewhere else.* — **Keep mine** (re-save on the newer base) or **Load newer** (drop unsaved edits, reload). Autosave pauses until one is picked.
- **409 `STALE_BASE`** on publish (someone published after this edit started; the client sends `baseLiveAt`): *Changed since you started (vN · who · when).* — **See what changed** (diff), **Publish anyway** (resend without `baseLiveAt`), or ×. See [editor.md](editor.md).

Edit-Lite is single-player; Live Studio adds Yjs multi-editor collab. Same draft/publish API and the full Edit-Lite vs Live Studio comparison: [editor.md](editor.md).

## Inspector (right rail)

On an artifact tab the Inspector has **three tabs: Details / Comments / Automate** (Spanish: Detalles / Comentarios / Automatizar; client-script/inspector.ts `renderRTabs`). In Edit mode it shows a single **Editing** tab (properties, Elements tree, Ask AI). On phones and tablets (≤1100px) there is no right rail: the artifact bar's **Options** (Opciones) button opens the same panel as a bottom sheet.

| Tab | Purpose |
| --- | --- |
| **Details** | Title and description (inline edit), star, owner · version · dates line, status pills, live change note ("Updated …"). Actions **Open**, **Edit**, **Copy link**, **Download original** (converted PDFs), **Delete**. A one-line "who can see it" summary with **Share** (opens the share dialog), **Pages (N)** for multi-page artifacts, **Organize** (folder + tags, auto-filled on publish when empty — see [../modules/_shared/publishing.md](../modules/_shared/publishing.md#auto-tldr-and-tags-search-index)) for editors. A collapsible **More** holds **Approvals**, **Analytics** and **Tests** (editors), **Knowledge from this artifact**, and two sub-view rows: **Data** (HTML) and **Versions** (history, with a "← Details" back button) |
| **Comments** | Full thread, replies, @mentions, composer; Open / All, Resolve / Reopen, Assign, "on vN" |
| **Automate** | **Update the data** (Drive sync, sheet link, email sync — editors in a workspace), **Send now** (editors), this page's **Schedules** and **Alerts**, **Monitoring** (metric watches — editors; see [../api/metric-watch.md](../api/metric-watch.md)), **Quick actions** (Schedule a send, Set an alert, Set up an AI task) and "Something custom? Describe it in chat" |

**Send now** is a one-shot send to **email**, **Slack**, or **Telegram** — runs immediately, no agent turn. Pick a Slack channel from a list (no pasting channel IDs). **Schedule** creates a recurring job. If Telegram or Slack is not connected yet, **Connect** walks you through linking; **Check again** refreshes status after OAuth.

On **Home** the right rail is hidden; activity lives in the Home lists.

Send now uses the same destination layer as [../api/jobs.md](../api/jobs.md) — `POST /v1/artifacts/{id}/deliver` with `action` `email`, `slack`, or `telegram`. See [../team/api.md](../team/api.md#artifact-delivery-one-shot).

### Present this (AI deck)

**Present this** is no longer a Details button; it runs from the API or the assistant's `present_artifact` tool. It turns a published page into a **new private slides deck** in the same workspace — AI reads the production HTML, outlines 5–9 slides, renders a reveal.js deck, and publishes it through the normal path (slug, versions, auto-summary). Rate limit: **10 decks per user per UTC hour**. API:

```http
POST /v1/artifacts/{id}/present
Authorization: Bearer {token}
```

Returns `{ "artifact_id", "url" }` with `201`. The workspace assistant also exposes **`present_artifact`** for the same flow.

## Deep-link routing

Home reflects the active lens or open artifact tab in the URL hash so views are linkable and browser back/forward works:

| Hash | Opens |
| --- | --- |
| `#l/brief` | Home (default) |
| `#l/artifacts` | Artifacts lens |
| `#l/knowledge` | Knowledge lens |
| `#l/knowledge/{path}` | A specific Knowledge note |
| `#l/catalog` | Data Catalog list |
| `#l/catalog/{entryId}` | A specific catalog entry |
| `#l/admin` | Admin lens |
| `#l/{lens}` | Any left-rail lens (`datasets`, `crew`, `library`, `connectors`, …). A lens with no button (e.g. retired `assets`) falls back to Home |
| `#a/{slug}` | Artifact tab by slug |

Share a link with a teammate to land on the same lens or open page.

## Workspace chat (bottom composer)

At the bottom of the canvas, **Ask your workspace…** is a two-state composer:

| State | What you see |
| --- | --- |
| **Resting** | A pill along the bottom edge — workspace canvas stays fully visible. |
| **Sheet** | A bottom panel over a dim scrim with the full chat thread list and composer. |

Tap the pill (or focus the composer) to open the sheet. **Minimize**, click the scrim, or press **Escape** to return to resting. Drag the **top grip** to resize the sheet height (280px up to nearly full viewport); **double-click the grip** toggles full height ↔ default. Height persists per browser (`localStorage` key `wsx_sheet_h`). On first open the sheet defaults to a compact height — `min(480px, 52vh)` — so the workspace stays visible behind it.

The chat uses **named threads** — multiple conversations, inline confirmation cards, and (on Home) canvas tools to search and open artifacts. It can orient you, run read-only connector queries when enabled, propose schedules, and stream artifact builds after confirmation (a page built from the chat is published **private**, in the workspace you are chatting in — share it afterwards). Same guardrails as the [workspace assistant](../team/workspace-assistant.md).

Tap the **microphone** in the composer to dictate a message — audio is transcribed into the text box before you send (see [workspace assistant → Voice input](../team/workspace-assistant.md#voice-input)).

Once per day, when the assistant is enabled, Home fetches a short **proactive brief** (`GET /v1/home/agent/brief`) — a warm AI summary of what needs you and recent runs — and docks it in the chat thread. First-time welcome copy also appears there instead of on the Home canvas.

### Setup checklist (new members)

When you joined a workspace in the last **14 days** (from invite acceptance; on **Personal home**, from account creation), the chat renders a localized **setup checklist** in the background — no model call, and the sheet does **not** auto-open; the pill shows an unread dot. Until the first page exists, the greeting offers one-click starter ideas. After that a **Get set up** card shows a progress ring and **only the next open step** with its action button (`src/onboarding/tasks.ts`):

| Track | Tasks, in order |
| --- | --- |
| Admin (owner/admin) | Publish your first page · Connect a data source · Invite your team (skippable) · Set up an alert |
| Member (internal) | Publish your first page · Connect your agent (skippable) · Explore a shared page · Leave a comment |
| Personal | Publish your first page · Try the assistant · Share a page |

External sharees get no checklist. Telegram, Slack and skill tasks were dropped (#252).

- Skippable tasks show **Skip** and are excluded from the percentage so 100% stays reachable.
- Ask *"how do I get started?"* anytime and the agent can surface the same checklist via its `show_onboarding` tool.
- Tasks cross off from live signals; the card re-derives on window focus / tab return.
- At **100%**, a one-shot celebration fires once (`POST /v1/home/onboarding/celebrate`).
- **Hide** dismisses (`POST /v1/home/onboarding/dismiss`). Status: `GET /v1/home/onboarding?workspace=`.

See [../team/workspace-assistant.md](../team/workspace-assistant.md#setup-checklist-onboarding) for admin vs member tracks and API details.

## Localization

The Home studio shell (rails, lenses, Admin, chat composer, onboarding copy) ships in **English and Spanish** — strings follow the browser locale (`en` / `es`). Artifact content is not auto-translated. Any agent talking to the user — including you — answers in the language the user writes in (Spanish for Argentina uses *vos*); see [../SKILL.md § Talk to the user](../SKILL.md#talk-to-the-user).

## Account menu

Your avatar in the **chrome bar** (top of the canvas on all screen sizes) opens a menu to switch **Personal vs team spaces**, manage **linked accounts** (see Google accounts on one login), connect Telegram (direct deep link from Settings → Telegram), open recently deleted pages (**Recently deleted** in the Artifacts lens), or sign out.

On narrow viewports the left rail collapses into a **mobile drawer**; lens and tab state still sync to the URL hash.

## Create with AI

There is no **Create with AI** rail button any more (#251): it is **New → Describe it to AI** (Spanish: **Nuevo → Describilo a la IA**), shown when `ai.create` is on — see [../api/features.md](../api/features.md). The flow runs in the chat composer: optional clarifying questions with option chips, then **Ready to build this?** with **Who can see it?** (**Private** default, **Team** in a workspace, **Anyone with the link** unless public links are off) and **Build it** → `POST /v1/create/generate`.

- A live **Building · {name}** tab (Spanish **Creando · {name}**) streams the page as it is built (sandboxed srcdoc, never saved, no View/Edit); on success the real artifact replaces it. On failure the tab offers **Try again**.
- **Closing that tab stops the build** (`POST /v1/builds/{id}/cancel`). Closing the browser does not: with the `BUILD_JOBS` Durable Object bound (default `wrangler.toml`), the build runs as a durable job, the client reattaches with `GET /v1/builds/{id}/events` if its stream drops, and a build that ends unwatched notifies the user (`page_build` in the bell / Needs you). One build per user at a time; 12-minute job timeout (#276).

## Related

- [editor.md](editor.md) — Live Studio at `/a/{slug}/edit`; Edit-Lite comparison
- [../team/assets.md](../team/assets.md) — asset library API, deliverables, gated download links (the Home Assets tab is retired)
- [../team/activity-feed.md](../team/activity-feed.md) — Needs You + Pulse API and visibility settings
- [../team/workspace-assistant.md](../team/workspace-assistant.md) — workspace AI on Home
- [../modules/_shared/permissions.md](../modules/_shared/permissions.md) — who can edit vs view
- [../api/folders.md](../api/folders.md) — personal vs team folders on Home
