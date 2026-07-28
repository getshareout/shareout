---
title: Live data
description: Consultá conexiones de workspace desde HTML de artifact publicado sin errores de auth.
---

import { Aside } from '@astrojs/starlight/components';

Cómo consultar datos en vivo desde un artifact HTML publicado. Leé esto antes de
escribir cualquier `fetch('/v1/data/…')` o `new ShareOut()` — hacerlo mal produce
`Authentication required`, gráficos vacíos o números silenciosamente incorrectos.

## Modelo de dos orígenes

Los artifacts publicados corren en un **iframe en sandbox** en un host de contenido separado:

| Capa | Host | Rol |
|------|------|-----|
| Shell de confianza | `shareout.site` (o subdominio del workspace) | Chrome de la página, cookies de sesión, bridge padre↔iframe |
| Contenido no confiable | `<hex>.shareoutcdn.site` | Tu HTML/JS del artifact — origen opaco |

El shell padre genera un Bearer `sessionToken` de corta duración y se lo pasa al SDK
vía `postMessage`. Las cookies **no** se envían desde el iframe.

| Enfoque | ¿Funciona en sandbox? |
|---------|----------------------|
| `await ShareOut.create()` + métodos del SDK | Sí — el SDK envía `Authorization: Bearer …` |
| `fetch(…/v1/data/…, { credentials: 'include' })` | No — las cookies no se envían desde el iframe |
| `new ShareOut()` a nivel superior (sin `await`) | Con race condition — el token puede llegar después del init |

## Inicialización requerida

```html
<script src="https://shareout.site/sdk/shareout.js"></script>
<script>
(async () => {
  const sdk = await ShareOut.create(); // espera el sessionToken del shell padre

  // cargá datos, luego renderizá
})();
</script>
```

Usá un IIFE async (o `await` a nivel superior en un module script). Nunca llamés a
`.get()`, `.query()` ni ningún otro método del SDK antes de que `ShareOut.create()` resuelva.

## Nunca llamés a `/v1/data/*` con fetch directo

```javascript
// MAL — falla en sandbox
const res = await fetch(`${base}/v1/data/${aid}/connections/mixpanel/query`, {
  method: 'POST',
  credentials: 'include',
  body: JSON.stringify({ query, options }),
});

// BIEN — conexión de workspace REST genérica (Mixpanel, Meta Graph, cualquier rest_api)
const body = await sdk.connection('mixpanel').fetch('/query/events', {
  params: { project_id: '123', event: '["login_success"]', type: 'general', unit: 'day', from_date, to_date },
  ttl: 300,
});
```

Todas las llamadas a `/v1/data/{artifactId}/*` desde el JS del artifact deben ir por el SDK.

## Conexiones REST genéricas (`sdk.connection`)

Conexiones de workspace con `kind: generic` y `provider: rest_api`:

```javascript
const sdk = await ShareOut.create();

// .fetch() desenvuelve el envelope — devuelve el body del proveedor directamente
const mpBody = await sdk.connection('mixpanel').fetch('/query/events', {
  params: {
    project_id: '3212168',
    event: JSON.stringify(['$ae_session', 'login_success']),
    type: 'general',
    unit: 'day',
    from_date: '2026-05-01',
    to_date: '2026-05-07',
  },
  ttl: 300,
});

// Los proveedores suelen anidar datos — desenvolvé con cuidado
const inner = mpBody?.data ?? mpBody;

// .query() mantiene { data, cached, executionTimeMs }
const r = await sdk.connection('meta').query(
  { endpoint: '/act_123/insights', method: 'GET' },
  { params: { fields: 'impressions,clicks' }, ttl: 120 }
);
const payload = r.data;
```

Ver [connections](/es/sdk/connections/) para `materialize()` y refresh programado.

## Proveedores de plataforma (BigQuery, Snowflake, GA, Shopify)

Usá **`sdk.platform`** (preferido). El path bajo nivel sigue siendo
`POST /v1/data/{id}/platform/{provider}/{endpoint}/execute`.

```javascript
const sdk = await ShareOut.create();

// 1. Resolver el id de conexión (lista solo owner)
const bq = await sdk.platform.connectionByName('bigquery');
if (!bq) throw new Error("No 'bigquery' connection on this artifact.");

// 2. Ejecutar el endpoint del proveedor
const result = await sdk.platform.execute('bigquery', 'jobs.query', {
  connectionId: bq.id,
  params: {
    pathParams: { projectId: 'my-gcp-project' },
    body: {
      query: 'SELECT CAST(MAX(date) AS STRING) AS maxd FROM `proj.dataset.table`',
      useLegacySql: false,
      maxResults: 5000,
    },
  },
});

// 3. Parsear las filas de BigQuery
if (result.success === false || result.error) {
  throw new Error(result.error?.message || 'Query failed');
}
const bqResp = result.data || result;
const fields = (bqResp.schema?.fields || []).map(f => f.name);
const rows = (bqResp.rows || []).map(row => {
  const o = {};
  (row.f || []).forEach((cell, i) => { o[fields[i]] = cell.v; });
  return o;
});
```

