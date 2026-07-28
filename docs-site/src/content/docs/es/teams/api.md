---
title: Referencia de la API de Teams
description: Lista completa de endpoints para la gestión de workspaces del plan Teams.
---

Todos los endpoints de escritura y admin requieren:

```http
Authorization: Bearer {token}
```

Algunas lecturas de workspace también aceptan una sesión de navegador logueada.

## Workspaces

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/workspaces` | Listar workspaces del usuario del token. |
| `POST` | `/v1/workspaces` | Crear workspace. |
| `GET` | `/v1/workspaces/{id}` | Obtener workspace. Member+. |
| `PATCH` | `/v1/workspaces/{id}` | Actualizar nombre, slug, settings. Admin+. |
| `DELETE` | `/v1/workspaces/{id}` | Eliminar workspace. Solo owner. |
| `GET` | `/v1/workspaces/by-slug/{slug}` | Buscar por slug. |

## Miembros

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/members` | Listar miembros. |
| `POST` | `/v1/workspaces/{id}/members` | Agregar miembro; con política de acceso. |
| `DELETE` | `/v1/workspaces/{id}/members/{userId}` | Remover miembro. |
| `POST` | `/v1/workspaces/{id}/members/invite` | Invitar en bulk por email. Admin+. |
| `GET` | `/v1/workspaces/{id}/members/metrics` | Métricas de actividad. Admin+. |
| `GET` | `/v1/workspaces/{id}/invites` | Invites por email pendientes. Admin+. |
| `DELETE` | `/v1/workspaces/{id}/invites/{inviteId}` | Revocar invite pendiente. Admin+. |
| `GET` | `/v1/workspaces/{id}/people` | Lista para selector de personas. |
| `POST` | `/v1/workspaces/{id}/transfer-ownership` | Transferir a otro miembro. Solo owner. |
| `POST` | `/v1/workspaces/{id}/members/{userId}/tokens` | Crear token de API para miembro. Admin+. |
| `DELETE` | `/v1/workspaces/{id}/members/{userId}/tokens` | Revocar tokens de miembro. Admin+. |

## Tokens de Agente (cuentas de servicio)

Credenciales no humanas, acotadas a un workspace (prefijo `sot_`) para el agente de IA
de un cliente, un servicio backend o CI/CD. Cada token autentica como un **principal de
servicio**: un miembro headless de primera clase que es dueño de los artifacts que
publica y queda confinado a su único workspace. Scopes de acción: `artifacts:read`,
`artifacts:publish`, `data:read`, `data:write`.

| Método | Endpoint | Notas |
| --- | --- | --- |
| `POST` | `/v1/workspaces/{id}/agent-tokens` | Crear. Body `{ name, scopes[], expires_at? }`. Devuelve `sot_…` una sola vez. Admin+. |
| `GET` | `/v1/workspaces/{id}/agent-tokens` | Listar (solo metadata). Admin+. |
| `DELETE` | `/v1/workspaces/{id}/agent-tokens/{tokenId}` | Revocar (soft). Admin+. |

Un token sin el scope requerido recibe `403 INSUFFICIENT_SCOPE`; uno revocado/expirado, `401`.

## Política de membresía

```http
GET  /v1/workspaces/{id}/access-policy
PUT  /v1/workspaces/{id}/access-policy
```

