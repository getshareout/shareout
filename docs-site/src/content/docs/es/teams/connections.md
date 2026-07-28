---
title: Conexiones de workspace
description: Definí fuentes de datos reutilizables para el equipo — credenciales compartidas o tokens por usuario.
---

import { Aside } from '@astrojs/starlight/components';

Los conectores de workspace son fuentes de datos reutilizables definidas una
sola vez a nivel workspace. Los artifacts las referencian **por nombre** — las
credenciales nunca se copian en el HTML publicado.

## Alcance de credenciales

| Patrón | `credentialScope` | El admin provee | Cada miembro provee | Ejemplo |
| --- | --- | --- | --- | --- |
| Conector compartido del equipo | `shared` (por defecto) | Endpoint + un token | Nada | Service account de Snowflake, bot de Slack del equipo |
| Conector por usuario | `per_user` | Endpoint + forma de auth | Su propio API token | API GraphQL con datos del usuario logueado |

Usá `per_user` cuando la API upstream autentica a la persona, no a la
organización. Usá `shared` cuando un service account cubre a todo el equipo.

<Aside>
Los jobs de cron programados corren sin identidad de viewer y no pueden
refrescar conectores `per_user`. Usá conectores `shared` para materializaciones
nocturnas.
</Aside>

## Roles

| Acción | `owner` / `admin` | `member` |
| --- | --- | --- |
| Listar conectores | ✓ | ✓ |
| Crear / eliminar conectores | ✓ | |
| Instalar conectores de plataforma vía OAuth | ✓ | |
| Guardar credenciales propias (solo `per_user`) | ✓ | ✓ |

## Admin: crear conector compartido

```http
POST /v1/workspaces/{workspaceId}/connections
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "team_mixpanel",
  "type": "rest_api",
  "credentialScope": "shared",
  "config": {
    "baseUrl": "https://mixpanel.com/api/2.0",
    "apiKeyHeader": "Authorization",
    "apiKeyPrefix": "Basic "
  },
  "credentials": {
    "type": "api_key",
    "data": { "apiKey": "credencial-base64-del-servicio" }
  }
}
```

## Admin: crear conector por usuario

El admin define el endpoint y la forma de auth. **No** enviés `credentials.data`.

```http
POST /v1/workspaces/{workspaceId}/connections
Authorization: Bearer {token}
Content-Type: application/json

{
  "name": "acme_graphql",
  "type": "rest_api",
  "credentialScope": "per_user",
  "authType": "api_key",
  "config": {
    "baseUrl": "https://api.example.com/graphql",
    "apiKeyHeader": "Authorization",
    "apiKeyPrefix": "Bearer "
  }
}
```

`authType` debe ser uno de: `api_key`, `basic_auth`, `service_account`.

## Miembro: guardar credenciales personales

```http
PUT /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials
Authorization: Bearer {token}
Content-Type: application/json

{
  "credentials": {
    "type": "api_key",
    "data": { "apiKey": "token-personal-del-miembro" }
  }
}
```

Consultar estado (sin valores secretos):

```http
GET /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials
```

```json
{ "configured": true, "authType": "api_key", "updatedAt": "2026-06-15T12:00:00.000Z" }
```

Revocar:

```http
DELETE /v1/workspaces/{workspaceId}/connections/{connectionId}/my-credentials
```

El listado `GET /connections` incluye `hasMyCredentials: true|false` en cada
conector `per_user`.

## Runtime en artifacts

```javascript
const sdk = await ShareOut.create();

const body = await sdk.connection('acme_graphql').fetch('', {
  query: {
    endpoint: '',
    method: 'POST',
    body: {
      query: `query Adoption($id: ID!) { company(id: $id) { name } }`,
      variables: { id: '743' }
    }
  },
  cache: false
});
```

El servidor inyecta el token guardado del viewer. Si no hay token guardado, la
request devuelve `403 CREDENTIALS_REQUIRED`.

## Conectores de plataforma (catálogo)

Explorá el catálogo siempre visible en el admin del workspace. La mayoría usa
**credenciales propias** — pegá tu token o clave, usá **Test**, guardá. Incluye
Google Analytics, Google Ads, Facebook Ads, Shopify, Tienda Nube, Google Sheets,
Snowflake, BigQuery y Slack.

### Probar credenciales antes de guardar

```http
POST /v1/workspaces/{workspaceId}/connections/test
Authorization: Bearer {token}
Content-Type: application/json

{
  "provider": "google-analytics",
  "config": { "propertyId": "123456789" },
  "credentials": { "type": "service_account", "data": { "key": { … } } }
}
```

Solo admin+.

### Instalación OAuth (Slack)

| Endpoint | Propósito |
| --- | --- |
| `GET /v1/workspaces/{id}/connections/slack/install?connection={name}` | Instalar Slack (302). |
| `GET /v1/workspaces/{id}/connections/{connectionId}` | Detalle admin (sin secretos). |

### Consultas del asistente del workspace

Los admins pueden habilitar **consulta IA** por conector para que el
[asistente del workspace](/es/teams/workspace-assistant/) ejecute `SELECT` de solo
lectura:

```http
PATCH /v1/workspaces/{workspaceId}/connections/{connectionId}
Authorization: Bearer {token}
Content-Type: application/json

{ "agent_query_enabled": true }
```

Desactivado por defecto.

### Ejecución server-side de warehouse

Los conectores genéricos de **Snowflake** y **BigQuery** del workspace (credenciales
inline, sin OAuth de plataforma) se ejecutan en el servidor para:

- `query_snapshot` y otras entregas materialize programadas
- Test de conexión (`POST /v1/workspaces/{id}/connections/test`)

Los conectores Postgres warehouse aún requieren pre-fetch externo hasta que haya
motor en Workers. Los conectores REST y OAuth de plataforma no cambian.

## Resumen de endpoints

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/connections` | Member+ | Listar. Sin secretos. |
| `POST` | `/v1/workspaces/{id}/connections` | Admin+ | Crear. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Detalle. |
| `DELETE` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Eliminar; cascadea credenciales de miembros. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}/artifacts` | Member+ | Artifacts que usan este conector. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Estado per-user. |
| `PUT` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Guardar token propio. |
| `DELETE` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Eliminar token propio. |
| `POST` | `/v1/workspaces/{id}/connections/test` | Admin+ | Verificar credenciales sin guardar. |
| `PATCH` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Activar `agent_query_enabled`. |
| `GET` | `/v1/oauth/slack/callback` | — | Callback OAuth de Slack. |

## Errores

| Código | Significado |
| --- | --- |
| `403 CREDENTIALS_REQUIRED` | El miembro hizo una query a un conector `per_user` sin guardar `my-credentials`. |
| `400 NOT_PER_USER` | Se llamó a `my-credentials` en un conector `shared`. |
