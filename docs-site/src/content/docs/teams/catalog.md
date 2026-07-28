---
title: Data Catalog
description: An optional, per-workspace map of your data — sources, datasets, lineage, glossary — that agents keep up to date and consult when building.
---

The **Data Catalog** is an optional, per-workspace map of your data: its **sources,
datasets, pipelines, dashboards, models, metrics and business terms**. It is written as flat
markdown + YAML files, kept up to date mostly by agents, and read two ways — humans browse
and search it; the authoring assistant consults it to use real table names, prefer
**certified** data, and steer clear of **deprecated** sources.

It's **opt-in and advisory**. A workspace without a catalog works exactly as before, and the
catalog never blocks anything — it informs. Turn it on when you want more out of your data.

## Turn it on

Open a workspace and select **Catalog** in the left navigation. An owner or admin sees an
**Enable** button. Once enabled, you can **seed** it automatically from the workspace's
existing connectors — every connector becomes a starting `source` entry you (or an agent)
can flesh out.

When the catalog is already on, **new connectors auto-seed** on create — each
connection becomes a `source` entry without a manual seed click. Dataset writes
(materialize jobs, table/json updates) can also append **lineage edges** to catalog
entries when the catalog is enabled.

```http
POST /v1/workspaces/{workspaceId}/catalog/enable
Authorization: Bearer {token}
Content-Type: application/json

{ "enabled": true }
```

```http
POST /v1/workspaces/{workspaceId}/catalog/seed
Authorization: Bearer {token}
```

Re-seeding is idempotent and **never overwrites** an entry someone edited by hand.

## What's in it

One markdown file describes one asset. The YAML frontmatter holds the metadata; the body is
plain notes. Only three fields are required — **kind**, **id**, **title** — and everything
else is optional, filled in over time.

```markdown
---
kind: source              # source · event · dataset · table · view · pipeline · dashboard · model · metric · term
id: events_silver.chat_sent
title: Chat Sent
status: certified         # draft · certified · deprecated
owner: data-platform
domain: chat
tags: [tier.silver, PII.None]
upstream: [warehouse.clustered_events]
downstream: [pipelines.engagement_metrics]
connection: snowflake-prod
fqn: analytics-platform.events_silver.chat_sent
---

# Chat Sent
What it is, gotchas, a sample query.
```

### Entry kinds

| Kind | Use for |
| --- | --- |
| `source` | External data behind a [workspace connector](/teams/connections/) — set `connection` + `fqn` |
| `event` | Raw analytics or telemetry events (often upstream of tables and pipelines) |
| `dataset` | Data your artifacts create — set `artifact` + `store` (e.g. `table:daily_metrics`) |
| `table`, `view`, `pipeline`, `dashboard`, `model`, `metric` | Finer-grained assets in your data mesh |
| `term` | Glossary entry — other assets link via `terms: [active-user]` |

`upstream` / `downstream` edges cross planes freely — e.g. an artifact `dataset` whose
`upstream` is a connector `source`.

### It maps both kinds of data

- **External data** — anything behind a workspace connector (Snowflake, BigQuery, Sheets,
  Shopify…). These are `source` entries with a `connection` and `fqn`.
- **Data your artifacts create** — tables and JSON stored inside an artifact. These are
  `dataset` entries. Lineage links the two, so you can see a dashboard's data traced all the
  way back to the warehouse table that feeds it.

## Browsing the catalog

The **Catalog** lens is read-only and built for large workspaces (1,600+ entries):

- **List view** — KPI strip (entries, events, % certified, % documented, orphans), instant
  search, kind/domain/status filters, and a **sortable dense table** (name, kind, domain,
  status, origin, lineage counts). Click a column header to sort.
- **Entry view** — metadata grid, notes body, and **navigable lineage tables** for upstream
  and downstream neighbors. Click any catalogued neighbor to jump to its entry; uncatalogued
  refs show as dashed placeholders so gaps are obvious.

### Deep links

Bookmark or share a catalog view from Home:

| Hash | Opens |
| --- | --- |
| `#l/catalog` | Catalog list |
| `#l/catalog/{entryId}` | A specific entry |

## Why it helps the assistant

When a workspace has a catalog, the authoring assistant looks things up in it before
building — so it uses the correct table names, prefers data you've marked **certified**, and
warns you before relying on something **deprecated**. It's a hint, never a hard rule: you
stay in control.

The assistant has read-only tools: **`catalog_search`** (filter by query, kind, domain,
status, tag) and **`catalog_get`** (full entry + lineage). Both return `{ enabled: false }`
when the catalog is off.

## Keeping it fresh

Agents grow the catalog like a wiki — adding and updating entries as they learn about your
data. Re-seeding from connectors is safe: it never overwrites an entry someone has edited by
hand. Auto-seed on new connections follows the same rule — existing hand-edited entries are
left alone. The stats on the list view (orphaned entries, stale entries) show you where the
map is thin.

### Grow via API

Any workspace member (or agent token) can upsert files:

```http
PUT /v1/workspaces/{workspaceId}/catalog/files
Authorization: Bearer {token}
Content-Type: application/json

{ "path": "sources/orders.md", "content": "---\nkind: source\nid: orders\n---\n..." }
```

```http
DELETE /v1/workspaces/{workspaceId}/catalog/files?path=sources/orders.md
Authorization: Bearer {token}
```

## REST API

All routes require workspace membership. A disabled catalog returns `{ "enabled": false }`
— never an error.

| Method | Endpoint | Who | Purpose |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/catalog` | Member+ | Search (`q`, `kind`, `domain`, `status`, `tag`) + facets |
| `GET` | `/v1/workspaces/{id}/catalog/manifest` | Member+ | Counts, adoption KPIs, orphans, dangling refs, staleness |
| `GET` | `/v1/workspaces/{id}/catalog/entries/{entryId}` | Member+ | One entry + upstream/downstream neighbors |
| `GET` | `/v1/workspaces/{id}/catalog/lineage` | Member+ | Full node+edge graph |
| `POST` | `/v1/workspaces/{id}/catalog/enable` | Admin+ | Opt in/out |
| `POST` | `/v1/workspaces/{id}/catalog/seed` | Admin+ | Seed `source` entries from connectors |
| `PUT` | `/v1/workspaces/{id}/catalog/files` | Member+ | Upsert a catalog markdown file |
| `DELETE` | `/v1/workspaces/{id}/catalog/files?path=` | Member+ | Delete a file |

See [Teams API → Data catalog](/teams/api/#data-catalog).

## Related

- [Workspace connections](/teams/connections/) — the external half of the catalog.
- [Skill Marketplace](/teams/skill-marketplace/) — reusable how-to playbooks (a different thing).
