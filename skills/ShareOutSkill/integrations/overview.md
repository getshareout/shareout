# Integrations Overview

External service connections via Data Platform and **Teams workspace connectors**.

> **Workspace connectors:** Reusable shared or **per-user** credentials are documented in [../team/workspace-connections.md](../team/workspace-connections.md). Use per-user when each member brings their own API token (e.g. GraphQL backends).

## Available Integrations

| Provider | File | Description |
|----------|------|-------------|
| Google Sheets | [google-sheets.md](google-sheets.md) | OAuth + spreadsheet data |
| Google Analytics | [google-analytics.md](google-analytics.md) | GA4 reports and metrics |
| Google Ads | [google-ads.md](google-ads.md) | Campaign spend/clicks via pasted OAuth credentials |
| Facebook Ads | [facebook-ads.md](facebook-ads.md) | Meta Marketing API via pasted access token |
| Shopify | [shopify.md](shopify.md) | Products, orders, inventory |
| Tienda Nube | [tiendanube.md](tiendanube.md) | LATAM e-commerce |
| GitHub | [github.md](github.md) | Backup and export |
| CORS Proxy | [cors-proxy.md](cors-proxy.md) | External API access |

## Connection Pattern

> **Browser artifacts:** There is no `sdk.platform` in the shipped SDK bundle. To query
> platform connections (BigQuery, GA, Shopify, …) from published HTML, use
> `sdk._internalFetch('/platform/…')` as documented in [../sdk/live-data.md](../sdk/live-data.md).
> The patterns below apply to **owner setup** (REST admin / future platform store), not
> artifact runtime.

All integrations follow the same pattern:

```javascript
const sdk = await ShareOut.create();

// Artifact runtime — list + execute (owner session required):
const { connections } = await sdk._internalFetch('/platform/connections');
const result = await sdk._internalFetch('/platform/bigquery/jobs.query/execute', {
  method: 'POST',
  body: JSON.stringify({ connectionId, params: { /* provider-specific */ } }),
});
```

For OAuth setup and workspace admin APIs, see each provider doc and [../api/overview.md](../api/overview.md).

<!-- Legacy / planned platform store API (not in browser bundle today):
```javascript
await sdk.platform.connect('provider-name', { ... });
const { data } = await sdk.platform.execute('provider-name', 'endpoint', { ... });
```
-->

## Execution Modes

| Mode | Token Exposure | Use Case |
|------|----------------|----------|
| `proxy` (default) | None | Most secure |
| `direct` | Short-lived token | Performance-critical |
| `auto` | Context-based | Default behavior |

## Caching

- **Two-layer cache:** Memory + persisted (artifact_json)
- **Manual refresh:** `await sdk.platform.refreshCache({ provider: 'name' })`

## Rate Limits

Each provider has specific limits. Check individual docs.

## Related

- [SKILL.md](../SKILL.md) - Use case mapping
- [SDK: Overview](../sdk/overview.md) - SDK intro