Body: `{ "allowed_domains": ["example.com"], "allowed_emails": ["x@y.com"] }`.
`PUT` requiere `admin` u `owner`. Mirá [Workspaces](/es/teams/workspaces/#política-de-membresía).

## Subdominio

```http
GET    /v1/workspaces/{id}/subdomain
POST   /v1/workspaces/{id}/subdomain       ← { "enabled": true }
DELETE /v1/workspaces/{id}/subdomain
```

Requiere plan Teams + `admin` u `owner`. Mirá [Subdominios](/es/teams/subdomain/).

## Branding

```http
GET    /v1/workspaces/{id}/branding
PUT    /v1/workspaces/{id}/branding
POST   /v1/workspaces/{id}/logo
DELETE /v1/workspaces/{id}/logo
```

## Contexto de workspace (estilo para agentes)

```http
GET    /v1/workspaces/{id}/context
PUT    /v1/workspaces/{id}/context                ← { "entry": "index.md" }
GET    /v1/workspaces/{id}/context/{name}
PUT    /v1/workspaces/{id}/context/{name}
DELETE /v1/workspaces/{id}/context/{name}
```

Las escrituras requieren `admin` u `owner`. Mirá [Workspaces](/es/teams/workspaces/#archivos-de-contexto-de-workspace).

## Carpetas

```http
GET    /v1/workspaces/{id}/folders
POST   /v1/workspaces/{id}/folders
GET    /v1/workspaces/{id}/folders/{folderId}
PATCH  /v1/workspaces/{id}/folders/{folderId}
DELETE /v1/workspaces/{id}/folders/{folderId}
GET    /v1/workspaces/{id}/folders/by-path/{path}
POST   /v1/workspaces/{id}/artifacts/{artifactId}/move
```

Mirá [Carpetas](/es/teams/folders/).

## Assets (deliverables)

Biblioteca de assets por alcance — un bucket oculto por workspace (compartido) y uno personal. Cualquier miembro del workspace puede usar las rutas de workspace; las personales usan `/v1/assets` sin prefijo de workspace.

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/assets` | Listar deliverables + archivos sueltos (`deliverables[]`, `loose[]`, `bucketId`, `usedBytes`). Member+. |
| `POST` | `/v1/workspaces/{id}/assets/upload` | Pedir upload → `{ uploadUrl, tokenId }`; `PUT` de bytes a `uploadUrl`. Member+. |
| `POST` | `/v1/workspaces/{id}/assets/deliverables` | `{ blobId, name? }` → deliverable nuevo (v1). Member+. |
| `POST` | `/v1/workspaces/{id}/assets/deliverables/{id}/version` | `{ blobId }` → agregar versión. Member+. |
| `PATCH` | `/v1/workspaces/{id}/assets/deliverables/{id}` | `{ visibility?, folderId? }` — `private` \| `workspace`. Member+. |
| `GET` | `/v1/workspaces/{id}/assets/deliverables/{id}/versions` | Historial de versiones. Member+. |
| `DELETE` | `/v1/workspaces/{id}/assets/deliverables/{id}` | Borrar deliverable + todas las versiones. Member+. |
| `POST` | `/v1/workspaces/{id}/assets/collections` | `{ name?, deliverableIds[] }` → bundle. Member+. |
| `POST` | `/v1/workspaces/{id}/assets/collections/{id}/share` | `{ expiresAt?, gate?, password?, domains? }` → `{ url }` (`/d/<token>`). Member+. |
| `POST` | `/v1/workspaces/{id}/assets/collections/{id}/send` | `{ to, expiresAt?, gate?, password?, domains? }` → email con link. Member+. |
| `GET` | `/v1/workspaces/{id}/assets/links` | Listar links de entrega enviados (gate, expiry, `viewCount`, revoked). Member+. |
| `POST` | `/v1/workspaces/{id}/assets/links/{linkId}/revoke` | Revocar link (página + bytes 404). Member+. |

`gate`: `none` (default), `password` + `password`, o `domain` + `domains[]`. Las entregas protegidas sirven bytes por `/d/<token>/file/<blobId>` tras pasar el gate. La primera apertura envía email al creador del link (`asset_delivery_opened`).

Límites: 500 MB/archivo · 10 GB/bucket · 10 000 archivos. Ver [Archivos y entregas](/es/everyone/assets/).

### Contenido de archivo (cross-artifact)

Incrustá un archivo del workspace en cualquier artifact por su id `dlv_`. Aplica visibilidad por archivo (privados → 403 sin autorización).

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/files/{deliverableId}/content` | Bytes de la última versión. Sesión o token. |

SDK: [`sdk.files.getUrl('dlv_…')`](/es/sdk/files/).

## Compartir con externos (Clientes)

Función Teams/Enterprise. Compartí carpetas y artifacts con orgs de clientes
fuera de tu equipo — portal agrupado, páginas con marca, tokens API acotados,
recibos de lectura y notas privadas sobre cada cliente. Todas las rutas requieren
`admin` del workspace más el entitlement
(`403 EXTERNAL_SHARING_NOT_ENTITLED` si no). Ver
[Compartir con clientes](/es/teams/external-sharing/).

### Clientes

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees` | Listar orgs de clientes (`member_count`). |
| `POST` | `/v1/workspaces/{id}/sharees` | `{ "name": "Acme", "type": "client" }`. |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}` | Un cliente. |
| `PATCH` | `/v1/workspaces/{id}/sharees/{sid}` | `{ name?, type?, properties?, branding? }` — `branding` es `{ logo, color }` para el portal. |
| `DELETE` | `/v1/workspaces/{id}/sharees/{sid}` | Elimina el cliente, sus miembros, grants y notas. |

### Miembros externos

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/members` | Listar miembros externos. |
| `POST` | `/v1/workspaces/{id}/sharees/{sid}/members` | `{ "email": "ext@acme.com" }` — invitar; marca un edge de membresía externa (gratis, no facturado). |
| `DELETE` | `/v1/workspaces/{id}/sharees/{sid}/members/{uid}` | Quitar solo de este cliente. |

### Grants

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/grants` | Filtrar con `?subject_id=` / `?resource_type=` / `?resource_id=`. |
| `POST` | `/v1/workspaces/{id}/grants` | Crear grant — ver body abajo. |
| `DELETE` | `/v1/workspaces/{id}/grants/{gid}` | Revocar (efectivo en ~60s de caché). |

**Compartir con una persona** (sin org de cliente):

| Método | Endpoint | Notas |
| --- | --- | --- |
| `POST` | `/v1/workspaces/{id}/share-person` | `{ email, resource_type: "file"\|"folder", resource_id, capability: "view"\|"comment" }` — admin + entitlement Teams; invita usuario externo si hace falta. `409` si el email es miembro interno. |

Body del grant (API admin de grants):

```json
{
  "subject_type": "sharee",
  "subject_id": "shr_…",
  "resource_type": "folder",
  "resource_id": "fld_…",
  "capability": "view"
}
```

`resource_type`: `folder` | `artifact` | `file`. `subject_type`: `sharee` (toda la org cliente) o `external_user` (una persona).
`capability`: `view` | `comment` | `create` | `edit`. `create` es solo en carpetas —
deja al externo crear artifacts nuevos encerrados en esa carpeta (forzados a privado).

### Tokens API acotados

Los tokens externos resuelven por grants — nunca cubren todo el workspace. Scopes
limitados a `artifacts:read`, `data:read`, `data:write` (nunca `artifacts:publish`).

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/members/{uid}/tokens` | Listar (sin secretos). |
| `POST` | `/v1/workspaces/{id}/sharees/{sid}/members/{uid}/tokens` | `{ "scopes": ["data:read"] }` → `{ token: "sot_…", shown_once: true }`. |
| `DELETE` | `/v1/workspaces/{id}/sharees/{sid}/members/{uid}/tokens/{tid}` | Revocar. |

### Actividad / recibos de lectura

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/activity` | Vistas recientes de un cliente. |
| `GET` | `/v1/workspaces/{id}/sharee-activity` | Vistas recientes de todos los clientes. |

### Notas del cliente

Markdown privado del workspace sobre un cliente — nunca compartido con ellos. Cualquier
miembro puede leer; admin (o el asistente del workspace vía `set_client_notes`) puede escribir.

| Método | Endpoint | Notas |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/context` | Listar archivos de notas. |
| `GET` | `/v1/workspaces/{id}/sharees/{sid}/context/{name}` | Leer una nota (markdown). |
| `PUT` | `/v1/workspaces/{id}/sharees/{sid}/context/{name}` | Crear/reemplazar (admin). Markdown crudo o `{ "content": "…" }`. |
| `DELETE` | `/v1/workspaces/{id}/sharees/{sid}/context/{name}` | Eliminar (admin). |

## Conexiones de workspace

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/connections` | Member+ | Listar. Sin secretos. |
| `POST` | `/v1/workspaces/{id}/connections` | Admin+ | Crear. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Detalle. |
| `DELETE` | `/v1/workspaces/{id}/connections/{connectionId}` | Admin+ | Eliminar; cascadea credenciales. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}/artifacts` | Member+ | Artifacts que usan este conector. |
| `GET` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Estado per-user. |
| `PUT` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Guardar token propio. |
| `DELETE` | `/v1/workspaces/{id}/connections/{connectionId}/my-credentials` | Member+ | Eliminar token propio. |
| `GET` | `/v1/workspaces/{id}/connections/{provider}/auth-url` | Admin+ | Inicio de OAuth. |
| `GET` | `/v1/workspaces/{id}/connections/slack/install` | Admin+ | Instalación de Slack (302). |
| `GET` | `/v1/workspaces/{id}/connections/{connection}/slack/channels` | Member+ | Lista de canales de Slack. |
| `GET` | `/v1/oauth/slack/callback` | — | Callback OAuth de Slack. |

Mirá [Conexiones](/es/teams/connections/).

## Catálogo de datos

Mapa de datos opcional por workspace. Ver [Catálogo de datos](/es/teams/catalog/).

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/catalog` | Member+ | Búsqueda (`q`, `kind`, `domain`, `status`, `tag`) + facetas. |
| `GET` | `/v1/workspaces/{id}/catalog/manifest` | Member+ | KPIs de adopción, huérfanos, refs colgantes. |
| `GET` | `/v1/workspaces/{id}/catalog/entries/{entryId}` | Member+ | Entrada + vecinos de linaje. |
| `GET` | `/v1/workspaces/{id}/catalog/lineage` | Member+ | Grafo completo (`nodes`, `edges`). |
| `POST` | `/v1/workspaces/{id}/catalog/enable` | Admin+ | `{ "enabled": true \| false }`. |
| `POST` | `/v1/workspaces/{id}/catalog/seed` | Admin+ | Seed idempotente desde conectores. |
| `PUT` | `/v1/workspaces/{id}/catalog/files` | Member+ | `{ "path", "content" }` — upsert de archivo markdown. |
| `DELETE` | `/v1/workspaces/{id}/catalog/files?path=` | Member+ | Eliminar un archivo. |

## Workspace Knowledge

Biblioteca aprendida opt-in. **Plan pago** requerido para `enable` y `backfill`. Ver [Conocimiento del workspace](/es/teams/knowledge/).

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/knowledge` | Member+ | Settings + counts. |
| `GET` | `/v1/workspaces/{id}/knowledge/status` | Member+ | Progreso de entrenamiento (ventana 24h). |
| `GET` | `/v1/workspaces/{id}/knowledge/tree` | Member+ | Resúmenes por kind. |
| `GET` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | Una nota (cuerpo completo). |
| `PUT` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | Upsert markdown. |
| `DELETE` | `/v1/workspaces/{id}/knowledge/files/{path}?forget=1` | Admin+ | Eliminar; `forget=1` evita re-aprendizaje. |
| `POST` | `/v1/workspaces/{id}/knowledge/enable` | Admin+ | `{ "enabled": true }` — plan pago. |
| `POST` | `/v1/workspaces/{id}/knowledge/backfill` | Admin+ | Encolar hasta 200 páginas → `{ queued, kicked }` — plan pago. |

## Schedules y automaciones

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/schedules` | Listar schedules. Admin+. |
| `GET` | `/v1/workspaces/{id}/schedules/{jobId}/logs` | Logs recientes. Admin+. |
| `POST` | `/v1/workspaces/{id}/schedules/{jobId}/run` | Ejecutar ahora. Admin+. |
| `PATCH` | `/v1/workspaces/{id}/schedules/{jobId}` | Habilitar/deshabilitar. Admin+. |
| `DELETE` | `/v1/workspaces/{id}/schedules/{jobId}` | Eliminar. Admin+. |
| `GET` | `/v1/workspaces/{id}/automations` | Listar automaciones. Admin+. |
| `GET` | `/v1/workspaces/{id}/automations/{triggerId}/runs` | Historial de ejecuciones. Admin+. |
| `POST` | `/v1/workspaces/{id}/automations/{triggerId}/run` | Despachar ahora. Admin+. |
| `PATCH` | `/v1/workspaces/{id}/automations/{triggerId}` | Habilitar/deshabilitar. Admin+. |
| `DELETE` | `/v1/workspaces/{id}/automations/{triggerId}` | Eliminar. Admin+. |
| `GET` | `/v1/workspaces/{id}/runs` | Lista unificada de runs (`surface`, `status`, `limit`). Admin+. |
| `GET` | `/v1/workspaces/{id}/runs/{surface}/{runId}` | Detalle Run Inspector (`crew`/`job`/`alert`). Admin+. |

## Artifacts admin del workspace

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/admin/artifacts` | Admin+ | Tabla de gobernanza (vistas, owner, visibilidad…). |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/pause` | Admin+ | `{ "paused": true }`. |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/visibility` | Admin+ | Cambiar visibilidad. |
| `POST` | `/v1/workspaces/{id}/admin/artifacts/{artifactId}/transfer` | Admin+ | Reasignar owner `{ "new_owner_id" }`. |

## Pedidos de acceso

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `POST` | `/v1/access-requests` | Público | Pedir acceso a una página con gate. |
| `GET` | `/v1/access-requests/incoming` | Owner/admin | Pedidos pendientes para tus workspaces. |
| `POST` | `/v1/access-requests/{id}` | Owner/admin | `{ "action": "approve" \| "deny" }`. |

## Tickets de soporte

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `POST` | `/v1/support/tickets` | Sesión iniciada | Crear ticket `{ "subject", "body", "workspaceId"? }`. |
| `GET` | `/v1/support/tickets?scope=mine` | Sesión iniciada | Tickets propios del solicitante (default). |
| `GET` | `/v1/support/tickets?scope=workspace&workspace={id}` | Admin+ | Tickets del workspace; `&status=` opcional. |
| `GET` | `/v1/support/tickets?scope=all` | Super-admin | Todos los tickets de la plataforma. |
| `GET` | `/v1/support/tickets/{id}` | Solicitante o staff | Ticket + hilo completo. |
| `POST` | `/v1/support/tickets/{id}/message` | Solicitante o staff | Agregar `{ "body" }` (respuesta del cliente re-abre). |
| `POST` | `/v1/support/tickets/{id}/reply` | Staff | Aprobar y enviar `{ "body" }` en el canal de origen. |
| `POST` | `/v1/support/tickets/{id}/status` | Staff | `{ "status": "resolved" }` etc. |
| `POST` | `/v1/support/tickets/{id}/assign` | Staff | `{ "assigneeUserId": "usr_…" }` o `null`. |
| `POST` | `/v1/support/tickets/{id}/triage` | Staff | Re-ejecutar borrador de triage con IA. |

Ver [Pedir ayuda](/es/everyone/get-help/) y [Admin → Soporte](/es/teams/admin/#support-tickets).

## Alertas de métricas (permisos de Teams)

Los endpoints siguen en `/v1/metric-alerts`. Teams cambia quién puede gestionar:

| Rol | Capacidad |
| --- | --- |
| `owner`/`editor` del artifact o `owner`/`admin` del workspace | Gestión completa de alertas en el artifact. |
| `member` del workspace o `viewer` del artifact | Solo auto-suscribirse a destinos personales. |

Mirá [Alertas de métricas](/es/guides/metric-alerts/).

## Metric watches

Watches de anomalía de un clic sobre tablas de artifacts — solo campana, sin destinos.
Ver [Alertas de métricas → Watches](/es/guides/metric-alerts/#metric-watches).

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `POST` | `/v1/metric-watch` | Viewer+ en el artifact | `{ "artifact_id", "table", "kind", "column?", "threshold_pct?" }` |
| `GET` | `/v1/metric-watch?artifact_id=` | Viewer+ | Listar watches de una página |
| `DELETE` | `/v1/metric-watch/{id}` | Creador | Quitar un watch |

## Features

```http
GET /v1/workspaces/{id}/features
```

Devuelve los flags habilitados/deshabilitados. `readonly: true` — solo los
super-admins de ShareOut pueden modificar los features del workspace.

## Política de publicación

```http
GET   /v1/workspaces/{id}/publish-policy
PATCH /v1/workspaces/{id}/publish-policy        ← { "policy": "require_approval", "approvals_required": 2 }
GET   /v1/workspaces/{id}/publish-approvals?status=pending
POST  /v1/artifacts/{id}/publish-approval       ← { "visibility": "public", "approver_ids": ["usr_a"] }
POST  /v1/artifacts/{id}/publish-approval/{requestId}/decision  ← { "decision": "approve" }
```

`PATCH` requiere `admin` u `owner`. Mirá [Política de publicación](/es/teams/admin/#politica-de-publicacion)
y [Publicar artifacts](/es/guides/publishing/#gobernanza-de-publicacion-del-workspace).

## Device login

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `POST` | `/v1/auth/device/start` | Público | Iniciar login CLI. Opcional `{ "expected_email" }` → `login_hint` + `warn` por mismatch. |
| `POST` | `/v1/auth/device/token` | Público | Poll con `{ "device_code" }`. Pending / approved / expired. Token una vez. |

Paso navegador: `GET /auth/device?code=USER-CODE` → Google OAuth. Ver
[Autenticación → Device login](/es/start/authentication/#device-login-cli--agentes).

## Search

Búsqueda rankeada y tolerante a typos — el mismo motor detrás de la paleta **⌘K**
en Home y del salto inline. Encuentra **páginas** (nombre, tags, descripción), más
**carpetas**, **datasets**, **conectores**, **personas**, **schedules**, **crew** y
**alertas** cuando está acotada a un workspace.

```http
GET /v1/search?q={query}&groups={csv}&limit={n}&workspace={id}
Authorization: Bearer {token}
```

| Parámetro | Default | Notas |
| --- | --- | --- |
| `q` | *(requerido)* | Texto de búsqueda. Tolerante a typos. Vacío devuelve recientes. |
| `groups` | todos | Subconjunto CSV de `artifacts,folders,datasets,connectors,people,schedules,crew,alerts`. |
| `limit` | 10 | Máx. por grupo (tope 25). |
| `workspace` | — | Alcance (solo tokens personales; los `sot_` quedan fijados a su workspace). |

Auth: token personal `so_…`, Agent `sot_…` (`artifacts:read`) o cookie de sesión.
Los grupos distintos de `artifacts` requieren alcance de workspace.

La respuesta agrupa (`artifacts`, `folders`, `datasets`, `connectors`, `people`,
`schedules`, `crew`, `alerts`) con hits puntuados. Los artifacts incluyen `views`,
`owner`, `thumb` y `badge` (ej. `Private`).

En el chat del asistente del workspace, la misma búsqueda se expone como
**`search_workspace`** — preferila sobre `search_artifacts` salvo para un nombre
exacto de página.

## Ask your workspace (paleta)

Q&A de un turno sobre páginas a las que el caller puede acceder — solo lectura, sin herramientas.

```http
POST /v1/ask
Authorization: Bearer {token}
Content-Type: application/json

{ "question": "¿Cuál fue el revenue de Q3?", "workspace": "wsp_…" }
```

Respuesta: `{ "answer": "…", "citations": [{ "artifact_id", "title", "url" }] }`.
Las citas son páginas que el modelo referenció con marcadores `[n]` del conjunto
acotado. También se dispara desde Home ⌘K cuando la consulta termina en `?`.

## Export

Portabilidad de datos de un clic — zip de source + json + tablas.

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `GET` | `/v1/artifacts/{id}/export` | Owner o admin del workspace | Zip de un artifact |
| `GET` | `/v1/workspaces/{id}/export` | Owner/admin del workspace | Todos los artifacts (máx. **200**) |

Ver [Tus datos son portables](/guides/data-portability/).

## Present this

Generar un deck de slides con IA desde un artifact HTML publicado.

```http
POST /v1/artifacts/{id}/present
Authorization: Bearer {token}
```

Devuelve `{ "artifact_id", "url" }`. Rate limit por usuario. Ver [Slides → Present this](/es/slides/overview/#present-this-deck-con-ia).

## Páginas sin uso (janitor)

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `POST` | `/v1/workspaces/{id}/unused/archive` | Owner/admin del workspace | Archivar todas las páginas marcadas (lote 100) |
| `POST` | `/v1/artifacts/unused/archive` | Dueño de cuenta personal | Igual para páginas personales |

Ver [Publicar → Janitor de páginas sin uso](/es/guides/publishing/#janitor-de-páginas-sin-uso).

## Skill Marketplace

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `GET` | `/v1/skills/recommended` | Logueado | Franja oficial **Recommended by ShareOut** (todos los planes). |
| `GET` | `/v1/skills/{skillId}/markdown` | Logueado | `SKILL.md` crudo para el visor en estudio (skill oficial o visible). |
| `GET` | `/v1/workspaces/{scope}/agent-skills` | Member+ | Skills adjuntos a **mi** agente (`scope` = id de workspace o `__personal`). |
| `POST` | `/v1/workspaces/{scope}/agent-skills` | Member+ | Adjuntar a mi agente (`skill_artifact_id`). Máx. 8. |
| `DELETE` | `/v1/workspaces/{scope}/agent-skills/{skillId}` | Member+ | Desadjuntar de mi agente. |
| `GET` | `/v1/workspaces/{id}/skills` | Member+ | Catálogo (`sort`, `category`, `q`). Plan Teams. |
| `GET` | `/v1/workspaces/{id}/skills/categories` | Member+ | Conteos por categoría. |
| `GET` | `/v1/workspaces/{id}/skills/installed` | Member+ | Skills guardados. |
| `POST`/`DELETE` | `/v1/artifacts/{id}/skill/vote` | Member+ | Upvote / quitar voto. |
| `POST`/`DELETE` | `/v1/artifacts/{id}/skill/install` | Member+ | Guardar / quitar de Mis Skills. |
| `PATCH` | `/v1/artifacts/{id}/skill/admin` | Admin+ | `{ "featured" }` o `{ "blocked" }`. |
| `GET` | `/v1/artifacts/{id}/skills` | Viewer+ | Skills adjuntos. |
| `POST` | `/v1/artifacts/{id}/skills` | Editor+ | Adjuntar skill (`skill_artifact_id`). Máx. 5. |
| `POST`/`DELETE` | `/v1/artifacts/{id}/skills/{skillId}` | Editor+ | Actualizar versión / desadjuntar. |

Publicá skills con `artifact_type: "skill"` en `POST /v1/publish`. Mirá
[Skill Marketplace](/es/teams/skill-marketplace/).

## LLM del workspace y crédito de IA

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/llm` | Member+ | Resumen de configuración del proveedor y estado de clave BYO. Sin secretos. |
| `PUT` | `/v1/workspaces/{id}/llm` | Admin+ | Guardar clave BYO OpenAI / Vercel AI Gateway. |
| `DELETE` | `/v1/workspaces/{id}/llm` | Admin+ | Quitar clave BYO. |

Las llamadas de IA usan la key que provee el workspace, facturada por ese
proveedor directamente.

## Actividad de Home

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `GET` | `/v1/home/activity-feed?workspace=&window=&limit=` | Member+ | Needs You + Pulse (`window`: `today`, `7d`, `30d`). Devuelve `needs`, `seen` (needs descartados/abiertos aún en la ventana), `pulse`, `actionItems`, `requestedOpen`. |
| `POST` | `/v1/home/dismiss-event` | Member+ | Ocultar eventos Needs You para el usuario (`{ "eventId" }` o `{ "eventIds": [] }`). Usado por el panel de notificaciones (descartar, marcar todo leído u abrir una tarjeta). |
| `GET` | `/v1/home/agent/brief?workspace=` | Member+ | Brief proactivo diario con IA (con `ai.web_agent` activo). |
| `POST` | `/v1/home/agent/chat` | Member+ | Chat del asistente en Home (SSE). |
| `POST` | `/v1/home/agent/confirm` | Member+ | Confirmar acción pendiente del asistente. |
| `GET` | `/v1/home/agent/threads` | Member+ | Listar hilos de chat nombrados. |
| `POST` | `/v1/home/agent/threads` | Member+ | Crear hilo. |
| `POST` | `/v1/home/agent/threads/{id}/rename` | Member+ | Renombrar hilo. |
| `DELETE` | `/v1/home/agent/threads/{id}` | Member+ | Eliminar hilo. |
| `POST` | `/v1/workspace/{id}/agent/chat` | Member+ | Chat del asistente acotado al workspace (SSE). |
| `GET` | `/v1/home/event-visibility?workspace=` | Member+ | Mapa de audiencia por tipo; `canManage` para admins. |
| `PUT` | `/v1/home/event-visibility?workspace=` | Admin+ | `{ "kind", "audience" }` — ver [Visibilidad de actividad](/es/teams/admin/#visibilidad-de-actividad). |
| `GET` | `/v1/home/onboarding?workspace=` | Member+ | Estado del checklist de configuración (`track`, `tasks`, `pct`, `dismissed`) o `{ track: null }`. |
| `POST` | `/v1/home/onboarding/dismiss?workspace=` | Member+ | Ocultar el checklist para este usuario. |
| `POST` | `/v1/home/onboarding/skill-ack?workspace=` | Member+ | Confirmar la tarea "Obtener el skill". |
| `POST` | `/v1/home/onboarding/celebrate?workspace=` | Member+ | Registrar el momento único del 100%. |
| `GET` | `/v1/artifacts/{id}/presence` | Owner/colaborador+ | Conteo concurrente de viewers (best-effort). |

## Entrega de artifacts (puntual)

Enviá un artifact a email, Slack o Telegram al instante desde el Inspector
**Deliver** en Home o por API — mismo registro de destinos que los jobs programados.

| Método | Endpoint | Quién | Notas |
| --- | --- | --- | --- |
| `GET` | `/v1/artifacts/{id}/deliver` | Colaborador+ | Estado por canal (`telegram.linked`, `slack.connected` + `connectUrl`, `email.available`). |
| `GET` | `/v1/artifacts/{id}/deliver/slack-channels` | Colaborador+ | Lista de canales buscable para la conexión Slack del workspace. |
| `POST` | `/v1/artifacts/{id}/deliver` | Colaborador+ | `{ "action": "email" \| "slack" \| "telegram", "config": {…} }` — mismo `config` que [jobs](/es/guides/jobs/). Los viewers solo pueden enviarse a sí mismos en Slack/Telegram. |

Ver [Tu workspace → Inspector](/es/everyone/your-workspace/#inspector-rail-derecho),
[Entrega a Slack](/es/integrations/slack/) y [Tu workspace (Home)](/es/everyone/your-workspace/).
