---
title: Tienda Nube
description: Products, orders, and customers from your Tienda Nube store.
---

Read and write data from a Tienda Nube (Nuvem Shop) store. Access via `sdk.tiendanube`.

## Quick start

```javascript
const sdk = await ShareOut.create();

if (!await sdk.tiendanube.isConnected()) {
  const ok = await sdk.tiendanube.authorize();
  if (!ok) return;
}

const { data } = await sdk.tiendanube.products.list({ limit: 50 });
```

## Methods

```typescript
getAuthUrl(returnUrl?): Promise<{ authUrl: string }>
authorize(returnUrl?): Promise<boolean>
isConnected(): Promise<boolean>

tiendanube.products.list(options?): Promise<ProductList>
tiendanube.products.get(id): Promise<Product>
tiendanube.products.create(body): Promise<Product>
tiendanube.products.update(id, body): Promise<Product>
tiendanube.products.delete(id): Promise<void>
tiendanube.products.bulkUpdate(body): Promise<void>

tiendanube.orders.list(options?): Promise<OrderList>
tiendanube.orders.get(id): Promise<Order>
tiendanube.orders.create(body): Promise<Order>
tiendanube.orders.update(id, body): Promise<Order>
tiendanube.orders.close(id): Promise<void>
tiendanube.orders.open(id): Promise<void>
tiendanube.orders.cancel(id): Promise<void>

tiendanube.customers.list(options?): Promise<CustomerList>
tiendanube.customers.get(id): Promise<Customer>
tiendanube.customers.create(body): Promise<Customer>
tiendanube.customers.update(id, body): Promise<Customer>
tiendanube.customers.delete(id): Promise<void>

tiendanube.categories.list(options?): Promise<CategoryList>
tiendanube.categories.get(id): Promise<Category>
tiendanube.categories.create(body): Promise<Category>
tiendanube.categories.update(id, body): Promise<Category>
tiendanube.categories.delete(id): Promise<void>

tiendanube.coupons.list(options?): Promise<CouponList>
tiendanube.coupons.get(id): Promise<Coupon>
tiendanube.coupons.create(body): Promise<Coupon>
tiendanube.coupons.update(id, body): Promise<Coupon>
tiendanube.coupons.delete(id): Promise<void>

tiendanube.store.get(): Promise<Store>
tiendanube.locations.list(): Promise<Location[]>

tiendanube.variants.list(productId): Promise<VariantList>
tiendanube.variants.get(productId, id): Promise<Variant>

tiendanube.webhooks.list(): Promise<Webhook[]>
tiendanube.webhooks.create(body): Promise<Webhook>
tiendanube.webhooks.delete(id): Promise<void>
```

## Product fields

`id` · `name` (localized object) · `variants` · `price` · `stock` ·
`images` · `categories`.

## Pagination

Tienda Nube uses page-based pagination. Default page size is 30, max 200. The `Link` response header contains `rel="next"` when more pages exist.

## Supported countries

Argentina · Brazil (as Nuvem Shop) · Mexico · Chile · Colombia

For Brazilian stores, the API automatically routes to `api.nuvemshop.com.br`.

## Rate limits

80 requests/min, 2 requests/s (burst up to 40), tracked per connection. Access tokens do not expire and cannot be refreshed.

## Errors

| Code | Meaning |
| --- | --- |
| `TN_NOT_CONNECTED` | OAuth not completed — call `authorize()` |
| `MISSING_STORE_ID` | Store ID was not found in the connection config |
| `TIENDANUBE_403` | Access token lacks required scopes |
| `TIENDANUBE_429` | Rate limit exceeded |
