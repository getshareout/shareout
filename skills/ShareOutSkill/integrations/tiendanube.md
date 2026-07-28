# Integration: Tienda Nube

LATAM e-commerce integration via Data Platform.

## Quick Start

```javascript
const sdk = new ShareOut();

// Connect to store
await sdk.tiendanube.connect({
  storeId: '123456',
  accessToken: 'xxx'
});

// Fetch products
const { data } = await sdk.tiendanube.products.list({
  limit: 50
});
```

## SDK Methods

```typescript
// Connect to store
connect(options: { storeId: string; accessToken: string }): Promise<void>

// Products
tiendanube.products.list(options?): Promise<ProductList>
tiendanube.products.get(id): Promise<Product>

// Orders
tiendanube.orders.list(options?): Promise<OrderList>
tiendanube.orders.get(id): Promise<Order>
```

## Product Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | number | Product ID |
| `name` | object | Localized names |
| `variants` | array | Product variants |
| `price` | string | Base price |
| `stock` | number | Stock count |

## Supported Countries

- Argentina
- Brazil
- Mexico
- Chile
- Colombia

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `TN_NOT_CONNECTED` | 401 | Store not connected |
| `TN_ACCESS_DENIED` | 403 | Token invalid |
| `TN_RATE_LIMITED` | 429 | Rate limit exceeded |

## Related

- [Overview](overview.md) - All integrations
- [Shopify](shopify.md) - Shopify integration