Patrón de endpoint del proveedor: `/platform/{providerId}/{endpointId}/execute`.

### Paginación de BigQuery

`jobs.query` limita la respuesta síncrona por **tamaño del payload**, no solo por
`maxResults`. Con conjuntos grandes, BigQuery devuelve un `pageToken` (también en el
sobre de execute como `pagination.hasMore` / `pagination.cursor`). Sin seguir ese
token, los dashboards pierden filas después de la primera página sin error.

La página siguiente se obtiene con `jobs.getQueryResults`, pasando el `jobId` de
`jobReference.jobId` y el token como query param:

```javascript
function parseBqRows(bqResp) {
  const fields = (bqResp.schema?.fields || []).map(f => f.name);
  return (bqResp.rows || []).map(row => {
    const o = {};
    (row.f || []).forEach((cell, i) => { o[fields[i]] = cell.v; });
    return o;
  });
}

async function fetchAllBqRows(sdk, connectionId, projectId, sql) {
  let pageToken;
  let jobId;
  const allRows = [];

  while (true) {
    const endpointId = pageToken ? 'jobs.getQueryResults' : 'jobs.query';
    const params = pageToken
      ? { pathParams: { projectId, jobId }, queryParams: { pageToken } }
      : {
          pathParams: { projectId },
          body: { query: sql, useLegacySql: false, maxResults: 10000 },
        };

    const result = await sdk._internalFetch(`/platform/bigquery/${endpointId}/execute`, {
      method: 'POST',
      body: JSON.stringify({ connectionId, params }),
    });
    if (result.success === false || result.error) {
      throw new Error(result.error?.message || 'Query failed');
    }

    const bqResp = result.data || result;
    jobId = jobId || bqResp.jobReference?.jobId;
    allRows.push(...parseBqRows(bqResp));

    pageToken = result.pagination?.cursor || bqResp.pageToken || null;
    if (!pageToken) break;
  }

  return allRows;
}
```

Para extracts muy grandes, preferí [materialize](/es/sdk/connections/) o un job
[`query_snapshot`](/es/guides/jobs/) programado en lugar de paginar en el browser.

## Consultas paralelas

El SDK deduplica POSTs en vuelo por path + hash del body. Las llamadas paralelas al
mismo endpoint con **bodies distintos** son seguras en las versiones actuales del SDK.
Para SDKs más antiguos, ejecutá las consultas al warehouse de forma secuencial.

## ¿Quién puede consultar en vivo?

| API | Viewer con contraseña | Owner | Miembro del workspace (conector per_user) |
|-----|----------------------|-------|------------------------------------------|
| `sdk.json` / `sdk.table()` | Sí (según access policy) | Sí | Sí |
| `sdk.connection().query/fetch` (compartido) | No | Sí | No |
| `sdk.connection().query/fetch` (per_user) | No | Sí (propio token) | Sí (propio token) |
| `sdk._internalFetch('/platform/…')` (compartido) | No | Sí | Sí |

<Aside type="caution" title="Dashboards públicos">
Las consultas en vivo no están disponibles para viewers que solo tienen contraseña —
no tienen identidad de usuario en ShareOut. Para dashboards públicos, **materializá**
los datos en un dataset o table para que las lecturas vengan del almacenamiento, no de
credenciales en vivo.
</Aside>

Los conectores por usuario devuelven `403 CREDENTIALS_REQUIRED` hasta que el miembro del
workspace guarde su token vía `PUT /v1/workspaces/{id}/connections/{connectionId}/my-credentials`.

## Errores comunes

| Error | Síntoma |
|-------|---------|
| `fetch` directo + `credentials: 'include'` | `Authentication required` |
| `new ShareOut()` sin `create()` | Fallos de auth intermitentes |
| Desenvolvimiento incorrecto del proveedor (`r.data` vs `r.data.data`) | Gráficos renderizan, números todos en cero |
| POST paralelo mismo path en SDK antiguo | Shape de la primera consulta reutilizada — datos vacíos/incorrectos |
| Ignorar `pageToken` de BigQuery | Solo primera página — filas faltantes sin error |
| Esperar que viewers con contraseña ejecuten consultas en vivo | `Forbidden` o datos vacíos |

## Checklist

- `const sdk = await ShareOut.create()` dentro de un IIFE async
- Sin `fetch` directo a `/v1/data/{artifactId}/…`
- Fuentes REST → `sdk.connection('name').fetch(…)`
- BigQuery / plataforma → `sdk._internalFetch('/platform/…')`
- Desenvolvimiento defensivo del `.data` anidado del proveedor
- Consultas en vivo solo para owners documentadas en el copy de la UI, o usá materialize para audiencia pública
