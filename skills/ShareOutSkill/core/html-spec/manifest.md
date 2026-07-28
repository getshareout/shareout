# ShareOut Manifest Structure

Every ShareOut artifact MUST include a manifest in `<head>` declaring all data sources.

## Schema

```typescript
interface ShareOutManifest {
  version: "2.0";
  sources?: {
    json?: Record<string, {
      default?: any;
      schema?: JSONSchema;
    }>;
    tables?: Record<string, {
      schema: TableColumn[];
      /** Who may insert/update/delete rows via the data API. Default `"any"`. */
      write?: 'owner' | 'collaborator' | 'any';
    }>;
    blobs?: string[];
    realtime?: string[];
    connections?: Record<string, {
      default?: Record<string, unknown>[];
    }>;
  };
  computed?: Record<string, {
    formula: string;
    display?: string;
  }>;
  formatters?: Record<string, {
    locale?: string;
    currency?: string;
    decimals?: number;
  }>;
  // Maps a UI element (chart/table) to the source that feeds it.
  feeds?: Array<{ element: string; source: string; note?: string }>;
}

// Optional provenance any json/table/connection source can carry. Powers the
// SDK "Data sources" drawer + per-element badges. See Provenance section below.
interface SourceProvenance {
  label?: string;
  description?: string;
  query?: string;            // exact SQL / API call / build step
  tables?: string[];         // underlying source tables
  refresh?: string;          // "daily 12:00 UTC" | "manual" | "live"
  as_of?: string;            // date/time the snapshot reflects
  replication?: { build?: string; publish?: string; credentials?: string; notes?: string };
}

interface TableColumn {
  name: string;
  type: "string" | "number" | "boolean" | "date";
  primary?: boolean;
}
```

## Full Example

```html
<head>
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
        },
        "filters": {
          "default": { "dateRange": "30d", "category": "all" }
        }
      },
      "tables": {
        "tasks": {
          "schema": [
            { "name": "id", "type": "string", "primary": true },
            { "name": "title", "type": "string" },
            { "name": "description", "type": "string" },
            { "name": "done", "type": "boolean" },
            { "name": "dueDate", "type": "date" },
            { "name": "priority", "type": "number" }
          ]
        },
        "users": {
          "schema": [
            { "name": "id", "type": "string", "primary": true },
            { "name": "name", "type": "string" },
            { "name": "email", "type": "string" },
            { "name": "role", "type": "string" }
          ]
        }
      },
      "blobs": ["logo.png", "background.jpg"],
      "realtime": ["board-sync", "cursors"]
    },
    "computed": {
      "completedCount": {
        "formula": "count(tasks:done=true)",
        "display": "Completed Tasks"
      },
      "totalRevenue": {
        "formula": "sum(orders:amount)",
        "display": "Total Revenue"
      },
      "avgOrderValue": {
        "formula": "avg(orders:amount)",
        "display": "Average Order"
      }
    },
    "formatters": {
      "currency": { "locale": "en-US", "currency": "USD" },
      "percent": { "decimals": 1 },
      "number": { "locale": "en-US" }
    }
  }
  </script>
  <script src="$ORIGIN/sdk/shareout.js"></script>
</head>
```

## Manifest Rules

1. **MUST** be first script in `<head>` (before SDK)
2. **MUST** declare ALL `sdk.json` keys used in artifact
3. **MUST** declare ALL `sdk.table()` names used in artifact
4. **MUST** include `version: "2.0"`
5. **SHOULD** include default values for mock/preview mode

## Sources Reference

### JSON Sources

Key-value storage for settings, state, and simple data:

```json
"json": {
  "settings": {
    "default": { "theme": "light" }
  }
}
```

### Table Sources

Structured records with schema:

```json
"tables": {
  "tasks": {
    "schema": [
      { "name": "id", "type": "string", "primary": true },
      { "name": "title", "type": "string" },
      { "name": "done", "type": "boolean" }
    ]
  }
}
```

**Write roles** (`write`, optional) — server-enforced on every row mutation. Default `"any"` (anyone who can open the artifact's data API). Use this for multi-role apps (approval rooms, shared forms):

| Value | Who can insert / update / delete rows |
|-------|----------------------------------------|
| `"any"` (default) | Owner, editors, viewers, and (when opted in) anonymous public writers |
| `"collaborator"` | Artifact owner + editor collaborators only |
| `"owner"` | Artifact owner only |

Viewers who POST/PATCH/DELETE against a restricted table get `403 TABLE_WRITE_FORBIDDEN`. Reads (`query` / `count` / `GET`) are never gated by `write`.

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

### Blob Sources

File references:

```json
"blobs": ["logo.png", "document.pdf"]
```

### Realtime Sources

Y.js document identifiers:

```json
"realtime": ["board-sync", "cursors"]
```

### Connection Sources

Workspace connection names used with `sdk.connection()`. Each connection may include a `default` array of sample rows. The visual editor resolves `sdk.connection(...).query()` from these defaults — **no live warehouse or API query** — so data-gated artifacts still render and stay editable in the studio.

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

## Provenance (where the data comes from)

Any `json`, `table`, or `connection` source can carry the optional
`SourceProvenance` fields shown in the Schema above (`label`, `description`,
`query`, `tables`, `refresh`, `as_of`, `replication`) so viewers can answer "where
does this data come from?" Link each chart/table to its source via a
`data-shareout-source="connection:NAME"` attribute or a `feeds` entry, then render
the SDK drawer + badges with `so.sources.mount()` (or `<body data-shareout-sources>`).
Strongly recommended for any data-backed artifact; fully optional and
backward-compatible.

Full data-provenance patterns: [patterns/data-provenance.md](../../patterns/data-provenance.md).

## Computed Values

Derived values calculated from sources:

```json
"computed": {
  "completedCount": {
    "formula": "count(tasks:done=true)",
    "display": "Completed Tasks"
  }
}
```

### Formulas

| Formula | Example | Description |
|---------|---------|-------------|
| `count(table:field)` | `count(tasks:id)` | Count all rows |
| `count(table:field:filter)` | `count(tasks:id:done=true)` | Count filtered |
| `sum(table:field)` | `sum(orders:amount)` | Sum numeric field |
| `avg(table:field)` | `avg(orders:amount)` | Average |
| `min(table:field)` | `min(products:price)` | Minimum |
| `max(table:field)` | `max(products:price)` | Maximum |

## Formatters

Reusable format definitions:

```json
"formatters": {
  "currency": { "locale": "en-US", "currency": "USD" },
  "percent": { "decimals": 1 },
  "number": { "locale": "en-US" }
}
```

## Validation Checklist

Full compliance checklist: [overview.md](overview.md#compliance-checklist). Manifest-specific checks:

- [ ] Manifest has `"version": "2.0"`
- [ ] All `sdk.json.get('KEY')` calls have corresponding `sources.json.KEY`
- [ ] All `sdk.json.set('KEY', ...)` calls have corresponding `sources.json.KEY`
- [ ] All table schemas include primary key field
- [ ] All `sdk.blobs` usage reflected in `sources.blobs`
- [ ] All `sdk.realtime('DOC')` calls have corresponding `sources.realtime`
- [ ] All `sdk.connection('NAME')` calls have corresponding `sources.connections.NAME` (with `default` rows for editor preview)

## Related

- [Overview](overview.md) - Quick reference
- [Bindings](bindings.md) - Using manifest sources in bindings
