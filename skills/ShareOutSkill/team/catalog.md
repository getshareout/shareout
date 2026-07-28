# Data Catalog

The **Data Catalog** is an optional, per-workspace map of a workspace's data — its
**sources, datasets, pipelines, dashboards, models, metrics and business terms** — written
as flat markdown + YAML files and kept up to date mostly by agents. Humans browse and
search it; the authoring AI agent consults it to ground on real table names, pick
**certified** data, and avoid **deprecated** sources.

It is **opt-in and advisory**. A workspace with no catalog behaves exactly as before. The
catalog never blocks a build — it informs. Load [SKILL.md](SKILL.md) first.

## Availability

Any workspace can turn it on — no plan gate. Enable it in **left-nav → Catalog** (owners/admins
see an **Enable** button), or `POST /v1/workspaces/{id}/catalog/enable`. Once on, it can
**auto-seed** itself from the workspace's existing connectors (see below).

## The entry model

One markdown file = one asset. YAML frontmatter is the metadata; the body is human prose.
Only three fields are **required** — everything else is optional and grown over time.

```markdown
---
kind: source              # REQUIRED — source|event|dataset|table|view|pipeline|dashboard|model|metric|term
id: events_silver.chat_sent  # REQUIRED — stable id; lineage edges point at this
title: Chat Sent          # REQUIRED — human label
# ---- everything below is optional ----
domain: chat              # data-mesh grouping
status: certified         # draft | certified | deprecated  (trust badge)
owner: data-platform
tags: [tier.silver, PII.None, domain.chat]   # dotted/tiered classification
terms: [active-user]      # glossary links
upstream: [warehouse.clustered_events]          # lineage: what it reads
downstream: [pipelines.engagement_metrics]          # lineage: what depends on it
aspects: [quality]        # reusable metadata blocks
last_updated: 2026-06-30
# --- where the data lives (pick the plane) ---
connection: snowflake-prod                    # EXTERNAL: a workspace connector
fqn: analytics-platform.events_silver.chat_sent   # EXTERNAL: fully-qualified name
artifact: art_5d2e74a1                         # INTERNAL: an artifact-native store
store: table:daily_metrics                     # INTERNAL: which store
---

# Chat Sent
Prose notes — what it is, gotchas, a sample query.
```

A half-documented entry (just `kind`/`id`/`title`) is valid. Unknown frontmatter keys are
preserved.

### Entry kinds

| Kind | Use for |
| --- | --- |
| `source` | External data behind a workspace connector — set `connection` + `fqn` |
| `event` | Raw analytics or telemetry events (often upstream of tables and pipelines) |
| `dataset` | Data your artifacts create — set `artifact` + `store` (e.g. `table:daily_metrics`) |
| `table`, `view`, `pipeline`, `dashboard`, `model`, `metric` | Finer-grained assets in your data mesh |
| `term` | Glossary entry — other assets link via `terms: [active-user]` |

### Two data planes, one lineage graph

ShareOut data comes from two places, and the catalog maps both:

- **External** — a workspace **connector** (Snowflake, BigQuery, Sheets, Shopify…).
  Use `kind: source`, set `connection` + `fqn`.
- **Internal** — an **artifact-generated** SDK store (json/table/blobs) living in the
  artifact's MiniDB. Use `kind: dataset`, set `artifact` + `store`.

`upstream`/`downstream` edges cross planes freely — e.g. an artifact `dataset` whose
`upstream` is a connector `source`.

### `kind: term` (glossary)

A business term (e.g. *Active User*). Other entries reference it via `terms: [active-user]`.

## Auto-seed

`POST /v1/workspaces/{id}/catalog/seed` creates a `kind: source` entry for every workspace
connector, so the catalog starts half-populated. Re-seeding is idempotent and **never
overwrites a file a human/agent edited** (those are marked `source: manual`).

When the catalog is already enabled, **new connectors auto-seed on create** — each
connection becomes a `source` entry without a manual seed click. Dataset writes
(materialize jobs, table/json updates) can also append **lineage edges** to catalog
entries when the catalog is enabled.

## Growing the catalog (agents)

Agents grow the catalog like a wiki — upsert a file:

```
PUT /v1/workspaces/{id}/catalog/files
{ "path": "sources/orders.md", "content": "---\nkind: source\nid: ...\n---\n..." }

DELETE /v1/workspaces/{id}/catalog/files?path=sources/orders.md
```

## Reading the catalog

REST (auth = workspace member or agent token):

| Method & path | Returns |
| --- | --- |
| `GET /v1/workspaces/{id}/catalog?q=&kind=&domain=&status=&tag=` | search results + facets |
| `GET /v1/workspaces/{id}/catalog/manifest` | counts, adoption KPIs, orphans, dangling refs, staleness |
| `GET /v1/workspaces/{id}/catalog/entries/{entryId}` | one entry + upstream/downstream neighbors |
| `GET /v1/workspaces/{id}/catalog/lineage` | full node+edge graph |

A disabled workspace returns `{ "enabled": false }` — it never errors.

## Agent tools (authoring agent)

The authoring agent has two always-on, read-only tools. **Use them before building or
querying** in a workspace, to ground on real data:

- **`catalog_search`** `{ query?, kind?, domain?, status?, tag? }` — find entries; returns
  `fqn`, `connection`, `status`, tags, lineage refs.
- **`catalog_get`** `{ id }` — full entry (prose + metadata) plus complete upstream and
  downstream lineage.

Both return `{ enabled: false }` when the workspace has no catalog — treat the catalog as a
hint, not a gate. Prefer `status: certified` entries; warn the user before building on
`status: deprecated`; respect `PII.*` tags.

## The Catalog lens (humans)

Left-nav **Catalog** → a read-only browse page (`/app/catalog?workspace_id={id}`), built for
large workspaces (1,600+ entries):

- **List** — KPI strip (entries, events, % certified, % documented, orphans), instant search,
  kind/domain/status facet chips, and a **sortable dense table** (name, kind, domain, status,
  origin, lineage counts). Click a column header to sort.
- **Detail** — metadata grid, the notes body, and **navigable lineage tables** for upstream and
  downstream neighbors. Click any catalogued neighbor to jump to its entry; uncatalogued refs
  show as dashed placeholders so gaps are obvious.

### Deep links

Bookmark or share a catalog view from Home:

| Hash | Opens |
| --- | --- |
| `#l/catalog` | Catalog list |
| `#l/catalog/{entryId}` | A specific entry |

## Related

- Connectors are the external half of the catalog — see [workspace-connections.md](workspace-connections.md).
- Data provenance (viewer-facing "where does this come from") — see [../patterns/data-provenance.md](../patterns/data-provenance.md).
- Reusable markdown playbooks (different thing) — see [skill-marketplace.md](skill-marketplace.md).
