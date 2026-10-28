# Data Catalog

The **Data Catalog** is an optional, per-workspace map of a workspace's data — its
**sources, datasets, pipelines, dashboards, models, metrics and business terms** — written
as flat markdown + YAML files and kept up to date mostly by agents. Humans browse and
search it; the authoring AI agent consults it to ground on real table names, pick
**certified** data (an owner or admin vouched for that exact version), and avoid
**deprecated** sources.

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
status: deprecated        # optional: draft | deprecated. `certified` here is ignored — see Certification
owner: data-platform
tags: [tier.silver, PII.None, domain.chat]   # dotted/tiered classification
terms: [active-user]      # glossary links
upstream: [warehouse.clustered_events]          # lineage: what it reads
downstream: [pipelines.engagement_metrics]          # lineage: what depends on it
aspects: [quality]        # reusable metadata blocks
last_updated: 2026-06-30
aliases: [events.chat_sent]   # old ids this entry still answers to (links + lineage resolve)
# --- where the data lives (pick the plane) ---
connection: snowflake-prod                    # EXTERNAL: a workspace connector (by name)
connection_id: conn_7f2a…                     # EXTERNAL: the connector's id (stable across renames)
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

## Certification (owners and admins)

**Certified** is a decision, not a field. A workspace **owner or admin**, signed in to
ShareOut, certifies one exact version of an entry in the Catalog lens; writing
`status: certified` in a file certifies nothing (it reads as `draft`). Decisions are
append-only — the history answers "who certified this number, and when".

**You (an agent) cannot certify.** The endpoint takes only a signed-in browser session:
any token — personal, Agent or MCP — gets `403 SESSION_REQUIRED` with a hint to certify in
ShareOut. Draft and propose instead, then ask an owner or admin to review the entry in the
Catalog. For reference, the lens sends:

```
POST /v1/workspaces/{id}/catalog/entries/{entryId}/certify     (signed-in session only)
{ "decision": "certified", "note": "Matches the ads platform for March", "content_hash": "<from GET>" }
```

- `decision`: `certified` · `revoked` (back to draft) · `deprecated` (sticks across edits).
- `note`: optional, up to 1,000 characters.
- `content_hash`: optional but recommended — the `certification.content_hash` you reviewed.
  If the entry changed since, the call fails with **409 `CONFLICT`** instead of certifying
  a version nobody looked at.
- Members get **403**; tokens get **403 `SESSION_REQUIRED`**: agents and members draft and
  propose, owners/admins certify in person.

**Edits.** A certification is pinned to the version it was made on. Edit a certified entry
and it reads **draft** with `certification.stale: true` ("changed since certification")
until an owner/admin certifies the new version. For `kind: metric` the pin covers only the
spec (id, titles, source, type, measure/numerator/denominator, time, dimensions, filters,
format, scope field, freshness SLA) — fixing the description, synonyms, examples, owner or
notes keeps it certified. Every other kind is pinned to the whole file.

Every read carries the overlay: `entry.status` is the **effective** status, and
`entry.certification` is `{ status, declared_status, content_hash, stale, decision }`, where
`decision` is the record that explains it (`decision`, `note`, `decided_by: { id, name,
email }`, `decided_at`). `GET …/entries/{entryId}` adds `history` (newest first; `current`
marks decisions made on the current version).

## Executable metrics

A `kind: metric` entry whose frontmatter is a **spec** can be run: ShareOut compiles it to
SQL for its source and returns the numbers with their provenance (who certified the metric,
which spec version, where the rows came from, how fresh they are). The spec is validated on
write — `PUT …/catalog/files` answers `400 INVALID_METRIC_SPEC` with the offending `param`,
and a mistyped key gets a "did you mean". A metric without `source` and `type` stays
descriptive.

```markdown
---
kind: metric
id: metric.roas
title: ROAS
title_es: Retorno de la inversión publicitaria
owner: ana@agencia.example
synonyms: { es: [retorno publicitario], en: [return on ad spend] }
description: { es: Ingresos atribuidos ÷ inversión, en: Attributed revenue ÷ ad spend }
source: { connection: conn_7f2a…, fqn: analytics.ads_daily }   # or sql: "SELECT …" | shared_table: ads_daily
type: ratio                                    # simple (measure) | ratio (numerator ÷ denominator)
numerator: { agg: sum, expr: revenue }         # agg: sum | count | count_distinct | avg | min | max
denominator: { agg: sum, expr: spend }
time: { dimension: date, grains: [day, week, month] }   # also quarter, year
dimensions: [{ name: cliente, column: client_id }, { name: canal, column: channel }]
filters: ["status = 'active'"]
format: { kind: ratio, decimals: 2, suffix: "x" }   # number | ratio | percent | currency (+ currency: ARS)
scope_field: client_id
freshness_sla: 26h                             # 90m, 26h, 2d, 1w
examples: [{ es: "ROAS de marzo por canal", query: { grain: month, by: [canal], from: 2026-03-01, to: 2026-03-31 } }]
---
```

