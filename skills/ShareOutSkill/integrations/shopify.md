# Integration: Shopify

Products, orders, and inventory via Data Platform.

## Quick Start

```javascript
const sdk = new ShareOut();

// Connect to store
await sdk.shopify.connect({
  store: 'my-store.myshopify.com',
  accessToken: 'shpat_xxx'
});

// Fetch products
const { data } = await sdk.shopify.products.list({
  limit: 50,
  status: 'active'
});
```

## SDK Methods

```typescript
// Connect to store
connect(options: { store: string; accessToken: string }): Promise<void>

// Products
shopify.products.list(options?): Promise<ProductList>
shopify.products.get(id): Promise<Product>

// Orders
shopify.orders.list(options?): Promise<OrderList>
shopify.orders.get(id): Promise<Order>

// Inventory
shopify.inventory.levels(locationId?): Promise<InventoryLevel[]>
```

## Product Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Product ID |
| `title` | string | Product name |
| `variants` | array | Product variants |
| `status` | string | active/draft/archived |
| `price` | string | Base price |
| `inventory_quantity` | number | Stock count |

## Rate Limits

| Plan | Requests/sec |
|------|-------------|
| Basic | 2 |
| Shopify | 4 |
| Advanced | 4 |
| Plus | 20 |

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `SHOPIFY_NOT_CONNECTED` | 401 | Store not connected |
| `SHOPIFY_ACCESS_DENIED` | 403 | Insufficient scopes |
| `SHOPIFY_RATE_LIMITED` | 429 | Rate limit exceeded |

## Related

- [Overview](overview.md) - All integrations
- [Tienda Nube](tiendanube.md) - LATAM e-commerce
