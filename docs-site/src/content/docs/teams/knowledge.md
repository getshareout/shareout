---
title: Workspace Knowledge
description: An opt-in, per-workspace library of what your workspace knows — learned from your pages, browsable by people, and searchable by agents.
---

**Knowledge** is a per-workspace library of what your workspace knows. It reads your published
pages and distills each one into a short markdown note — the key facts, numbers, topics and
names a teammate would want — so the knowledge spread across hundreds of pages becomes
something you can browse and search in one place.

It is **opt-in and off by default**. A workspace without Knowledge works exactly as before.
When you turn it on, ShareOut learns from your pages in the background and keeps the library up
to date as you publish. Every note links back to the pages it was learned from, so you can
always trace a fact to its source.

Knowledge is **visible to workspace members only**, and it only ever learns from your own
workspace's pages.

**Knowledge requires a paid plan** (Pro, Teams, or Enterprise). Free workspaces see an
upgrade prompt; turning it on or running **Learn from existing pages** returns
`403 UPGRADE_REQUIRED` without spending AI credits.

## Turn it on

Open a workspace and select **Knowledge** in the left navigation. An owner or admin sees a
**Turn on knowledge** button. Members without admin rights see a note asking an admin to turn
it on.

Once it is on, the lens is empty until pages are learned. You have two ways to fill it:

- **Learn from existing pages** — an owner or admin can queue your recent pages for learning in
  one click. This picks up to the **200 most recent** live pages; a progress bar tracks the
  bounded on-demand run and the rest drains on the hourly cron. Returns `{ "queued": 0 }` when
  everything is already up to date.
- **Let it grow** — every page you publish from now on is learned automatically.

```http
POST /v1/workspaces/{workspaceId}/knowledge/enable
Authorization: Bearer {token}
Content-Type: application/json

{ "enabled": true }
```

```http
POST /v1/workspaces/{workspaceId}/knowledge/backfill
Authorization: Bearer {token}
```

## How learning works

Learning runs in the background on an hourly cycle:

1. **You publish a page.** The page is queued for learning. Queuing is content-aware — editing
   and re-publishing the same page many times in a morning still results in one learn task, and
   re-publishing identical content does not re-learn.
2. **The learner digests it, usually within the hour.** On each hourly cycle it reads the
   page's text, name, description and tags, and writes a short digest note with a title,
   topics, named entities and a few sentences of concrete facts. It works through a limited
   number of pages per workspace each cycle, so a large backfill can take several cycles to
   finish.
3. **The digest is indexed for search.** Each note is embedded so agents can find it by meaning,
   not just by exact words.

