---
title: Data sources (provenance)
description: SDK API for the "where does this data come from?" drawer and per-element badges.
---

Turns the artifact's `shareout/manifest` provenance into UI so viewers can answer
**where does this data come from?** without hand-rolling a drawer. Entirely
client-side — no network, no permissions.

See [Data provenance](/guides/data-provenance/) for the manifest pattern and
checklist.

## Setup

Declare provenance on your manifest sources, link elements with
`data-shareout-source` or manifest `feeds`, then mount:

```javascript
const sdk = await ShareOut.create();
const ctrl = sdk.sources.mount();
```

Zero-JS auto-mount:

```html
<body data-shareout-sources>
```

## Methods

```typescript
list(): SourceEntry[]
get(ref: string): SourceEntry | null
feeds(): SourceFeed[]
mount(opts?: MountSourcesOptions): SourcesController
open(ref?: string): void
close(): void
```

### `mount(options?)`

Renders the floating toggle button, slide-out drawer, and per-element badges.
Returns `{ open(ref?), close(), destroy() }`.

| Option | Default | Purpose |
| --- | --- | --- |
| `title` | `"Data sources"` | Drawer heading |
| `side` | `'right'` | Floating button side (`'left'` \| `'right'`) |
| `badges` | `true` | Per-element "where from?" badges |
| `button` | `true` | Floating toggle button |
| `buttonLabel` | `"Data sources"` | Button label |

Theme via CSS variables: `--so-src-accent`, `--so-src-bg`, `--so-src-ink`,
`--so-src-card`.

### Types

```typescript
interface SourceEntry {
  ref: string;           // "connection:warehouse", "json:revenue", "table:rooms"
  kind: 'connection' | 'json' | 'table';
  key: string;
  label?: string;
  description?: string;
  query?: string;
  tables?: string[];
  refresh?: string;
  asOf?: string;
  replication?: {
    build?: string;
    publish?: string;
    credentials?: string;
    notes?: string;
  };
}

interface SourceFeed {
  element: string;
  source: string;
  note?: string;
}
```

## Examples

```javascript
const sdk = await ShareOut.create();

// List everything declared in the manifest
const sources = sdk.sources.list();
const warehouse = sdk.sources.get('connection:warehouse');

// Mount UI
const ctrl = sdk.sources.mount({ side: 'left', title: 'Where this comes from' });
ctrl.open('connection:warehouse'); // open drawer at a specific source
```

## Manifest

Provenance lives on each source entry plus optional top-level `feeds`:

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "connections": {
      "warehouse": {
        "description": "90-day activity rollup",
        "query": "SELECT …",
        "tables": ["METRICS.FCT_ACTIVITY"],
        "refresh": "daily 12:00 UTC",
        "default": []
      }
    }
  },
  "feeds": [
    { "element": "#chart", "source": "connection:warehouse" }
  ]
}
</script>
```

See [Manifest → Provenance](/spec/manifest/#provenance).
