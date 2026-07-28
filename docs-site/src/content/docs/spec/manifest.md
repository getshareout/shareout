---
title: Manifest
description: The shareout/manifest script block — declaring data sources, computed values, and formatters.
---

Every artifact must include a `<script type="shareout/manifest">` block inside `<head>`,
before the SDK script tag. It declares every data source the artifact uses.

## Placement

```html
<head>
  <script type="shareout/manifest">
  { ... }
  </script>
  <script src="https://shareout.site/sdk/shareout.js"></script>
</head>
```

The manifest must come **before** the SDK script.

## Schema

```typescript
interface ShareOutManifest {
  version: "2.0";
  sources?: {
    json?: Record<string, SourceWithProvenance>;
    tables?: Record<string, { schema: TableColumn[]; default?: Record<string, unknown>[] } & SourceProvenance>;
    connections?: Record<string, { default?: unknown[] } & SourceProvenance>;
    blobs?: string[];
    realtime?: string[];
  };
  feeds?: Array<{ element: string; source: string; note?: string }>;
  computed?: Record<string, { formula: string; display?: string }>;
  formatters?: Record<string, { locale?: string; currency?: string; decimals?: number }>;
}

interface SourceProvenance {
  label?: string;
  description?: string;
  query?: string;
  tables?: string[];
  refresh?: string;
  as_of?: string;
  replication?: { build?: string; publish?: string; credentials?: string; notes?: string };
}

type SourceWithProvenance = { default?: any } & SourceProvenance;

interface TableColumn {
  name: string;
  type: "string" | "number" | "boolean" | "date";
  primary?: boolean;
}
```

