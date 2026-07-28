---
title: Tienda Nube
description: Productos, pedidos y clientes de tu tienda en Tienda Nube.
---

Leé y escribí datos de una tienda Tienda Nube (Nuvem Shop). Accedé vía `sdk.tiendanube`.

## Inicio rápido

```javascript
const sdk = await ShareOut.create();

if (!await sdk.tiendanube.isConnected()) {
  const ok = await sdk.tiendanube.authorize();
  if (!ok) return;
}

const { data } = await sdk.tiendanube.products.list({ limit: 50 });
```

## Métodos

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

## Campos del producto

`id` · `name` (objeto localizado) · `variants` · `price` · `stock` ·
`images` · `categories`.

## Paginación

Tienda Nube usa paginación basada en páginas. El tamaño por defecto es 30, máximo 200. El header `Link` de la respuesta contiene `rel="next"` cuando hay más páginas.

## Países disponibles

Argentina · Brasil (como Nuvem Shop) · México · Chile · Colombia

Para tiendas brasileñas, la API enruta automáticamente a `api.nuvemshop.com.br`.

## Límites de tasa

80 solicitudes/min, 2 solicitudes/s (burst hasta 40), rastreadas por conexión. Los access tokens no expiran ni pueden renovarse.

## Errores

| Código | Significado |
| --- | --- |
| `TN_NOT_CONNECTED` | OAuth no completado — llamá a `authorize()` |
| `MISSING_STORE_ID` | No se encontró el store ID en la configuración de conexión |
| `TIENDANUBE_403` | Al access token le faltan los scopes requeridos |
| `TIENDANUBE_429` | Se superó el límite de tasa |
