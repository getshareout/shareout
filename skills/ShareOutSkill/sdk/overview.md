# SDK Overview

ShareOut SDK for browser artifacts.

## Installation

```html
<script src="$ORIGIN/sdk/shareout.js"></script>
<script>
(async () => {
  const sdk = await ShareOut.create();
})();
</script>
```

**Rules:**
- Load SDK before calling `ShareOut.create()` (or `new ShareOut()` for simple local-only scripts)
- Use `$ORIGIN/sdk/shareout.js` (not jsdelivr) — or relative `/sdk/shareout.js` inside published artifacts (content host serves the same bundle)
- **Live workspace data (Mixpanel, BigQuery, REST connections):** read [live-data.md](live-data.md) — two-origin sandbox (`$ORIGIN_HOST` shell + `<hex>.shareoutcdn.site` iframe), no raw `fetch`
- Debug `ShareOut is not defined` → check script URL and order

## Initialization

```typescript
interface ShareOutOptions {
  artifactId?: string;   // Auto-detected from URL path
  baseUrl?: string;      // Auto-detected from origin
  sessionToken?: string; // For protected artifacts
  mock?: boolean;        // Force mock mode
}

// Preferred for published HTML (lazy sessionToken on first data read):
const sdk = await ShareOut.create(options);

// Sync constructor — OK for mock/local; racey for live data in iframe:
const sdk = new ShareOut(options);
```

**Auto-detection:**
- `artifactId`: First path segment from URL (CDN hostname fallback when init is late)
- `baseUrl`: Script src origin or window origin

**Sandbox note:** Published artifacts run in a sandboxed iframe. The parent frame streams `shareout:init` with a short-lived Bearer token and optional seeded json/tables. `ShareOut.create()` resolves immediately; the first store read awaits init via `ensureEmbeddedInit()` so seeded data and auth apply before network fetches. Static artifacts that never read data never wait. See [live-data.md](live-data.md).

## Manifest declaration

Every store you use must be declared in a manifest `<script>` in your HTML `<head>`. The wrapper is always the same — `version` plus a `sources` object keyed by store type:

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    // store-specific entries: json, tables, realtime, blobs, …
  }
}
</script>
```

Each store doc below shows the entries for its own key. Full spec: [core/html-spec/manifest.md](../core/html-spec/manifest.md).

## Readiness & loading

The viewer shows a branded **loading skeleton** while your artifact boots — automatically, no code. The SDK posts `shareout:content-ready` once your data calls settle, and the viewer removes the skeleton then.

```javascript
const sdk = await ShareOut.create();
renderEverything(await sdk.json.get('snapshot'));
ShareOut.ready(); // optional: hide the skeleton the instant the page is painted
```

- `ShareOut.ready()` is optional — without it the SDK auto-detects readiness (network goes idle). Call it for a crisp hand-off, especially on chart-heavy pages.
- Keep first paint fast: read first-paint data from `sdk.json`/`sdk.table()` (prefetched, zero round-trip) and keep live `connection.query()` off the load path. Full guidance: [../patterns/performance.md](../patterns/performance.md).

## Local Development

There is no mock/localStorage mode. Locally, artifacts talk to a real ShareOut backend — run the worker with `npm run dev` (see repo `CLAUDE.md`) and publish to it, or publish to your deployed $ORIGIN. Stores hit the network; there is no offline shim.

## Error Handling

```typescript
class ShareOutError extends Error {
  code: string;
  status: number;
}
```

```javascript
try {
  await sdk.json.get('key');
} catch (e) {
  if (e instanceof ShareOutError) {
    console.log(e.message, e.code, e.status);
  }
}
```

## SDK Methods

| Method | File | Purpose |
|--------|------|---------|
| `sdk.json` | [json.md](json.md) | Key-value storage (Tier 1) |
| `sdk.table(name)` | [table.md](table.md) | Structured records (Tier 2) |
| `sdk.grid(name)` | [grid.md](grid.md) | Editable spreadsheet grid (table or Sheets source) |
| `sdk.workspace.table(name)` | [team/workspace-tables.md](../team/workspace-tables.md) | Share a table across artifacts in a workspace (Teams) |
| `sdk.realtime(docId)` | [realtime.md](realtime.md) | Y.js collaboration (Tier 3) |
| `sdk.blobs` | [blobs.md](blobs.md) | Per-artifact file storage (direct-from-R2) |
| `sdk.files` | [files.md](files.md) | Workspace asset URLs (`dlv_*`, cross-artifact embed) |
| `sdk.dataset(name)` | [datasets.md](datasets.md) | Bulk read-only data extracts (direct-from-R2) |
| `sdk.connection(name)` | [connections.md](connections.md) | Query external sources + materialize extracts |
| `sdk.lib(name)` | [libraries.md](libraries.md) | Import a private versioned JS module (workspace library, Teams) |
| `sdk.sources` | [../patterns/data-provenance.md](../patterns/data-provenance.md) | Data-sources drawer + per-element provenance badges |
| Live data / BigQuery / Mixpanel in artifacts | [live-data.md](live-data.md) | **Required reading** — auth, anti-patterns, parsing |
| `sdk.email` | [email.md](email.md) | Outbound email |
| `sdk.comments` | [comments.md](comments.md) | Threaded comments |
| `sdk.python` | [python.md](python.md) | Run Python in the browser |
| `sdk.slides` | [../modules/slides/sdk-api.md](../modules/slides/sdk-api.md) | Presentations |
| `sdk.agent` | [../agents/overview.md](../agents/overview.md) | AI chat |

## Data Tiers

```
Tier 1: sdk.json     → Simple state (theme, prefs)
Tier 2: sdk.table()  → Structured records (tasks, entries)
Tier 3: sdk.realtime → Live collaboration (docs, whiteboards)
```

## Related

- [JSON Store](json.md) - Key-value storage
- [Tables](table.md) - Structured records
- [Realtime](realtime.md) - Y.js collaboration
