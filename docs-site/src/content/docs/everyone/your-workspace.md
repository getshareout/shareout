---
title: Your workspace (Home)
description: The ShareOut Home — the left rail, tabbed pages, the Inspector, quick Edit mode, and the agent dock.
---

ShareOut **Home** is where you manage pages, see what needs attention, and open artifacts without leaving one surface. The workspace has these regions:

| Region | What it does |
| --- | --- |
| **Left rail** | Brand, **New**, **Search** (⌘K), then **Home**, **Artifacts**, **AI skills**, **Automations**, **AI tasks** (owners/admins), **Data**, **Knowledge**, **Catalog**, and **Admin** (owners/admins). **Help & support** and **Documentation** sit at the bottom |
| **Canvas** | Home, the lens you picked, or an open artifact; bottom **agent dock** |
| **Top bar** | Open-artifact tabs, the **Notifications** bell, and the account menu (where you switch spaces) |
| **Right rail** | The **Inspector** for the open artifact — **Details**, **Comments**, **Automate** (and **Editing** while you edit). Hidden on Home |

In your **Personal** space the rail shows only Home, Artifacts, AI skills and Automations;
AI tasks, Data, Knowledge, Catalog and Admin appear inside a team workspace.

Rails and panes are resizable; widths are remembered in your browser.

## Home

**Home** fits what matters on one screen. At the top: a greeting, today's date and how many
things are waiting on you, and a box to **ask your workspace or make something** — type and
press Enter to send it to the assistant, or pick **Table from an Excel file** or **Upload
files**. The sparkle at the start of the box opens the chat; a dot on it means a reply is
waiting. Under it, cards:

| Card | What it shows |
| --- | --- |
| **Your artifacts** | Small tiles with a preview: **Recent** (what you opened), **For you**, **Favorites** and **Shared with me**. **See all** opens Artifacts |
| **Needs you** | What is waiting on you from the last two weeks, each with its button (**Review**, **Reply**, **Open**): comments and replies, mentions, access requests, alerts, failed runs and more. **×** dismisses a row; **See all** opens the bell, where older items stay |
| **In your workspace** | What happened lately: publishes, data that updated by itself, failed deliveries, new members |
| **This week** | Views of the artifacts you made, by day and against last week, how many people opened them and the most viewed one. **Analytics** has the detail |
| **What's new in ShareOut** | The latest changes, each linked to its entry in [What's new](/whats-new/) |
| **All your artifacts** | Below the first screen: your artifacts as a table, newest first |

Every card keeps its place when it is empty and says so in one line. On a phone, **Needs
you** comes first and the tiles slide sideways.

The **More** menu (**⋯**, top right of Home) holds the rest:

- **Customize** — drag the cards to reorder them, resize them from the corner (a third, two
  thirds or the full width), and switch **Your artifacts** between tiles and a table; then
  **Done**. The layout is saved in your browser.