Pages that are not approved by moderation, and pages that have been [forgotten](#your-controls),
are skipped.

### Nightly consolidation

After digests land, a **nightly consolidator** merges them into richer notes:

- **Overview** (`index.md`) — auto-written trunk summarizing how many pages are learned and the top topics.
- **Topic pages** — facts gathered by subject under `topics/`.
- **Entity pages** — clients, products, and people under `entities/` (with alias dedup so "Acme" and "Acme Corp" collapse).

The consolidator reuses the same caps and tombstones as the learner — hand-edited or pinned notes are never overwritten.

### Guidance (house rules)

The **Guidance** branch in the Knowledge tree holds your team's manual context files — voice, style, conventions — the same markdown that used to live under Admin → Intelligence. Members read; admins write. The workspace assistant and `/v1/skill` both inject the entry guidance file as ambient context.

Manage Guidance from the Knowledge lens (not a separate admin tab). REST routes stay at `/v1/workspaces/{id}/context*` — see [Workspaces → context files](/teams/workspaces/#workspace-context-files).

### Your controls

You stay in charge of the library. On any note's detail view you can:

- **Edit** — rewrite a note by hand. A note you edit is marked as yours, and **the learner will
  never overwrite it**.
- **Pin** — mark a note to keep. Pinning goes through the same "this is yours" path as editing,
  so a pinned note does not change automatically.
- **Forget** (owner/admin) — remove a note. Forgetting also stops that page from being
  re-learned, so it stays gone.

## What's in it

Knowledge is a small tree of markdown files, one file per note. The YAML frontmatter holds the
metadata; the body is plain notes. Every note carries the pages it came from in `sources`.

```markdown
---
kind: artifact-digest
id: art.5d2e74a1
title: Day-0 Retention Path
topics: [retention, onboarding]
entities: [signup]
sources: [art_5d2e74a1]
confidence: inferred
learned_at: 2026-07-09T12:00:00Z
pinned: false
---
Day-0 retention holds at 41% for the committed cohort. New users who send a
first message within 10 minutes retain roughly 2x better than those who don't.
```

The tree is organized by note **kind**:

| Kind | What it is |
| --- | --- |
| `overview` | The trunk (`index.md`) — an auto-written summary of how many pages are learned and the most common topics |
| `artifact-digest` | One digest per page, under `artifacts/` — the leaves the learner writes automatically |
| `topic` | A topic page under `topics/` — a place to gather facts about a subject |
| `entity` | A client, person, product or system under `entities/` |
| `decision` | A recorded "we decided X because Y" |
| `timeline` | What happened over a period |

Today the learner writes the **per-page digests**; the consolidator maintains **overview**, **topics**, and **entities**. **Decisions** and **timeline** notes are part of the same tree and can be written by you or an agent through the [edit control](#your-controls) or the [API](#rest-api). **Guidance** files are manual only.

## Browsing Knowledge

The **Knowledge** lens opens in a **tree** view by default — indented branches for Overview, Topics, Entities, Pages (digests), Decisions, and Guidance. Select a node to read it in the detail pane. Switch to **Table** for the dense sortable list (KPI strip, search, kind filter).

- **Tree view** — scan hierarchy, freshness badges, and pinned markers at a glance. Guidance lives under its own branch.
- **Table view** — KPI strip (pages learned, topics, entities, last updated), search, a filter for note kind, and sortable rows (title, kind, topics, source count, learned date).
- **Note detail** — metadata, distilled body, and **Sources** (click to open the page). A freshness line ("Learned 3 days ago") shows how current the note is.

**Learn from existing pages** shows a progress bar while the on-demand distill run works (`GET /knowledge/status` — `queued`, `processed`, `total`, `running`). Large backfills may continue on the hourly cron after the bar finishes.

### Deep links

Bookmark or share a Knowledge view from Home:

| Hash | Opens |
| --- | --- |
| `#l/knowledge` | Knowledge list |
| `#l/knowledge/{path}` | A specific note (e.g. `#l/knowledge/artifacts/art_5d2e74a1.md`) |

## For agents

When Knowledge is on, the [workspace assistant](/teams/workspace-assistant/) can consult it
instead of re-reading every page. It has two read-only tools:

- **`knowledge_search`** — search what the workspace knows by topic, client, person or
  question, optionally filtered by note kind. Returns matching note summaries.
- **`knowledge_get`** — read one note in full, including its distilled body and the pages it was
  learned from. Pass the note's `path` or `id` from a search result.

Both tools work only inside a workspace (not on your Personal space), and both return
`{ "enabled": false }` when Knowledge is off for that workspace.

## REST API

Service tokens and members can read and grow the library over REST. All routes require
workspace membership. When Knowledge is off, the root `GET` returns `{ "enabled": false }` and
the per-note routes return `404` — never an error.

| Method | Endpoint | Who | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/knowledge` | Member+ | Settings + counts (`enabled`, `counts`, `lastUpdated`, `total`) |
| `GET` | `/v1/workspaces/{id}/knowledge/status` | Member+ | Training progress (`queued`, `processed`, `total`, `running`, `lastProcessedAt`) — 24h window |
| `GET` | `/v1/workspaces/{id}/knowledge/tree` | Member+ | All note summaries grouped by kind (no bodies) |
| `GET` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | One note — full markdown body + sources |
| `PUT` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | Replace a note's markdown; marks it as hand-edited |
| `DELETE` | `/v1/workspaces/{id}/knowledge/files/{path}?forget=1` | Admin+ | Delete a note; `forget=1` stops it being re-learned |
| `POST` | `/v1/workspaces/{id}/knowledge/enable` | Admin+ | Turn learning on or off (**paid plan** required to enable) |
| `POST` | `/v1/workspaces/{id}/knowledge/backfill` | Admin+ | Queue up to 200 recent live pages; returns `{ queued, kicked }` (**paid plan**) |

A hand-edited note (via `PUT`) is never overwritten by the learner — the same rule the edit
control follows in the lens.

```http
PUT /v1/workspaces/{workspaceId}/knowledge/files/topics/retention.md
Authorization: Bearer {token}
Content-Type: text/markdown

---
kind: topic
id: topic.retention
title: Retention
topics: [retention]
---
What we know about retention across the workspace.
```

```http
DELETE /v1/workspaces/{workspaceId}/knowledge/files/artifacts/art_5d2e74a1.md?forget=1
Authorization: Bearer {token}
```

## Privacy & scope

- **Members only.** The Knowledge library is visible to workspace members. External sharees get
  no Knowledge surface.
- **Your own pages only.** Notes are derived from your workspace's published pages — nothing
  from other workspaces, and only pages approved by moderation.
- **Opt-in.** Knowledge is off until an owner or admin turns it on, and can be turned off again.

## Related

- [Workspace assistant](/teams/workspace-assistant/) — the assistant that uses `knowledge_search` and `knowledge_get`.
- [Data catalog](/teams/catalog/) — a governed map of your *data* (sources, lineage, glossary); a different, complementary thing.
- [Your workspace (Home)](/everyone/your-workspace/) — where the Knowledge lens lives.