- **Sources.** `source.connection` is a connection **id** (`GET /v1/workspaces/{id}/connections`)
  plus `fqn` (a table) or `sql` (one read-only SELECT). Metrics run on BigQuery, Snowflake and
  the Postgres family (Supabase, Redshift, Aurora PostgreSQL). `source.shared_table` names a
  workspace **shared table** — the path for Meta/Google Ads, Analytics, Tiendanube or Sheets
  data: refresh it into a shared table (materialize / query snapshot job, or a crew), then
  define metrics on it. Shared-table columns are the row keys and may carry accents and spaces.
- **Columns** (`expr`, `column`, `time.dimension`, `scope_field`) are plain column names;
  compute anything else in `source.sql`. `expr: "*"` with `agg: count` counts rows.
- **Filters** are fixed conditions, one per item: no comments, `;` or backslashes; on a shared
  table they can only compare the table's own columns.
- **Ratios** are `SUM(n) / NULLIF(SUM(d), 0)` — a zero denominator answers `null`.
- **Certification** pins the spec (id, titles, source, type, measures, time, dimensions,
  filters, format, scope_field, freshness_sla); description, synonyms, examples, owner and
  notes are prose and editing them keeps it certified.

### Running a metric

| Method & path | Who | Returns |
| --- | --- | --- |
| `GET /v1/workspaces/{id}/catalog/metrics` | Member+ | every metric: `status`, `certified_by`, `formula` ("Σ revenue ÷ Σ spend"), `source`, `grains`, `dimensions`, `freshness_sla`, `problem`, `can_run` |
| `GET /v1/workspaces/{id}/catalog/metrics/{metricId}` | Member+ | one metric, plus description, synonyms, measures, examples and live `freshness` |
| `POST /v1/workspaces/{id}/catalog/metrics/{metricId}/query` | see below | rows for `{ grain?, by?, from?, to?, where? }` |
| `GET /v1/workspaces/{id}/catalog/metrics/{metricId}/explain?grain=&by=&from=&to=` | Member+ | formula and resolved query; the compiled SQL for owners/admins |

**Query.** `grain` is one of the metric's grains (default: the first); `by` lists dimension
names; `from`/`to` are dates (default: a window ending today — 30 days, 12 weeks, 12 months,
8 quarters or 5 years); `where` is `{ dimension: [values] }`. Only names from the spec are
accepted, and values become escaped literals. At most 1,000 rows (`truncated: true` past
that) and 30 seconds.

**Answer.** `{ metric, status, certified_by, certified_at, spec_hash, query, rows, truncated,
format, computed_at, source, freshness, scope }`, plus `sql` for owners/admins. Rows are
`{ period?, <dimension>: value, value, numerator?, denominator? }`. When you report a number,
say whether it is certified and by whom; flag a draft.

**Who can run it.** Any internal member runs a **certified** metric — an owner/admin
certification is consent for its connection, even with agent queries off. A draft runs for
owners/admins and its author, and for anyone when its data is already open to members (a
connection with agent queries on, or a shared table); otherwise `403 METRIC_NOT_CERTIFIED`.
On a private connection only its creator can run their own draft.
Runs count against the workspace data-query limit (`429 RATE_LIMITED`). A metric that cannot
run says why: `problem` in listings, `422 METRIC_UNAVAILABLE` / `METRIC_INVALID` on a run.

**Scope.** A metric with `scope_field` can answer a viewer limited to some values of that
column: the restriction applies to rows before they are aggregated. A metric without one
refuses a scoped viewer (`403 SCOPE_REQUIRED`) rather than answer with every row. Internal
members are not scoped.

## Auto-seed

`POST /v1/workspaces/{id}/catalog/seed` creates a `kind: source` entry for every workspace
connector, so the catalog starts half-populated. Re-seeding is idempotent and **never
overwrites a file a human/agent edited** (those are marked `source: manual`).

Seeded source entries are keyed by the **connection id** — id `conn.<connectionId>`, file
`sources/<connectionId>.md` — so renaming a connector never breaks a link. Entries seeded
before that were keyed by the name's slug (`conn.<slug>`); that id stays on the entry as an
alias, so lineage written against it still resolves.