- **Today**, **7d**, **30d** — how far back **In your workspace** goes.
- **Activity visibility** (owners and admins) — who sees each event kind (see
  [Workspace admin → Activity visibility](/teams/admin/#activity-visibility)).

## Pro search (⌘K)

One ranked, typo-tolerant search engine powers every jump surface in Home:

| Surface | How to open |
| --- | --- |
| **Command palette** | **⌘K** / **Ctrl+K** anywhere in Home, or **Search** in the left rail — searches pages, folders, people and actions, plus page text, Knowledge, datasets, connectors, schedules, AI tasks, alerts and AI skills |
| **Quick search in Artifacts** | Type in the **Quick search…** box above the list in **Artifacts** — it narrows the list as you type |

An empty palette shows your **Recent searches** (**×** removes one, **Clear** empties the
list) and **Recently opened** pages. A search is remembered when you open a result or
press **Enter**. Results come in two parts: pages, folders, people and actions appear as
you type, with no wait; matches **In page text**, **In Knowledge**, and the other groups
fill in a moment later below them. **↑↓** navigate, **Enter** opens, **Esc** closes.

**Ask AI:** the last row is always **Ask AI: “your query”**. Pick it to ask a one-shot
question over your workspace pages — e.g. `revenue last quarter`. It calls
`POST /v1/ask` and shows the answer inline with **Sources** links to the cited pages. This
is read-only (no tools, no publish) — distinct from the bottom **Ask your workspace…**
dock, which runs the full [workspace assistant](/teams/workspace-assistant/).

The same search engine backs `GET /v1/search` and the workspace assistant's **`search_workspace`** tool — see [Teams API → Search](/teams/api/#search).

## Notifications

A **bell** in the top bar (left of your avatar) opens a right-docked panel — same glass-sheet language as account and help panels. A red badge counts items that need you.

**Unread** and **Seen** tabs split the feed. **Unread** groups what is still waiting on
you: **Needs your approval**, **Action items**, and **Recent** (the activity from
**Needs you**). **Seen** lists notifications you opened or dismissed within the current
window (muted, read-only).

| Card type | What it shows |
| --- | --- |
| **Approval** | Publish-approval requests — **Approve** / **Reject** when you are a pending voter; otherwise an awaiting-review status |
| **Action item** | Action items assigned to you, with a due date (**Overdue**, **Due today**…) — **Done** / **Reopen** |
| **Activity** | Comments, replies, shares, access requests, files emailed to the workspace inbox, failed runs, **metric alerts**, **metric watches**, **stale data** (Sheets not synced in 7+ days), **unused pages** (monthly janitor), and AI page builds that ended while you weren't watching — **×** dismisses one |

**Opening the bell marks its activity as read.** The badge drops those items at once,
and next time they are under **Seen** (they also leave **Needs you** on Home). There is no
separate "mark all read" step. Approvals stay until someone decides them, and action
items stay until you mark them **Done**. Opening an activity card navigates to the
target.

Badge count = pending approvals you can decide + unread activity + open action items. The panel is primed on page load from the activity feed and publish-approval queue.

### Weekly workspace digest

Every **Monday at 13:00 UTC**, each active workspace emails its **internal members**
a **product** email summarizing the last seven days: published/updated pages (with
auto-generated descriptions), top viewed pages, open comments raised that week, and
any **stale-data** flags. Dead weeks are skipped. Opt out under account email
preferences (**product** category). Distinct from the personal marketing weekly digest.

## Workspace lenses

Beyond Home, the left rail opens full-page lenses inside Home — no separate admin
app required:

| Lens | Who | What you do there |
| --- | --- | --- |
| **Artifacts** | Everyone | Every page and uploaded file, in folders — see below |
| **AI skills** | Everyone | **Skills** — official skills **recommended by ShareOut** and workspace skills — and **Modules**, with **New module** for JS libraries |
| **Automations** | Everyone | Your scheduled sends; the **Alerts** chip switches to metric alerts |
| **AI tasks** | Owners/admins | Manage AI tasks (crew automations) |
| **Data** | Workspace members | **Data sources** — list, create, and OAuth-install connectors — and **Tables**, the workspace datasets |
| **Knowledge** | Members (admins enable) | Browse the optional [workspace knowledge](/teams/knowledge/) — notes learned from your pages |
| **Catalog** | Workspace members | Browse the optional [data catalog](/teams/catalog/) — sources, lineage, glossary |
| **Admin** | Owners/admins | Control panel — one page per topic in a sidebar, grouped as People, Content, AI & billing, Security and Workspace |

Each lens has native create flows — you stay in Home instead of handing off to chat.

There is no **Assets** lens any more. Files you upload (**New** → **Upload files**, or
drop them on Home) become artifacts — documents, images and video — and live in
**Artifacts** like any page. Links to older files keep working.

See [Workspace admin](/teams/admin/) for the full Admin lens reference.

## Deep links & mobile

Home URLs are bookmarkable:

| Hash | Opens |
| --- | --- |
| `#l/brief` | Home (default) |
| `#l/artifacts` | Artifacts |
| `#l/catalog` | Data Catalog list |
| `#l/catalog/{entryId}` | A specific catalog entry |
| `#l/admin` | Admin lens |
| `#a/{slug}` | Artifact tab for that page |

A link to a lens that isn't in your rail (an old `#l/assets` link, say) opens Home.
Browser back/forward navigates between lenses and tabs. On phones the left rail
becomes a **hamburger drawer** instead of a fixed sidebar.

In **Artifacts**, folders appear above your page cards — click a folder to
drill in (Drive-style) with a **breadcrumb** to climb back. Create, rename, or
delete folders from the header (team folders: `owner`/`admin` for any folder,
members for the ones they created unless an admin turned that off; personal
folders are yours). Deleting a folder orphans its pages back to Artifacts —
it never deletes the pages themselves. Recent, Favorites, Shared, and Mine
filters still show everything; folders are navigation, not a filter that hides pages.

Use the filter row to show **Recently deleted** pages (soft-deleted artifacts you
can restore).

## Open pages in tabs

Click a page card to open it in a **tab** beside Home — like an IDE. New tabs open first, right after Home. Many pages can stay open; a **dirty dot** on a tab means unsaved edits in quick Edit mode.

- **Drag to reorder** — grab any open page tab (Home stays pinned) and drag it left or right.
- **All open tabs** — when the tabs no longer fit, a list button at the end of the row names every open tab; with more than eight open it adds a **Find a tab** box.
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

- Point at any element to outline it and click to select it — text, an image, a link or a whole block. The **Elements** list in the side panel shows the page as a tree: hover highlights an element, click selects it and scrolls to it
- Rewrite text inline; make it bold, italic or a link, change its color and size, or **Convert to…** a heading or paragraph
- Change images (URL or upload) and links; give a block a background, padding and alignment
- Move an element up or down, **Duplicate** it, or **Delete** it
- **Ask AI** about what you selected — or, with nothing selected, about the whole page (*What should change on this page?*). The quick asks fit what you picked: text gets **Rewrite**, **Shorten**, **Fix grammar** and **Translate**; a block gets **Tidy spacing** and **Make it a card**; an image gets **Write alt text**. Or type your own request
- See the AI's change in place as an **AI proposal**: switch **Before** / **After** to compare, then **Keep change**, **Try again** or **Discard** (**Esc** discards). The rest of the page is locked until you pick one
- **Undo / redo**, autosave to your private draft, and **Publish** when ready
- Open **full editor ↗** (`/a/{slug}/edit`) for bindings, data model, collab, and advanced Inspect tools

Edit mode is for owners, named editor collaborators, and workspace **owners/admins**. Plain workspace members need an explicit **Can edit** invite.

Keyboard shortcuts in Edit: **⌘/Ctrl+S** saves your draft now (only the **Publish** button publishes), **⌘/Ctrl+Z** undo, **⌘/Ctrl+Shift+Z** or **⌘/Ctrl+Y** redo, **Esc** deselect.

**When the draft changed somewhere else** — in another tab, on another device, or by
the agent — saving pauses and a bar says **This draft changed somewhere else.** Pick
**Keep mine** to save your version, or **Load newer** to drop your unsaved changes and
open the newer draft.

**When someone published while you were editing**, **Publish** stops with
**Changed since you started (…)**, naming the version, who published it and when.
**See what changed** opens the difference; **Publish anyway** puts your version live
over theirs.

## Inspector (right rail)

On an artifact tab the Inspector has three tabs: **Details**, **Comments** and
**Automate**. In Edit mode it shows one tab instead, **Editing**: the selected element's
properties, the **Elements** tree and **Ask AI**.

On phones and tablets (screens up to 1100px wide) there is no right rail: tap
**Options** in the artifact bar to open the same panel as a sheet from the bottom.

| Tab | What's there |
| --- | --- |
| **Details** | Title and description (click to edit), star, an owner · version · date line with status pills, and the live version's change note ("Updated …"). Buttons: **Open**, **Edit**, **Copy link**, **Download original** (converted PDFs) and **Delete**. Then who can see it, in one line, with a **Share** button; **Pages (N)** for [multi-page artifacts](/guides/multi-page/); and **Organize** (folder and tags) for editors. **More** folds away **Approvals** (**Approve this version**), **Analytics** and **Tests** (editors), **Knowledge from this artifact** when [Knowledge](/teams/knowledge/) learned notes from it, and two rows that open their own view: **Data** (HTML pages) and **Versions** — see [Version history](/everyone/version-history/) |
| **Comments** | Full thread, replies, @mentions, composer. **Open / All** filter, **Resolve / Reopen**, **Assign**, and an "on vN" hint for comments on older versions — see [Review & approvals](/everyone/review/) |
| **Automate** | **Update the data** (Drive, a link or an emailed Excel — editors in a workspace), **Send now** (editors), this page's **Schedules** and **Alerts**, **Monitoring** (editors), and **Quick actions**: **Schedule a send**, **Set an alert**, **Set up an AI task**, or describe something custom in chat. Owners and editors see the shared schedules plus their own personal deliveries; other people's personal subscriptions stay private to them |

**Send now** is a one-shot send to **email**, **Slack**, or **Telegram** — it runs
immediately, no agent turn. Pick a Slack channel from a list (no pasting channel IDs).
**Schedule** turns it into a recurring job. If Telegram or Slack is not connected yet,
**Connect** walks you through linking; **Check again** refreshes status after OAuth.

**Monitoring** holds one-click **metric watches** on this page's tables — row count,
column sum, or last value. Alerts in the bell when the value moves ±20% from its
baseline (hourly check). See [Metric alerts → Watches](/guides/metric-alerts/#metric-watches).

Send now uses the same destination layer as [scheduled jobs](/guides/jobs/) —
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

When you joined a workspace in the last **14 days** (counted from when you accepted the
invite) — or your account is that new, on your Personal space — the chat prepares a
localized **setup checklist** for you. No model call, and it doesn't pop open: the
**Ask your workspace…** pill shows an unread dot. Until you have a first page, the
greeting offers a few starter ideas you can send with one click. After that a
**Get set up** card shows a progress ring and **only the next step**, with a button that
does it:

| Who | Steps, in order |
| --- | --- |
| Owners and admins | Publish your first page · Connect a data source · Invite your team · Set up an alert |
| Internal members | Publish your first page · Connect your agent · Explore a shared page · Leave a comment |
| Personal space | Publish your first page · Try the assistant · Share a page |

External sharees get no checklist.

- **Invite your team** and **Connect your agent** have a **Skip** button and don't count
  toward the percentage, so 100% stays reachable.
- Steps cross themselves off from what you actually do — come back to the tab after
  connecting something and the card updates.
- Ask *"how do I get started?"* anytime and the agent can surface the same checklist
  via its `show_onboarding` tool.
- At **100%**, a one-shot blue ring moment fires once (`POST /v1/home/onboarding/celebrate`);
  established workspaces are backfilled so it never retro-triggers.

Dismiss with the card's **Hide** button (`POST /v1/home/onboarding/dismiss`).
Status: `GET /v1/home/onboarding?workspace=`.

## Account menu

Your avatar opens a menu to switch **Personal vs team spaces**, manage **linked
accounts** (see Google accounts on one login), connect Telegram (Settings can
deep-link straight to the bot), or sign out.

## Create with AI

Open **New** at the top of the left rail and pick **Describe it to AI** (shown when
AI creation is on for the instance). Say what you need; the AI may ask a question or
two, then shows **Ready to build this?** with **Who can see it?** — **Private** (the
default), **Team** (in a team workspace), or **Anyone with the link** (where public
links are allowed). Pick **Build it**.

A **Building · {name}** tab opens and you watch the page come together; when it's done,
the real artifact replaces it. If the build fails, the tab offers **Try again**.
Closing that tab stops the build. Closing the browser doesn't on a standard install
(see [builds that outlive the tab](/self-host/ai/#builds-that-outlive-the-tab)): the
build keeps running on the server, and a notice in the bell (and in **Needs you**) tells
you when your page is ready. You can run one build at a time. Under the hood this is
`POST /v1/create/generate`.

## Related

- [Change anything](/everyone/the-editor/) — plain-language editing overview
- [Visual editor (Live Studio)](/spec/editor/) — full `/edit` studio reference
- [Work together](/everyone/collaborators/) — invites and access
- [Workspace assistant](/teams/workspace-assistant/) — AI on workspace home
