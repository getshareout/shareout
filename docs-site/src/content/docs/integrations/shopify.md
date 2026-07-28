---
title: Shopify
description: Products, orders, and inventory from your store.
---

Read products, orders, and inventory from a Shopify store. Access via
`sdk.shopify`.

## Quick start

```javascript
const sdk = await ShareOut.create();

await sdk.shopify.connect({
  store: 'my-store.myshopify.com',
  accessToken: 'shpat_xxx',
});

const { data } = await sdk.shopify.products.list({ limit: 50, status: 'active' });
```

## Methods

```typescript
connect({ store, accessToken }): Promise<void>

shopify.products.list(options?): Promise<ProductList>
shopify.products.get(id): Promise<Product>
shopify.orders.list(options?): Promise<OrderList>
shopify.orders.get(id): Promise<Order>
shopify.inventory.levels(locationId?): Promise<InventoryLevel[]>
```

## Product fields

`id` · `title` · `variants` · `status` (active/draft/archived) · `price` ·
`inventory_quantity`.

## Rate limits

Shopify's leaky-bucket applies per plan: Basic 2/s, Shopify & Advanced 4/s,
Plus 20/s. A `SHOPIFY_RATE_LIMITED` (429) means back off and retry.

## Errors

| Code | Meaning |
| --- | --- |
| `SHOPIFY_NOT_CONNECTED` | Call `connect()` first |
| `SHOPIFY_ACCESS_DENIED` | The access token lacks required scopes |
| `SHOPIFY_RATE_LIMITED` | Slow down |
