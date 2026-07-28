---
title: Shopify
description: Productos, pedidos e inventario de tu tienda.
---

Leé productos, pedidos e inventario de una tienda Shopify. Accedé vía
`sdk.shopify`.

## Inicio rápido

```javascript
const sdk = await ShareOut.create();

await sdk.shopify.connect({
  store: 'my-store.myshopify.com',
  accessToken: 'shpat_xxx',
});

const { data } = await sdk.shopify.products.list({ limit: 50, status: 'active' });
```

## Métodos

```typescript
connect({ store, accessToken }): Promise<void>

shopify.products.list(options?): Promise<ProductList>
shopify.products.get(id): Promise<Product>
shopify.orders.list(options?): Promise<OrderList>
shopify.orders.get(id): Promise<Order>
shopify.inventory.levels(locationId?): Promise<InventoryLevel[]>
```

## Campos del producto

`id` · `title` · `variants` · `status` (active/draft/archived) · `price` ·
`inventory_quantity`.

## Límites de tasa

El leaky-bucket de Shopify aplica según el plan: Basic 2/s, Shopify y Advanced 4/s,
Plus 20/s. Un `SHOPIFY_RATE_LIMITED` (429) significa que tenés que esperar y reintentar.

## Errores

| Código | Significado |
| --- | --- |
| `SHOPIFY_NOT_CONNECTED` | Llamá primero a `connect()` |
| `SHOPIFY_ACCESS_DENIED` | Al access token le faltan los scopes requeridos |
| `SHOPIFY_RATE_LIMITED` | Bajá el ritmo |