When the catalog is already enabled, **new connectors auto-seed on create** — the new
connection (only that one) becomes a `source` entry, plus `dataset` entries for its
tables/sheets where the provider lists them cheaply, without a manual seed click. Deleting
a connection removes its auto-seeded `source` and `dataset` entries; entries a human/agent
edited (`source: manual`) and dataset provenance records stay. Dataset writes
(materialize jobs, table/json updates) can also append **lineage edges** to catalog
entries when the catalog is enabled.

## Growing the catalog (agents)

Agents grow the catalog like a wiki — upsert a file (each write records who made it, and
whether it came from a person or an agent token):

```
PUT /v1/workspaces/{id}/catalog/files
{ "path": "sources/orders.md", "content": "---\nkind: source\nid: ...\n---\n..." }

DELETE /v1/workspaces/{id}/catalog/files?path=sources/orders.md
```

`path` is a relative `.md` path such as `sources/orders.md`: letters, digits, `.`, `_` and
`-`, each name starting with a letter or digit, no `..`, at most 4 levels and 200
characters (`400 INVALID_PATH` otherwise). `content` is at most 128 KB (`413
FILE_TOO_LARGE`). `DELETE` accepts any stored path.

To change a few fields of an existing entry, prefer `PATCH` over rewriting the file — it keeps
every other frontmatter key and works by id or alias:

```
PATCH /v1/workspaces/{id}/catalog/entries/{entryId}
{ "aliases": ["orders", "pedidos"], "body": "One row per confirmed order." }
```

Editable: `title`, `domain`, `owner`, `tags`, `aliases`, `terms`, `body`. Send only what
changes; lists and `body` replace the current value, an empty `domain`/`owner`/list removes
it. `id`, `kind` and `status` are refused (`400 INVALID_EDIT`, `param` names the field) —
status moves only through certification. Editing a certified entry marks it changed since
certification.

## Reading the catalog

REST (auth = workspace member or agent token):

| Method & path | Returns |
| --- | --- |
| `GET /v1/workspaces/{id}/catalog?q=&kind=&domain=&status=&tag=` | search results + facets (`status` = effective) |
| `GET /v1/workspaces/{id}/catalog/manifest` | counts, adoption KPIs, orphans, dangling refs, staleness |
| `GET /v1/workspaces/{id}/catalog/entries/{entryId}` | one entry + upstream/downstream neighbors + certification `history` |
| `GET /v1/workspaces/{id}/catalog/lineage` | full node+edge graph |
| `POST /v1/workspaces/{id}/catalog/entries/{entryId}/certify` | owner/admin decision, signed-in session only (see Certification) |

A disabled workspace returns `{ "enabled": false }` — it never errors. Lineage is read from
both ends: an entry's `upstream`/`downstream` in the API include edges declared on either
side, refs to an alias resolve to the entry that keeps it, and an entry only others point
at is not an orphan. `GET …/entries/{entryId}` also accepts an alias.

## Agent tools (authoring agent)

The authoring agent has two always-on, read-only tools. **Use them before building or
querying** in a workspace, to ground on real data:

- **`catalog_search`** `{ query?, kind?, domain?, status?, tag? }` — find entries; returns
  `fqn`, `connection`, effective `status` (with `certified_by` / `certified_at` when
  certified, `changed_since_certification` after an edit), tags, lineage refs.
- **`catalog_get`** `{ id }` — full entry (prose + metadata, plus the certifier's note)
  and complete upstream and downstream lineage.

Both return `{ enabled: false }` when the workspace has no catalog — treat the catalog as a
hint, not a gate. Prefer `status: certified` entries and say who certified them when you
cite a number; warn the user before building on `status: deprecated` or an entry that
`changed_since_certification`; respect `PII.*` tags.

## The Catalog lens (humans)

Left-nav **Catalog** → a browse page (`/app/catalog?workspace_id={id}`), built for
large workspaces (1,600+ entries):

- **List** — KPI strip (entries, events, % certified, % documented, orphans), instant search,
  kind/domain/status facet chips, and a **sortable dense table** (name, kind, domain, status,
  origin, lineage counts). Click a column header to sort. A **changed** marker flags entries
  edited since their certification.
- **Metrics** — the metric segment lists metrics with their status, owner, source and freshness.
  A metric's entry shows its formula, periods and dimensions and a **Try it** panel (period,
  dates, break-down) that runs it, with numbers in the reader's language (`2,50x`, `$ 1.520,50`).
- **Detail** — status badge, a **certification panel** (who certified it and when, their note,
  the history), metadata grid, the notes body, and **navigable lineage tables** for upstream and
  downstream neighbors. Owners/admins get **Certify entry / Revoke certification / Mark
  deprecated** with an optional note. Click any catalogued neighbor to jump to its entry;
  uncatalogued refs show as dashed placeholders so gaps are obvious.

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
