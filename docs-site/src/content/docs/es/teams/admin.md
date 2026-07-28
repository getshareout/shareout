---
title: Admin del workspace
description: Herramientas de admin para schedules, automaciones, alertas de métricas, features y tokens de miembros.
---

import { Aside } from '@astrojs/starlight/components';

Los roles `admin` y `owner` del workspace tienen visibilidad y control sobre
jobs del equipo, automaciones, alertas de métricas, feature flags y tokens de
miembros.

En Home, abrí el lente **Admin** en el rail izquierdo. Es un panel de control del
workspace con diez pestañas — sin app de admin separada:

| Pestaña | Qué gestionás |
| --- | --- |
| **Overview** | Badge del plan, barra de seats, tiles de storage/vistas/visitantes, alertas accionables (invites pendientes, runs fallidos, páginas pausadas) con enlaces a otras pestañas |
| **Artifacts** | Tabla de gobernanza ordenable — nombre, owner, fechas, vistas, visitantes, visibilidad, estado; filtro por visibilidad; pausar/reanudar, cambiar visibilidad, **reasignar owner** |
| **Members** | Barra de utilización de seats, invitar/quitar, cambio de roles, invites pendientes, **cola de pedidos de acceso** (aprobar/denegar), métricas de actividad por miembro |
| **Compartir** | Compartir con externos — crear orgs de clientes con un flujo guiado, invitar a su gente, compartir carpetas con un nivel de acceso, recibos de lectura, tokens API acotados, **notas sobre cada cliente** (intel privada que el asistente recuerda) |
| **Automation** | Schedules y crew triggers como tablas ordenables con ejecutar ahora, habilitar/deshabilitar e historial |
| **AI** | Gasto/balance/requests/tokens, uso por modelo, gestión de clave LLM propia (OpenAI / Vercel Gateway) |
| **Security** | Editor de dominios permitidos (preserva emails explícitos al guardar), feed del **audit log** |
| **Support** | Tickets de soporte de tu workspace desde todos los canales — lista, hilo, editar el borrador de respuesta de la IA, **Aprobar y enviar**, resolver |
| **Settings** | Política de publicación, logo del workspace (branding), dirección del **inbox de archivos** (`{slug}@inbox.shareout.site`), feature flags de solo lectura |

Los enlaces rápidos desde Overview saltan a la pestaña que necesita atención.
Schedules, Alerts y Crew AI también tienen sus propios lentes en Home.

### API de gobernanza de artifacts

```http
GET  /v1/workspaces/{id}/admin/artifacts
POST /v1/workspaces/{id}/admin/artifacts/{artifactId}/pause       ← { "paused": true }
POST /v1/workspaces/{id}/admin/artifacts/{artifactId}/visibility ← { "visibility": "workspace" }
POST /v1/workspaces/{id}/admin/artifacts/{artifactId}/transfer   ← { "new_owner_id": "usr_…" }
```

`GET` devuelve hasta 200 artifacts del workspace con owner, vistas, visitantes,
tamaño y última actualización. Todas las rutas `POST` requieren `admin` u `owner`.

### Tickets de soporte

La pestaña **Support** es el workbench del equipo para tickets de clientes. Un ticket
puede llegar desde cualquier canal — el botón de Ayuda in-app, la API REST, el bot de
Slack o Telegram, o email — y aparece como un solo hilo. Al abrirse, una IA lo **triagea**
(categoría + prioridad) y **redacta una respuesta**. Nunca se envía nada en automático:
un `admin` u `owner` revisa el borrador, lo edita y toca **Aprobar y enviar**, que entrega
la respuesta por el canal de origen del ticket y lo marca como pendiente. Una respuesta del
cliente reabre el ticket; **Resolver** lo cierra (y avisa por email al cliente cuando es
posible). Los tickets resueltos se cierran solos tras 7 días inactivos.

```http
GET  /v1/support/tickets?scope=workspace&workspace={id}    ← admins/owners; &status= opcional
GET  /v1/support/tickets/{ticketId}                        ← ticket + hilo completo
POST /v1/support/tickets/{ticketId}/reply    ← { "body": "…" }  aprobar y enviar
POST /v1/support/tickets/{ticketId}/status   ← { "status": "resolved" }
POST /v1/support/tickets/{ticketId}/assign   ← { "assigneeUserId": "usr_…" }
```

Los usuarios finales ven y siguen **sus propios** tickets desde el botón de **Ayuda** en
Home — sin necesidad de acceso de admin.

### Invites pendientes y pedidos de acceso

```http
GET  /v1/workspaces/{id}/invites
DELETE /v1/workspaces/{id}/invites/{inviteId}
GET  /v1/access-requests/incoming
POST /v1/access-requests/{requestId}   ← { "action": "approve" | "deny" }
```

