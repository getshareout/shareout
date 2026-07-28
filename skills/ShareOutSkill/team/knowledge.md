# Workspace Knowledge

**Knowledge** is a per-workspace library of what your workspace knows. It reads your published pages and distills each one into a short markdown note — the key facts, numbers, topics and names a teammate would want — so the knowledge spread across hundreds of pages becomes something you can browse and search in one place.

Load [SKILL.md](SKILL.md) first.

## Overview

- **Opt-in and off by default.** A workspace without Knowledge works exactly as before.
- **Paid plan required** (Pro, Teams, or Enterprise). Free workspaces see an upgrade prompt; `POST …/knowledge/enable` and `…/backfill` return `403 UPGRADE_REQUIRED` without spending AI credits.
- **Members only.** External sharees get no Knowledge surface.
- **Your own pages only.** Notes are derived from your workspace's published pages — nothing from other workspaces, and only pages approved by moderation.

## Turn it on

Open a workspace and select **Knowledge** in the left navigation. An owner or admin sees **Turn on knowledge**. Members without admin rights see a note asking an admin to turn it on.

Once on, the lens is empty until pages are learned:

- **Learn from existing pages** — owner/admin queues up to the **200 most recent** live pages in one click; a progress bar tracks the bounded on-demand run (`GET …/knowledge/status`); the rest drains on the hourly cron.
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

1. **You publish a page.** The page is queued for learning. Queuing is content-aware — editing and re-publishing the same page many times still results in one learn task, and re-publishing identical content does not re-learn.
2. **The learner digests it, usually within the hour.** It reads the page's text, name, description and tags, and writes a short digest note with a title, topics, named entities and concrete facts.
3. **The digest is indexed for search.** Each note is embedded so agents can find it by meaning, not just exact words.

Pages that are not approved by moderation, and pages that have been **forgotten**, are skipped.

### Nightly consolidation

After digests land, a **nightly consolidator** merges them into richer notes:

- **Overview** (`index.md`) — auto-written trunk summarizing how many pages are learned and the top topics.
- **Topic pages** — facts gathered by subject under `topics/`.
- **Entity pages** — clients, products, and people under `entities/` (with alias dedup so "Acme" and "Acme Corp" collapse).

The consolidator reuses the same caps and tombstones as the learner — hand-edited or pinned notes are never overwritten.

### Guidance (house rules)

The **Guidance** branch in the Knowledge tree holds your team's manual context files — voice, style, conventions — the same markdown that used to live under Admin → Intelligence. Members read; admins write. The workspace assistant and `GET /v1/skill` both inject the entry guidance file as ambient context.

Manage Guidance from the Knowledge lens (not a separate admin tab). REST routes stay at `/v1/workspaces/{id}/context*` — see [workspace-context.md](workspace-context.md).

### Your controls

On any note's detail view:

- **Edit** — rewrite by hand; the learner will **never overwrite** a hand-edited note.
- **Pin** — mark a note to keep (same protection as editing).
- **Forget** (owner/admin) — remove a note and stop that page from being re-learned.

## Browsing Knowledge

The **Knowledge** lens opens in a **tree** view by default — Overview, Topics, Entities, Pages (digests), Decisions, and Guidance. Select a node to read it in the detail pane. Switch to **Table** for a dense sortable list (KPI strip, search, kind filter).

**Learn from existing pages** shows a progress bar while the on-demand distill run works (`GET /knowledge/status` — `queued`, `processed`, `total`, `running`).

| Hash | Opens |
| --- | --- |
| `#l/knowledge` | Knowledge list |
| `#l/knowledge/{path}` | A specific note (e.g. `#l/knowledge/artifacts/art_5d2e74a1.md`) |

## For agents

When Knowledge is on, the [workspace assistant](workspace-assistant.md) can consult it instead of re-reading every page:

| Tool | Purpose |
| --- | --- |
| `knowledge_search` | Search by topic, client, person or question; optional kind filter; returns note summaries |
| `knowledge_get` | Read one note in full, including sources; pass `path` or `id` from search |

Both tools work only inside a workspace (not Personal home), and return `{ "enabled": false }` when Knowledge is off.

## REST API

All routes require workspace membership. When Knowledge is off, root `GET` returns `{ "enabled": false }` and per-note routes return `404`.

| Method | Endpoint | Who | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/knowledge` | Member+ | Settings + counts (`enabled`, `counts`, `lastUpdated`, `total`) |
| `GET` | `/v1/workspaces/{id}/knowledge/status` | Member+ | Training progress (`queued`, `processed`, `total`, `running`, `lastProcessedAt`) — 24h window |
| `GET` | `/v1/workspaces/{id}/knowledge/tree` | Member+ | All note summaries grouped by kind (no bodies) |
| `GET` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | One note — full markdown body + sources |
| `PUT` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | Replace markdown; marks hand-edited |
| `DELETE` | `/v1/workspaces/{id}/knowledge/files/{path}?forget=1` | Admin+ | Delete; `forget=1` stops re-learn |
| `POST` | `/v1/workspaces/{id}/knowledge/enable` | Admin+ | Turn learning on/off (**paid plan** to enable) |
| `POST` | `/v1/workspaces/{id}/knowledge/backfill` | Admin+ | Queue up to 200 recent live pages → `{ queued, kicked }` (**paid plan**) |

## Related

- [workspace-assistant.md](workspace-assistant.md) — `knowledge_search` / `knowledge_get` tools
- [workspace-context.md](workspace-context.md) — Guidance files (same REST as context)
- [catalog.md](catalog.md) — governed map of your *data* (complementary to Knowledge)
- [../core/workspace-home.md](../core/workspace-home.md#workspace-lenses) — Knowledge lens in Home
- [api.md](api.md#workspace-knowledge) — endpoint table
