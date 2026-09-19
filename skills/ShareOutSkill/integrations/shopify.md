# Integration: Shopify

Products, orders, customers, and inventory via the Data Platform. There is no bespoke
`sdk.shopify.*` API — Shopify is a generic platform provider, queried through
`sdk.platform` like BigQuery or Snowflake.

## Quick Start

The connection itself is set up once, out of artifact runtime — in workspace admin's
**Connectors** lens (BYO shop domain + Admin API access token), or via the admin API
with `kind: "platform"`, `provider: "shopify"`. See
[../team/workspace-connections.md](../team/workspace-connections.md#platform-connectors-oauth--warehouses--byo-paste).
From the artifact, resolve the connection and execute an endpoint:

```javascript
const sdk = await ShareOut.create();

const connections = await sdk.platform.connections();
const shop = connections.find(c => c.provider === 'shopify');
if (!shop) throw new Error('No Shopify connection in this workspace.');

const result = await sdk.platform.provider('shopify').execute('products.list', {
  connectionId: shop.id,
  params: { queryParams: { limit: 50, status: 'active' } },
});
if (result.success === false || result.error) {
  throw new Error(result.error?.message || 'Shopify query failed');
}
const products = result.data.products; // raw Shopify REST shape
```

## Endpoints (`sdk.platform.provider('shopify').execute(endpointId, opts)`)

| Endpoint id | Method | Path | Description |
|---|---|---|---|
| `products.list` | GET | `/products.json` | List products (paginated) |
| `products.get` | GET | `/products/{id}.json` | Get one product |
| `products.count` | GET | `/products/count.json` | Product count |
| `products.create` | POST | `/products.json` | Create a product |
| `products.update` | PUT | `/products/{id}.json` | Update a product |
| `orders.list` | GET | `/orders.json` | List orders (paginated) |
| `orders.get` | GET | `/orders/{id}.json` | Get one order |
| `orders.count` | GET | `/orders/count.json` | Order count |
| `customers.list` | GET | `/customers.json` | List customers (paginated) |
| `customers.get` | GET | `/customers/{id}.json` | Get one customer |
| `customers.count` | GET | `/customers/count.json` | Customer count |
| `inventory.levels` | GET | `/inventory_levels.json` | Inventory levels (paginated) |
| `inventory.locations` | GET | `/locations.json` | List inventory locations |
| `collections.list` | GET | `/custom_collections.json` | List custom collections (paginated) |
| `smartCollections.list` | GET | `/smart_collections.json` | List smart collections (paginated) |
| `shop.get` | GET | `/shop.json` | Shop info |

Pass query-string params (e.g. `limit`, `status`, `ids`) via `params.queryParams`; path
params (e.g. `{id}`) via `params.pathParams`; POST/PUT bodies via `params.body`. This
hits the real Shopify Admin REST API (`2024-01`) — response shapes are Shopify's own,
not reshaped by ShareOut.

## Pagination

Paginated endpoints return a `Link`-header cursor surfaced as
`result.pagination.cursor` / `result.pagination.hasMore`. Pass the cursor back as
`params.queryParams.page_info` on the next call — see the BigQuery pagination pattern
in [../sdk/live-data.md](../sdk/live-data.md#bigquery-pagination) for the general shape
(cursor field differs by provider).

## Rate limits

Shopify's own Admin API limit applies, not a ShareOut-side one: **2 requests/sec
sustained per shop** (REST leaky-bucket, burst to 4). The execute response's
`rateLimit` field (`remaining`, `limit`) is read from Shopify's
`X-Shopify-Shop-Api-Call-Limit` header when present.

## Error handling

Generic platform-provider errors apply (no Shopify-specific codes) — `result.error.code`
is one of `SCOPE_REQUIRED` (403), `INVALID_CREDENTIALS` (401), `RATE_LIMITED` (429), or
an upstream `SHOPIFY_{status}` passthrough for other failures. See
[../sdk/live-data.md](../sdk/live-data.md) for the shared execute-envelope shape.

## Related

- [Overview](overview.md) - All integrations
- [Tienda Nube](tiendanube.md) - LATAM e-commerce
- [../sdk/live-data.md](../sdk/live-data.md) - `sdk.platform` reference and BigQuery worked example