La pestaña Members muestra ambas colas. Aprobar un pedido de acceso otorga
membresía según tu [política de membresía](/es/teams/workspaces/#politica-de-membresia).

### Run Inspector

Historial unificado de ejecuciones de crew triggers, jobs programados y alertas
de métricas. Los admins listan y abren cualquier run con un ledger paso a paso
(fases fetch, transform, deliver):

```http
GET /v1/workspaces/{id}/runs?surface=job&status=failed&limit=50
GET /v1/workspaces/{id}/runs/{surface}/{runId}
```

`surface` es `crew`, `job` o `alert`. El widget **Runs** de Home y la pestaña
Automation enlazan a los mismos datos.

## Schedules

Administrá todos los jobs programados a lo largo de los artifacts del workspace:

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/schedules` | Listar todos los schedules del workspace. |
| `GET` | `/v1/workspaces/{id}/schedules/{jobId}/logs` | Logs recientes del schedule. |
| `POST` | `/v1/workspaces/{id}/schedules/{jobId}/run` | Ejecutar inmediatamente. |
| `PATCH` | `/v1/workspaces/{id}/schedules/{jobId}` | Habilitar o deshabilitar. |
| `DELETE` | `/v1/workspaces/{id}/schedules/{jobId}` | Eliminar schedule. |

Los payloads de jobs (email, webhook, materialize) están documentados en la
[guía de Jobs](/es/guides/jobs/).

## Automaciones

Administrá automaciones de crew triggers en los artifacts:

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/automations` | Listar todos los crew triggers. |
| `GET` | `/v1/workspaces/{id}/automations/{triggerId}/runs` | Historial de ejecuciones. |
| `POST` | `/v1/workspaces/{id}/automations/{triggerId}/run` | Despachar ahora. |
| `PATCH` | `/v1/workspaces/{id}/automations/{triggerId}` | Habilitar o deshabilitar. |
| `DELETE` | `/v1/workspaces/{id}/automations/{triggerId}` | Eliminar trigger. |

## Alertas de métricas

Los endpoints de alertas de métricas siguen en `/v1/metric-alerts`. Teams
cambia quién puede hacer qué:

| Rol | Capacidad |
| --- | --- |
| `owner`/`editor` del artifact o `owner`/`admin` del workspace | Gestión completa de alertas sobre el artifact. |
| `member` del workspace o `viewer` del artifact | Solo auto-suscribirse a destinos personales. |

Referencia completa: [Alertas de métricas](/es/guides/metric-alerts/).

## Features

Consultá los feature flags habilitados/deshabilitados para el workspace.
Cualquier miembro puede verlos; solo los super-admins de ShareOut pueden
modificarlos.

Flags destacados:

| Clave | Por defecto | Efecto |
| --- | --- | --- |
| `ai.web_agent` | off | [Asistente del workspace](/es/teams/workspace-assistant/) en el home |

```http
GET /v1/workspaces/{workspaceId}/features
Authorization: Bearer {token}
```

La respuesta incluye `readonly: true` para indicar que los miembros del
workspace no pueden cambiar los flags.

## Tokens de miembros

Los admins y owners pueden crear o revocar tokens de API para miembros del
workspace:

```http
POST   /v1/workspaces/{workspaceId}/members/{userId}/tokens
DELETE /v1/workspaces/{workspaceId}/members/{userId}/tokens
```

Útil para automatizar el onboarding o revocar acceso de miembros que se van.

## Política de publicación

Controlá si los miembros del workspace pueden llevar un artifact a visibilidad
`public`. La revisión de seguridad de la plataforma sigue
corriendo encima — esto es una capa de gobernanza interna.

```http
GET  /v1/workspaces/{id}/publish-policy
PATCH /v1/workspaces/{id}/publish-policy        ← { "policy": "require_approval", "approvals_required": 2 }
```

| Política | Efecto |
| --- | --- |
| `allow` | Por defecto. Los miembros publican en abierto libremente. |
| `prohibit` | Los miembros no pueden ir a abierto; los artifacts quedan en `workspace`. |
| `require_approval` | Quedan en `workspace` hasta que N miembros nominados aprueben (1–10). |

`GET` requiere membresía del workspace; `PATCH` requiere `admin` u `owner`.

Con `require_approval`, los miembros cuyo publish queda retenido reciben
`approval_required` en la respuesta y deben nominar aprobadores vía
`POST /v1/artifacts/{id}/publish-approval`. Los aprobadores actúan con
`POST …/publish-approval/{requestId}/decision`. Listá la cola con
`GET /v1/workspaces/{id}/publish-approvals?status=pending`.

Flujo completo: [Publicar artifacts](/es/guides/publishing/#gobernanza-de-publicacion-del-workspace)
y [Política de artifacts públicos](/es/public-artifacts/overview/).

## Visibilidad de actividad

Los owners y admins del workspace controlan **quién ve cada tipo de actividad** en el
feed Activity de Home (Needs You + Pulse). Los defaults priorizan privacidad — por
ejemplo, vistas y favoritos son solo `self`; pedidos de acceso son solo `admins`.

```http
GET /v1/home/event-visibility?workspace={workspaceId}
PUT /v1/home/event-visibility?workspace={workspaceId}
Authorization: Bearer {token}
Content-Type: application/json

{ "kind": "view", "audience": "members" }
```

| Audiencia | Quién ve el tipo |
| --- | --- |
| `self` | Solo el actor (y owners del artifact para sus páginas) |
| `members` | Todos los miembros del workspace |
| `admins` | Solo owners y admins del workspace |
| `off` | Suprimido en este workspace |

`GET` devuelve cada tipo con label, tier (`actionable` → fila Needs You,
`ambient` → conteo Pulse), default y audiencia efectiva. `PUT` requiere
`admin` u `owner`. Los runs fallidos de jobs/crew aparecen en **Needs You**
aunque el tipo `run` sea ambient en Pulse.

Ver [Tu workspace (Home)](/es/everyone/your-workspace/#brief--needs-you-y-pulse).

## Archivos de contexto (Guidance en Knowledge)

Los archivos de contexto del workspace (estilo para agentes) ahora viven en el lens
**Knowledge**, rama **Guidance** — no en una pestaña Admin separada. Los admins crean,
editan (≤ 64 KB, `.md` en minúsculas), definen el entry point o eliminan archivos ahí.
Los miembros pueden leer.

Las rutas REST están en [Workspaces](/es/teams/workspaces/#archivos-de-contexto-de-workspace)
y [Conocimiento del workspace](/es/teams/knowledge/).

<Aside type="tip">
El lente Admin en Home expone la mayoría de lo anterior como pestañas nativas. Las
rutas REST te permiten automatizar las mismas operaciones.
</Aside>