## Full example

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "json": {
      "settings": {
        "default": { "theme": "light", "language": "en" }
      },
      "metrics": {
        "default": { "revenue": 0, "users": 0, "conversion": 0 }
      }
    },
    "tables": {
      "tasks": {
        "schema": [
          { "name": "id",       "type": "string",  "primary": true },
          { "name": "title",    "type": "string" },
          { "name": "done",     "type": "boolean" },
          { "name": "dueDate",  "type": "date" },
          { "name": "priority", "type": "number" }
        ]
      }
    },
    "blobs": ["logo.png"],
    "realtime": ["board-sync"]
  },
  "computed": {
    "completedCount": {
      "formula": "count(tasks:done=true)",
      "display": "Completed Tasks"
    }
  },
  "formatters": {
    "currency": { "locale": "en-US", "currency": "USD" },
    "percent":  { "decimals": 1 }
  }
}
</script>
```

## Sources

### `sources.json`

Declares keys used with `sdk.json`. Each key may include a `default` value used for
mock/preview rendering in the editor.

```json
"json": {
  "settings": { "default": { "theme": "light" } },
  "counter":  { "default": 0 }
}
```

Every key passed to `sdk.json.get()`, `sdk.json.set()`, or `sdk.json.update()` must have
a corresponding entry here.

### `sources.tables`

Declares table names used with `sdk.table()`. Each table requires a `schema` array. Every
table must have exactly one column with `"primary": true`.

```json
"tables": {
  "tasks": {
    "schema": [
      { "name": "id",    "type": "string", "primary": true },
      { "name": "title", "type": "string" },
      { "name": "done",  "type": "boolean" }
    ]
  }
}
```

Column types: `"string"` | `"number"` | `"boolean"` | `"date"`.

Optional `default` rows let the visual editor preview the table without a live fetch.

**Write roles** (`write`, optional) — server-enforced on every row mutation (`insert`,
`update`, `delete`). Default `"any"` (anyone who can reach the artifact's data API).
Reads are never gated.

| Value | Who can mutate rows |
| --- | --- |
| `"any"` (default) | Owner, editors, viewers, and (when opted in) anonymous public writers |
| `"collaborator"` | Artifact owner + editor collaborators only |
| `"owner"` | Artifact owner only |

Viewers who mutate a restricted table get `403 TABLE_WRITE_FORBIDDEN`.

```json
"tables": {
  "approvals": {
    "write": "owner",
    "schema": [
      { "name": "id", "type": "string", "primary": true },
      { "name": "status", "type": "string" }
    ]
  }
}
```

### `sources.connections`

Declares workspace connection names used with `sdk.connection()`. Each connection may
include a `default` array of sample rows. The visual editor resolves
`sdk.connection(...).query()` from these defaults — **no live warehouse or API query** —
so data-gated artifacts still render and stay editable in the studio.

```json
"connections": {
  "team_bigquery": {
    "default": [
      { "region": "West", "revenue": 125000 },
      { "region": "East", "revenue": 98000 }
    ]
  }
}
```

### `sources.blobs`

Array of blob filenames used with `sdk.blobs`.

```json
"blobs": ["logo.png", "document.pdf"]
```

### `sources.realtime`

Array of Y.js document identifiers used with `sdk.realtime()`.

```json
"realtime": ["board-sync", "cursors"]
```

## Provenance

Optional metadata on any `json`, `table`, or `connection` source so viewers can
trace where data comes from. Powers the SDK [Data sources drawer](/sdk/sources/)
and publish-time `editor_readiness` provenance warnings.

| Field | Purpose |
| --- | --- |
| `label` | Human name for the dataset |
| `description` | One-line summary |
| `query` | SQL, API call, or build step that produced the data |
| `tables` | Underlying warehouse or source tables |
| `refresh` | Cadence (`daily 12:00 UTC`, `manual`, `live`) |
| `as_of` | Date or time the snapshot reflects |
| `replication` | `{ build, publish, credentials, notes }` — how to rebuild |

Link each chart or table to its source:

```html
<div id="chart" data-shareout-source="connection:warehouse"></div>
```

Or declare mappings at the manifest root:

```json
"feeds": [
  { "element": "#chart", "source": "connection:warehouse", "note": "90-day rollup" }
]
```

`source` is a `kind:key` ref (`connection:warehouse`, `json:revenue`,
`table:rooms`). See [Data provenance](/guides/data-provenance/) for the full
pattern.

## Computed values

Derived values calculated from declared sources. Referenced in bindings as
`computed:NAME`.

```json
"computed": {
  "completedCount": {
    "formula": "count(tasks:done=true)",
    "display": "Completed Tasks"
  }
}
```

Supported formula functions:

| Formula | Example | Description |
|---------|---------|-------------|
| `count(table:field)` | `count(tasks:id)` | Count all rows |
| `count(table:field:filter)` | `count(tasks:id:done=true)` | Count filtered rows |
| `sum(table:field)` | `sum(orders:amount)` | Sum a numeric field |
| `avg(table:field)` | `avg(orders:amount)` | Average a numeric field |
| `min(table:field)` | `min(products:price)` | Minimum value |
| `max(table:field)` | `max(products:price)` | Maximum value |

## Formatters

Named format definitions reusable across binding `data-shareout-format` attributes.

```json
"formatters": {
  "currency": { "locale": "en-US", "currency": "USD" },
  "percent":  { "decimals": 1 },
  "number":   { "locale": "en-US" }
}
```

## Manifest rules

1. Must be first script in `<head>`, before the SDK script tag.
2. Must include `"version": "2.0"`.
3. Must declare every `sdk.json` key used in the artifact.
4. Must declare every `sdk.table()` name used in the artifact.
5. Every table schema must include a primary key column.
6. Include `default` values on json, tables, and connections so the editor can render offline previews.

## Related

- [Overview](/spec/overview/) — compliance checklist and attribute reference
- [Bindings](/spec/bindings/) — using manifest sources in binding expressions
- [JSON store](/sdk/json/) — `sdk.json` API
- [Tables](/sdk/tables/) — `sdk.table()` API
- [Data provenance](/guides/data-provenance/) — manifest fields + viewer drawer
- [Sources SDK](/sdk/sources/) — `sdk.sources` API
