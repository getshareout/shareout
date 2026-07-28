---
title: Connections
description: Consultá fuentes de datos externas y materializá los resultados en datasets o tables.
---

import { Aside } from '@astrojs/starlight/components';

Consultá fuentes de datos externas (REST APIs, conectores de workspace) y opcionalmente
**materializá** el resultado en un [dataset](/es/sdk/datasets/) o
[table](/es/sdk/tables/) duradero. Accedé vía `sdk.connection(name)`. Las conexiones se
definen una vez con credenciales cifradas; el artifact las referencia por nombre.

<Aside type="caution" title="Auth en sandbox requerida">
Llamá a `await ShareOut.create()` antes de usar cualquier método del SDK. El `fetch`
directo a `/v1/data/…` con `credentials: 'include'` falla dentro del sandbox del
artifact — las cookies no se envían a través del iframe. Ver [live-data](/es/sdk/live-data/)
para el patrón completo de inicialización.
</Aside>

## Métodos

```typescript
// Consulta en vivo — cacheada server-side según el TTL de la conexión
query<T>(
  query: string | Record<string, unknown>,
  options?: { cache?: boolean; ttl?: number; params?: Record<string, unknown> }
): Promise<QueryResult<T>>

// Igual que query() pero devuelve .data directamente (desenvuelve el envelope)
fetch<T>(
  query: string | Record<string, unknown>,
  options?: { cache?: boolean; ttl?: number; params?: Record<string, unknown> }
): Promise<T>

// Extrae una vez → almacena de forma duradera (solo owner)
materialize(params: {
  query?: string | Record<string, unknown>; // ejecuta server-side vía esta conexión
  rows?: unknown[];                          // O enviá filas prefetcheadas de cualquier fuente
  to: string;                               // "dataset:NAME" o "table:NAME"
  mode?: 'replace' | 'append';             // default replace
  format?: 'json' | 'csv';                 // solo dataset, default json
}): Promise<MaterializeResult>
```

```typescript
interface QueryResult<T> {
  data: T;
  cached: boolean;
  executionTimeMs: number;
  rowCount?: number;
}

interface MaterializeResult {
  target: 'dataset' | 'table';
  name: string;
  rowCount: number;
  version?: number;
  sizeBytes?: number;
  mode?: 'replace' | 'append';
}
```

## En vivo vs. extract

| | `query` / `fetch` | `materialize` |
|---|---|---|
| Cuándo usar | Resultados pequeños y siempre frescos | "Cargá una vez, leé offline" a escala |
| Hit a la fuente | En cada llamada (cache server-side) | Una vez por refresh |
| Viewers | Solo owner | Cualquiera (lee de dataset/table) |
| Analogía | Power BI DirectQuery | Power BI Import / Tableau extract |

## Ejemplos

### Consulta en vivo (conexión REST)

```javascript
const sdk = await ShareOut.create();

// .fetch() desenvuelve el envelope y devuelve el body del proveedor directamente
const body = await sdk.connection('mixpanel').fetch('/query/events', {
  params: {
    project_id: '123',
    event: JSON.stringify(['login_success']),
    type: 'general',
    unit: 'day',
    from_date: '2026-05-01',
    to_date: '2026-05-07',
  },
  ttl: 300,
});

// .query() mantiene { data, cached, executionTimeMs }
const r = await sdk.connection('meta').query(
  { endpoint: '/act_123/insights', method: 'GET' },
  { params: { fields: 'impressions,clicks' }, ttl: 120 }
);
const payload = r.data;
```

### Materializar → leer offline

```javascript
// Ejecutar una consulta server-side y almacenar el resultado como dataset
await sdk.connection('shipping_api').materialize({
  query: '/shipments?since=2026-01-01',
  to: 'dataset:shipments',
  mode: 'replace',
});

// El dashboard lee directo desde R2 — sin hit a la fuente en cada vista
const rows = await sdk.dataset('shipments').get();
const late = rows.filter(r => r.status === 'delayed');

// O materializar en una table con filtros server-side
await sdk.connection('shipping_api').materialize({ query: '/shipments', to: 'table:shipments' });
const delayed = await sdk.table('shipments').find({ status: 'delayed' }).exec();
```

### Enviar filas de cualquier fuente

`rows` acepta datos prefetcheados de cualquier fuente — motor de plataforma, Python, proxy:

```javascript
const result = await sdk.connection('warehouse').query('SELECT * FROM shipments');
await sdk.connection('warehouse').materialize({
  rows: result.data,
  to: 'dataset:shipments',
});
```

## Refresh programado

Refrescá un extract con un cron usando un job `materialize` (`POST /v1/jobs`). El
refresh programado usa `query` (re-ejecución server-side), no `rows` inline:

```json
{
  "artifact_id": "art_abc123",
  "action": "materialize",
  "trigger_type": "cron",
  "schedule": "0 6 * * *",
  "config": {
    "connection": "shipping_api",
    "query": "/shipments",
    "target": { "type": "dataset", "name": "shipments" },
    "mode": "replace"
  }
}
```

## Notas

- `materialize` y `query`/`fetch` en vivo son **solo para owners**. Para dashboards
  públicos que deben funcionar para cualquier viewer, materializá los datos y que los
  lectores usen [datasets](/es/sdk/datasets/) o [tables](/es/sdk/tables/).
- Los conectores por usuario de workspace devuelven `403 CREDENTIALS_REQUIRED` hasta que
  el miembro guarde su propio token vía `PUT /v1/workspaces/{id}/connections/{id}/my-credentials`.
- Las credenciales de conexión se cifran en reposo y son privadas al artifact o workspace.
- El tamaño del extract está limitado al tope duro del dataset (500 MB), a los env opcionales de instancia `STORAGE_MAX_FILE_BYTES` / `STORAGE_QUOTA_BYTES`, o a los límites de filas de table. Un `materialize()` que excede el límite falla con `FILE_TOO_LARGE` / `STORAGE_QUOTA_EXCEEDED`.
- Los `baseUrl` de `rest_api` deben ser URLs http(s) públicas — hosts privados, loopback y metadata de cloud están bloqueados (misma política SSRF que el secrets proxy).
