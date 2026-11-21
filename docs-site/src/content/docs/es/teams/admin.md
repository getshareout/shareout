---
title: Admin del workspace
description: Herramientas de admin para miembros, facturación, schedules, automaciones, alertas de métricas, features y tokens de miembros.
---

import { Aside } from '@astrojs/starlight/components';

Los roles `admin` y `owner` del workspace tienen visibilidad y control sobre
jobs del equipo, automaciones, alertas de métricas, feature flags, facturación y
tokens de miembros.

En Home, abrí el lente **Admin** en el rail izquierdo. Es el panel de control del
workspace — sin app de admin separada. Una barra lateral agrupa sus páginas por tema, y
Admin abre en **Miembros**:

| Grupo | Página | Qué gestionás |
| --- | --- | --- |
| Informes | **Resumen** | Cómo se usó el workspace, mes a mes. Solo el owner y los admins que elija ven esta página — ver [Resumen](#resumen) |
| Personas | **Miembros** | Barra de seats, **Invitar personas**, quitar, cambio de roles, invitaciones pendientes (reenviar, copiar enlace, revocar), actividad por miembro |
| Personas | **Compartir** | Compartir con externos — crear orgs de clientes con un flujo guiado, invitar a su gente, compartir carpetas con un nivel de acceso, recibos de lectura, tokens API acotados, **notas sobre cada cliente** (intel privada que el asistente recuerda) |
| Personas | **Soporte** | Tickets de soporte de tu workspace desde todos los canales — lista, hilo, editar el borrador de respuesta de la IA, **Aprobar y enviar**, resolver |
| Contenido | **Artefactos** | Tabla de gobernanza ordenable — nombre, owner, fechas, vistas, visitantes, visibilidad, estado; filtro por visibilidad; pausar/reanudar, cambiar visibilidad, **reasignar owner** |
| Contenido | **Automatizaciones** | Trabajos programados, automatizaciones de tareas de IA y los conectores de datos que usan, como tablas ordenables con ejecutar ahora, habilitar/deshabilitar e historial |
| IA y facturación | **Facturación** | Cuánto gasta el workspace, el presupuesto mensual de IA, el reporte de IA, las facturas y los datos de facturación — ver [Facturación](#facturación) |
| IA y facturación | **IA y modelos** | El modelo de IA que usa el workspace, tu propia clave de proveedor (OpenAI / Vercel Gateway), gasto, requests y tokens por modelo |
| Seguridad | **Acceso** | **Solicitudes de acceso** (aprobar/denegar), dominios permitidos para la membresía (preserva emails explícitos al guardar), duración de la sesión |
| Seguridad | **Publicación** | Aprobaciones de publicación que esperan por vos, y la política de publicación |
| Seguridad | **Tokens de agentes** | Tokens de agente del workspace (`sot_`) — crear y revocar |
| Seguridad | **Registro de actividad** | El feed del **registro de auditoría**, solo de agregado |
| Espacio de trabajo | **General** | Idioma, si los miembros pueden crear carpetas del espacio de equipo, la dirección de la **bandeja de archivos** (`{slug}@<dominio de inbox>`), feature flags de solo lectura |
| Espacio de trabajo | **Marca** | Logo del workspace, color de acento, ocultar el pie en los artefactos compartidos |
| Espacio de trabajo | **Dominio propio** | Publicá tus artefactos en tu propio dominio — ver [Dominio propio](/es/teams/custom-domain/) |

Un badge en una entrada de la barra cuenta lo que espera por vos ahí: invitaciones
pendientes (Miembros), solicitudes de acceso (Acceso), aprobaciones de publicación
(Publicación), automatizaciones que fallan (Automatizaciones), facturas sin pagar y un
presupuesto mensual de IA cerca del límite o alcanzado (Facturación). Schedules, Alerts y
Crew AI también tienen sus propios lentes en Home.

Enlazá una página directo con `#l/admin/<página>` (por ejemplo `#l/admin/billing`) o
`/home?view=admin&tab=<página>`. Claves de página: `summary`, `members`, `clients`
(Compartir), `support`, `artifacts`, `automation`, `billing`, `ai`, `access`,
`publishing`, `tokens`, `audit`, `general`, `branding`, `domains`. Los nombres de pestaña
viejos siguen andando: `overview` y `people` abren Miembros, `usage` abre Facturación,
`security` abre Acceso, `settings` abre General.

### API de gobernanza de artefactos

```http
GET  /v1/workspaces/{id}/admin/artifacts
POST /v1/workspaces/{id}/admin/artifacts/{artifactId}/pause       ← { "paused": true }
POST /v1/workspaces/{id}/admin/artifacts/{artifactId}/visibility ← { "visibility": "workspace" }
POST /v1/workspaces/{id}/admin/artifacts/{artifactId}/transfer   ← { "new_owner_id": "usr_…" }
```

`GET` devuelve hasta 200 artefactos del workspace con owner, vistas, visitantes,
tamaño y última actualización. Todas las rutas `POST` requieren `admin` u `owner`.

### Tickets de soporte

La página **Soporte** es el workbench del equipo para tickets de clientes. Un ticket
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

Las invitaciones pendientes están en **Miembros**; los pedidos de acceso, en **Acceso**.
Aprobar un pedido de acceso otorga membresía según tu
[política de membresía](/es/teams/workspaces/#política-de-membresía).

### Run Inspector

Historial unificado de ejecuciones de crew triggers, jobs programados y alertas
de métricas. Los admins listan y abren cualquier run con un ledger paso a paso
(fases fetch, transform, deliver):

```http
GET /v1/workspaces/{id}/runs?surface=job&status=failed&limit=50
GET /v1/workspaces/{id}/runs/{surface}/{runId}
```

`surface` es `crew`, `job` o `alert`. El widget **Runs** de Home y la página
Automatizaciones enlazan a los mismos datos.

## Resumen

**Admin → Resumen** es un informe mes a mes de cómo se usó el workspace. Elegí un mes y ves:

- **Personas activas**, **Vistas de artefactos**, **Publicaciones** y **Preguntas a la IA**,
  cada una comparada con el mes anterior
- **Lectura** — vistas de personas con sesión, día por día (cuando el autor abre su
  propio artefacto no cuenta), el total con las vistas anónimas, y los artefactos más leídos
- **Artefactos y conocimiento** — lo que tiene el workspace a fin de mes y qué cambió
- **IA y automatizaciones** — preguntas a la IA, miembros que la usan, gasto de IA,
  ejecuciones de trabajos programados y de tareas de IA, emails enviados
- **Por miembro** — qué hizo cada miembro ese mes
- **Lectores fuera del equipo** — personas que no son miembros y abrieron un artefacto que
  les compartieron

**Quién lo ve.** El owner del workspace siempre. El owner elige qué admins también, en
**Quién lo ve** (hasta 50); los demás admins no ven la página en su barra lateral, y los
miembros nunca. Los operadores de la instancia también pueden abrirlo.

```http
GET /v1/workspaces/{id}/summary?month=YYYY-MM   ← el informe (por defecto: este mes)
GET /v1/workspaces/{id}/summary/access          ← { can_view, can_manage }
GET /v1/workspaces/{id}/summary/viewers         ← owner: los admins, cada uno con can_view
PUT /v1/workspaces/{id}/summary/viewers         ← owner: { "user_ids": ["usr_…"] } reemplaza la lista
```

Un mes mal escrito es `400 INVALID_MONTH`; quien no tiene acceso recibe `403`. Los tokens
de agente se rechazan.

## Facturación

**Admin → Facturación** es una sola página para owners y admins. Todos los montos son lo
que paga el workspace. De arriba hacia abajo:

1. **Gasto** — este mes (o **Mes pasado**): lo que gastó el workspace hasta ahora, la
   **Proyección a fin de mes** y el **Mes anterior**, y después **Por categoría**
   (Almacenamiento, Visitas, Automatizaciones, IA, Email, Navegador) y **Por día**.
   **Descargar CSV** exporta el mes. La IA está al día; las otras categorías se actualizan
   cada noche, así que el consumo de hoy aparece mañana.
2. **Presupuesto mensual de IA** — un tope para cada llamada de IA del workspace
   (preguntas, automatizaciones, Knowledge, resúmenes). Escribí un monto en
   **Presupuesto mensual (USD)** y tocá **Guardar**; **Quitar presupuesto** lo saca. Al 80%
   dice **Cerca del límite** y la entrada Facturación de la barra lateral muestra un badge.
   Cuando se alcanza, el trabajo nuevo con IA queda en pausa hasta el primer día del mes
   siguiente (UTC). La búsqueda, los embeddings, la transcripción de audio y los chequeos de
   seguridad al publicar nunca se pausan. Al lado, **IA por tipo** muestra en qué se fue la
   IA del mes, y **Hoy** muestra los tokens que usaron hoy cada miembro y las
   automatizaciones del workspace en el agente dentro de los artefactos, contra su tope
   diario (se reinicia a medianoche UTC).
3. **Reporte de IA** — un mes de IA, por uso, por modelo (tokens de entrada y salida), por
   automatización, por artefacto, por persona, cada tipo de llamada y por día, con
   **Descargar CSV**. Su total es el mismo que el del presupuesto y el de la factura.
4. **Facturas** — las facturas emitidas al workspace, cada una con su estado (**Sin
   pagar**, **Pagada**, **Anulada**), el vencimiento, la factura para descargar y **Cómo
   pagar**. Para pagar una:
   1. Pagá por transferencia bancaria con los datos de la factura.
   2. En la factura, tocá **Adjuntar comprobante de transferencia** y elegí el comprobante
      (PDF, PNG, JPG o WEBP, hasta 10 MB) — o respondé el mail de la factura con el
      comprobante adjunto.
   3. La factura queda **Pagada**, y quien la emitió recibe el aviso.

   Si el archivo se rechaza, revisá el tipo y el tamaño. Un comprobante por mail solo
   cuenta si la respuesta viene del email de facturación o de un owner o admin, con el
   comprobante como adjunto.
5. **Datos de facturación** — a nombre de quién salen las facturas: país, razón social,
   identificación fiscal (en Argentina, CUIT, condición frente al IVA y domicilio fiscal),
   localidad, provincia, código postal, teléfono y un email de facturación opcional. Los
   mails de facturas van al email de facturación o, si no hay, a los owners y admins.

```http
GET /v1/workspaces/{id}/spend?month=YYYY-MM[&format=csv]       ← admin+
GET /v1/workspaces/{id}/ai-limits                               ← presupuesto, gasto por tipo, topes de hoy
PUT /v1/workspaces/{id}/llm/budget        ← { "monthlyBudgetUsd": 100 } (mayor a 0, hasta 100000) o null
GET /v1/workspaces/{id}/ai-report?month=YYYY-MM[&format=csv]   ← admin+
GET /v1/workspaces/{id}/invoices                                ← admin+
PUT /v1/workspaces/{id}/invoices/{invoiceId}/proof              ← el archivo en el body: la marca pagada
GET /v1/workspaces/{id}/billing-profile                         ← admin+
PUT /v1/workspaces/{id}/billing-profile   ← el perfil entero; un 400 lista cada campo rechazado
```

Un `month` mal escrito es `400 INVALID_MONTH`. Los tokens de agente se rechazan en todas
las rutas de facturación. Una llamada rechazada porque se alcanzó el presupuesto trae el
código `workspace_budget`.

## Schedules

Administrá todos los jobs programados a lo largo de los artefactos del workspace:

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

Administrá automaciones de crew triggers en los artefactos:

| Método | Endpoint | Descripción |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/automations` | Listar todos los crew triggers. |
| `GET` | `/v1/workspaces/{id}/automations/{triggerId}/runs` | Historial de ejecuciones. |
| `POST` | `/v1/workspaces/{id}/automations/{triggerId}/run` | Despachar ahora. |
| `PATCH` | `/v1/workspaces/{id}/automations/{triggerId}` | Cambiar el trigger (`enabled`, `cron`) o la tarea que corre (`name`, `instructions`, `model`, `maxIterations`, `runBudgetMicroUsd`). Mandá solo los campos que cambian. |
| `DELETE` | `/v1/workspaces/{id}/automations/{triggerId}` | Eliminar trigger. |

## Alertas de métricas

Los endpoints de alertas de métricas siguen en `/v1/metric-alerts`. Teams
cambia quién puede hacer qué:

| Rol | Capacidad |
| --- | --- |
| `owner`/`editor` del artefacto o `owner`/`admin` del workspace | Gestión completa de alertas sobre el artefacto. |
| `member` del workspace o `viewer` del artefacto | Solo auto-suscribirse a destinos personales. |

Referencia completa: [Alertas de métricas](/es/guides/metric-alerts/).

## Features

Consultá los feature flags habilitados/deshabilitados para el workspace.
Cualquier miembro puede verlos (los admins los ven, de solo lectura, en
**Admin → General → Funciones**); solo los super-admins de ShareOut pueden
modificarlos.

Flags destacados:

| Clave | Por defecto | Efecto |
| --- | --- | --- |
| `ai.web_agent` | off | [Asistente del workspace](/es/teams/workspace-assistant/) en el home |
| `ai.version_summaries` | on | **Version change notes** — una nota de IA de una línea sobre "qué cambió" para las versiones publicadas sin mensaje, en Historial y Detalles. Mirá [Historial de versiones](/es/everyone/version-history/#notas-de-cambios) |

```http
GET /v1/workspaces/{workspaceId}/features
Authorization: Bearer {token}
```

La respuesta incluye `readonly: true` para indicar que los miembros del
workspace no pueden cambiar los flags.

## Tokens de miembros

Los admins y owners pueden crear tokens de API para miembros cuenta de servicio
y revocar los tokens personales (y apps conectadas) de un miembro:

```http
POST   /v1/workspaces/{workspaceId}/members/{userId}/tokens
DELETE /v1/workspaces/{workspaceId}/members/{userId}/tokens
```

Las personas crean sus propios tokens; un admin no puede crear uno para una
persona. No se puede revocar al owner ni a miembros con un rol superior al tuyo.
Útil para automatizar el onboarding o revocar acceso de miembros que se van.

## Política de publicación

Controlá si los miembros del workspace pueden llevar un artefacto a visibilidad
`public`. La revisión de seguridad de la plataforma sigue
corriendo encima — esto es una capa de gobernanza interna.

```http
GET  /v1/workspaces/{id}/publish-policy
PATCH /v1/workspaces/{id}/publish-policy        ← { "policy": "require_approval", "approvals_required": 2 }
```

| Política | Efecto |
| --- | --- |
| `allow` | Por defecto. Los miembros publican en abierto libremente. |
| `prohibit` | Los miembros no pueden ir a abierto; los artefactos quedan en `workspace`. |
| `require_approval` | Quedan en `workspace` hasta que N miembros nominados aprueben (1–10). |

`GET` requiere membresía del workspace; `PATCH` requiere `admin` u `owner`.

Con `require_approval`, los miembros cuyo publish queda retenido reciben
`approval_required` en la respuesta y deben nominar aprobadores vía
`POST /v1/artifacts/{id}/publish-approval`. Los aprobadores actúan con
`POST …/publish-approval/{requestId}/decision`. Listá la cola con
`GET /v1/workspaces/{id}/publish-approvals?status=pending`.

Flujo completo: [Publicar artefactos](/es/guides/publishing/#gobernanza-de-publicación-del-workspace)
y [Política de artefactos públicos](/es/public-artifacts/overview/).

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
| `self` | Solo el actor (y owners del artefacto para sus artefactos) |
| `members` | Todos los miembros del workspace |
| `admins` | Solo owners y admins del workspace |
| `off` | Suprimido en este workspace |

`GET` devuelve cada tipo con label, tier (`actionable` → fila Needs You,
`ambient` → conteo Pulse), default y audiencia efectiva. `PUT` requiere
`admin` u `owner`. Los runs fallidos de jobs/crew aparecen en **Needs You**
aunque el tipo `run` sea ambient en Pulse.

Ver [Tu workspace (Home)](/es/everyone/your-workspace/#inicio).

## Archivos de contexto (Guidance en Knowledge)

Los archivos de contexto del workspace (estilo para agentes) ahora viven en el lens
**Knowledge**, rama **Guidance** — no en una página Admin separada. Los admins crean,
editan (≤ 64 KB, `.md` en minúsculas), definen el entry point o eliminan archivos ahí.
Los miembros pueden leer.

Las rutas REST están en [Workspaces](/es/teams/workspaces/#archivos-de-contexto-de-workspace)
y [Conocimiento del workspace](/es/teams/knowledge/).

<Aside type="tip">
El lente Admin en Home expone la mayoría de lo anterior como páginas de su barra
lateral. Las rutas REST te permiten automatizar las mismas operaciones.
</Aside>
