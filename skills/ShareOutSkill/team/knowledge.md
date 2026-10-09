# Workspace Knowledge

**Knowledge** is a per-workspace library of what your workspace knows. It reads your published pages and distills each one into a short markdown note — the key facts, numbers, topics and names a teammate would want — so the knowledge spread across hundreds of pages becomes something you can browse and search in one place.

Load [SKILL.md](SKILL.md) first.

## Overview

- **Opt-in and off by default.** A workspace without Knowledge works exactly as before.
- **Owner/admin only to turn on.** No tier requirement — `POST …/knowledge/enable` and `…/backfill` are gated on workspace role (owner/admin), returning `403 FORBIDDEN` for members without that role.
- **Members only.** External sharees get no Knowledge surface.
- **Your own content only.** Notes and search come from your workspace's published pages and Files — nothing from other workspaces, and only pages approved by moderation.

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

## Search what the workspace knows (agents)

Once Knowledge is on, every **File** in the workspace (Assets: PDF, DOCX, XLSX, PPTX, CSV, TXT/MD, images) and every **published page** is read in the background and split into cited passages. Nobody has to do anything — new uploads, new file versions and re-publishes are picked up automatically, and deleted files drop out.

One call returns the passages that answer a question, each with a citation:

```http
GET /v1/workspaces/{workspaceId}/knowledge/search?q=renewal+date+for+Acme&limit=5
Authorization: Bearer {token}
```

```json
{
  "query": "renewal date for Acme",
  "mode": "hybrid",
  "hits": [
    {
      "id": "dlv_8f2c…:3",
      "text": "The agreement renews on 1 May 2027 unless…",
      "locator": "Term and renewal",
      "score": 0.0325,
      "source": { "kind": "asset", "id": "dlv_8f2c…", "title": "Acme MSA.pdf", "url": null },
      "cite": "Acme MSA.pdf — Term and renewal"
    }
  ]
}
```

- Add `&format=md` to get compact markdown (`[1] cite (kind id, url)` + passage) ready to drop into an LLM prompt.
- **Quote `cite` when you answer** so the reader can find the source. Pages include a `url`; Files are identified by `source.id`.
- `mode` is `hybrid` (meaning + keywords) when the instance has embeddings configured, else `keyword`.
- Results only include what the caller may see: another member's private page or File never appears.
- `409 KNOWLEDGE_DISABLED` means Knowledge is off — the `hint` says how an admin turns it on.

Check coverage — what has been learned and what couldn't be read:

```http
GET /v1/workspaces/{workspaceId}/knowledge/sources?limit=50
```

Returns `counts` by status (`ready`, `processing`, `unsupported`, `failed`), the total `chunks`, and the most recently updated `sources` with their `error` when one couldn't be read. `POST …/knowledge/backfill` also queues every existing page and File not yet learned at its current version — `corpus` is how many started, `corpusRemaining` how many are left (call it again to continue; up to 300 per call).

## Explore the knowledge graph (agents)

While learning, Knowledge also reads every passage for the **things the workspace is about**: clients, people, products, projects, campaigns, contracts, and more. It records them as **entities**, how they connect as **relations** (`client_of`, `works_for`, `part_of`…), and concrete values as **facts** (budgets, dates, statuses). Every item keeps the exact quote and source it came from.

- The same thing named differently across files is merged: "Acme Inc.", "ACME" and "Acme, S.A." become one entity.
- When a file changes, its old evidence is replaced. When it's deleted, its evidence goes away.

The calls, from broad to specific:

```http
GET /v1/workspaces/{workspaceId}/knowledge/entities?type=Organization&q=acme&limit=20
```

Returns `types` (each entity type with its count) and `entities`, most-mentioned first. Each entity has `id`, `type`, `name`, `aliases`, `mentions` and up to five `sources`.

```http
GET /v1/workspaces/{workspaceId}/knowledge/entities/{entityId}?format=md
```

Returns one entity: its `facts` (each with a `quote` and `source`), its `relations` (`direction` `out`/`in`, plus the `other` entity), and quoted `mentions` with a `cite`. `format=md` gives a compact briefing ready for an LLM prompt.

```http
GET /v1/workspaces/{workspaceId}/knowledge/graph?focus={entityId}&depth=1&limit=100
```

Returns `nodes` and `edges` for drawing or walking the graph: the neighbourhood around `focus` (`depth` 1–3), or the workspace's most-mentioned entities when no focus is given.

How to use it:

- **Answering about a client or project:** find it with `entities?q=`, then read `entities/{id}?format=md` and cite the quotes.
- **Need passages, not structure:** use `search`.
- **Visibility:** the graph follows the same rule as search. An entity, fact or connection only appears if you can see at least one source behind it.
- **Gaps:** extraction needs Workers AI on the instance. Without it, Knowledge still searches but the graph stays empty.

## What Knowledge costs the workspace

Everything Knowledge does is metered per workspace — embeddings, searches, ingest runs, and the workspace store's own storage and database work:

```http
GET /v1/workspaces/{workspaceId}/knowledge/usage?days=30
```

Owner/admin only. Returns `totalCostMicroUsd` and its breakdown:

- `ai[]`: one entry per kind, with `units`, `unitKind`, `events` and `costMicroUsd`:
  - `knowledge_embedding`: tokens
  - `knowledge_extraction`: tokens
  - `knowledge_search`: queries
  - `knowledge_ingest`: Workflow steps
- `storage`: bytes, sources, chunks, rows read and rows written.
- `vectors`: stored vectors and their monthly cost.
- `pricing`: the unit prices used.

Costs are Cloudflare list prices in micro-USD (1,000,000 = $1) before any account-level free allowance. They are tracking only; nothing is billed.

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
| `POST` | `/v1/workspaces/{id}/knowledge/enable` | Admin+ | Turn learning on/off |
| `POST` | `/v1/workspaces/{id}/knowledge/backfill` | Admin+ | Queue up to 200 recent live pages for notes, and every page and File for search → `{ queued, kicked, corpus, corpusRemaining }` |
| `GET` | `/v1/workspaces/{id}/knowledge/search?q=&limit=&format=md` | Member+ | Cited passages from Files and pages (hybrid search) |
| `GET` | `/v1/workspaces/{id}/knowledge/sources?limit=` | Member+ | What has been learned: counts by status + recent sources |
| `GET` | `/v1/workspaces/{id}/knowledge/entities?type=&q=&limit=` | Member+ | Entities by mentions + `types` with counts |
| `GET` | `/v1/workspaces/{id}/knowledge/entities/{entityId}?format=md` | Member+ | One entity: facts, relations, quoted mentions |
| `GET` | `/v1/workspaces/{id}/knowledge/graph?focus=&depth=&limit=` | Member+ | Nodes + edges (neighbourhood or top entities) |
| `GET` | `/v1/workspaces/{id}/knowledge/usage?days=30` | Admin+ | Metered cost: AI, storage, vectors (micro-USD, tracking only) |

## Related

- [workspace-assistant.md](workspace-assistant.md) — `knowledge_search` / `knowledge_get` tools
- [workspace-context.md](workspace-context.md) — Guidance files (same REST as context)
- [catalog.md](catalog.md) — governed map of your *data* (complementary to Knowledge)
- [../core/workspace-home.md](../core/workspace-home.md#workspace-lenses) — Knowledge lens in Home
- [api.md](api.md#workspace-knowledge) — endpoint table
