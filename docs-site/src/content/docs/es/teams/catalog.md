---
title: Catálogo de datos
description: Un mapa opcional de los datos de tu workspace — fuentes, datasets, linaje, glosario — que los agentes mantienen al día y consultan al construir.
---

El **Catálogo de datos** es un mapa opcional, por workspace, de tus datos: sus **fuentes,
datasets, pipelines, dashboards, modelos, métricas y términos de negocio**. Se escribe como
archivos planos de markdown + YAML, lo mantienen al día sobre todo los agentes, y se lee de
dos formas — las personas lo navegan y buscan; el asistente de autoría lo consulta para usar
nombres de tabla reales, preferir datos **certificados** — avalados por un propietario o
administrador del espacio — y evitar fuentes **obsoletas**.

Es **opcional y orientativo**. Un workspace sin catálogo funciona igual que antes, y el
catálogo nunca bloquea nada — informa. Actívalo cuando quieras sacarle más a tus datos.

## Activarlo

Abrí un workspace y elegí **Catálogo** en la navegación lateral. Un owner o admin ve un botón
**Activar**. Una vez activado, podés **sembrarlo** automáticamente desde las conexiones que ya
tiene el workspace — cada conexión se vuelve una entrada `source` inicial que vos (o un agente)
podés completar.

Con el catálogo ya activo, las **conexiones nuevas se siembran solas** al crearlas — cada
conexión pasa a ser una entrada `source` sin un clic manual de seed. Las escrituras de datasets
(jobs de materialize, updates de tabla/json) también pueden agregar **aristas de linaje** a
entradas del catálogo cuando está habilitado.

```http
POST /v1/workspaces/{workspaceId}/catalog/enable
Authorization: Bearer {token}
Content-Type: application/json

{ "enabled": true }
```

```http
POST /v1/workspaces/{workspaceId}/catalog/seed
Authorization: Bearer {token}
```

Volver a sembrar es idempotente y **nunca pisa** una entrada editada a mano.

Las entradas `source` sembradas usan el id de la conexión (`conn.<connectionId>`), así que
renombrar un conector nunca rompe un enlace. Las que se sembraron antes usaban el nombre
(`conn.<slug-del-nombre>`); ese id queda en la entrada como alias y sigue resolviendo.

## Qué contiene

Un archivo markdown describe un activo. El frontmatter YAML guarda los metadatos; el cuerpo
son notas. Solo tres campos son obligatorios — **kind**, **id**, **title** — y todo lo demás
es opcional, completado con el tiempo.

```markdown
---
kind: source              # source · event · dataset · table · view · pipeline · dashboard · model · metric · term
id: events_silver.chat_sent
title: Chat Sent
status: deprecated        # opcional: draft · deprecated (la certificación no es un campo — ver abajo)
owner: data-platform
domain: chat
tags: [tier.silver, PII.None]
upstream: [warehouse.clustered_events]
downstream: [pipelines.engagement_metrics]
connection: snowflake-prod
fqn: analytics-platform.events_silver.chat_sent
---

# Chat Sent
Qué es, detalles a tener en cuenta, una consulta de ejemplo.
```

### Tipos de entrada

| Kind | Para qué |
| --- | --- |
| `source` | Datos externos detrás de una [conexión del workspace](/es/teams/connections/) — `connection` + `fqn` |
| `event` | Eventos crudos de analytics o telemetría (a menudo upstream de tablas y pipelines) |
| `dataset` | Datos que crean tus artefactos — `artifact` + `store` (ej. `table:daily_metrics`) |
| `table`, `view`, `pipeline`, `dashboard`, `model`, `metric` | Activos más finos en tu data mesh |
| `term` | Entrada de glosario — otros activos enlazan con `terms: [active-user]` |

Las aristas `upstream` / `downstream` cruzan planos libremente — por ejemplo un `dataset` de
artefacto cuyo `upstream` es un `source` de conector. Declarás la arista en cualquiera de las
dos puntas: el catálogo lee ambas, así que una fuente a la que solo apuntan sus datasets igual
los muestra aguas abajo (y no cuenta como huérfana). `aliases: [id.anterior]` mantiene
funcionando los enlaces al id viejo de una entrada.

### Mapea los dos tipos de datos

- **Datos externos** — todo lo que está detrás de una conexión del workspace (Snowflake,
  BigQuery, Sheets, Shopify…). Son entradas `source` con `connection` y `fqn`.
- **Datos que crean tus artefactos** — tablas y JSON guardados dentro de un artefacto. Son
  entradas `dataset`. El linaje une ambos, así podés ver los datos de un dashboard trazados
  hasta la tabla del warehouse que los alimenta.

## Certificación

**Certificada** quiere decir que un **propietario o administrador** del espacio avaló una
versión exacta de la entrada. Es una decisión con nombre y fecha, no una línea del archivo:
escribir `status: certified` por tu cuenta no certifica nada — la entrada sigue en borrador.

En el lente **Catálogo**, abrí una entrada: propietarios y administradores ven **Certificar
entrada**, **Revocar certificación** y **Marcar como obsoleta**, con una nota opcional
("Coincide con la plataforma de anuncios en marzo"). Todos ven quién la certificó, cuándo y
el historial completo.

- **Si editás una entrada certificada**, aparece **cambió desde la certificación**: cuenta como
  borrador hasta que alguien certifique la versión nueva.
- **Las métricas** quedan atadas solo a su definición (qué calculan y cómo se muestran).
  Corregir la descripción, los sinónimos, los ejemplos o las notas no les quita la
  certificación.
- **Obsoleta** se mantiene aunque edites la entrada, hasta que un propietario o administrador
  la vuelva a certificar o la devuelva a borrador.
- **Certificar es una decisión de una persona.** Hace falta un propietario o administrador
  con la sesión iniciada en ShareOut. Los tokens — personales, de Agente o de MCP — reciben
  `403 SESSION_REQUIRED`: un agente puede redactar y proponer, pero nunca certificar su
  propio trabajo.

Esta es la llamada que hace el lente Catálogo, desde la sesión de un propietario o
administrador:

```http
POST /v1/workspaces/{workspaceId}/catalog/entries/{entryId}/certify
Content-Type: application/json

{ "decision": "certified", "note": "Coincide con la plataforma de anuncios en marzo", "content_hash": "…" }
```

`decision` es `certified`, `revoked` o `deprecated`. El `content_hash` es el
`certification.content_hash` de la entrada que revisaste: si alguien la editó mientras
tanto, recibís `409 CONFLICT` en lugar de certificar una versión que nadie miró. Los
miembros reciben `403`.

## Navegar el catálogo

El lente **Catálogo** está pensado para workspaces grandes (1.600+ entradas):

- **Vista de lista** — franja de KPIs (entradas, eventos, % certificado, % documentado,
  huérfanos), búsqueda instantánea, filtros por kind/dominio/estado y una **tabla densa
  ordenable** (nombre, kind, dominio, estado, origen, conteos de linaje). Clic en el encabezado
  de columna para ordenar. Las entradas editadas después de certificarse llevan la marca
  **cambió**.
- **Vista de entrada** — estado, certificación (quién, cuándo, nota, historial), grilla de
  metadatos, cuerpo de notas y **tablas de linaje navegables** para vecinos upstream y
  downstream. Clic en cualquier vecino catalogado para saltar a su
  entrada; referencias sin catalogar aparecen como nodos punteados.

### Deep links

Marcá o compartí una vista del catálogo desde Home:

| Hash | Abre |
| --- | --- |
| `#l/catalog` | Lista del catálogo |
| `#l/catalog/{entryId}` | Una entrada específica |

## Por qué ayuda al asistente

Cuando un workspace tiene catálogo, el asistente de autoría lo consulta antes de construir —
así usa los nombres de tabla correctos, prefiere los datos que un propietario o administrador
**certificó** (y puede decirte quién y cuándo), y te avisa antes de apoyarse en algo
**obsoleto** o que cambió desde su certificación. Es una pista, nunca una regla rígida: vos
mantenés el control.

El asistente tiene tools de solo lectura: **`catalog_search`** (filtrar por query, kind,
dominio, estado, tag) y **`catalog_get`** (entrada completa + linaje). Ambos devuelven
`{ enabled: false }` cuando el catálogo está apagado.

## Mantenerlo al día

Los agentes hacen crecer el catálogo como un wiki — agregando y actualizando entradas a medida
que aprenden sobre tus datos. Volver a sembrar desde las conexiones es seguro: nunca pisa una
entrada editada a mano. El auto-seed en conexiones nuevas sigue la misma regla — las entradas
editadas a mano se dejan intactas. Las métricas de la lista (entradas huérfanas, entradas desactualizadas)
te muestran dónde el mapa está flojo.

### Crecer vía API

Cualquier miembro del workspace (o token de agente) puede hacer upsert de archivos:

```http
PUT /v1/workspaces/{workspaceId}/catalog/files
Authorization: Bearer {token}
Content-Type: application/json

{ "path": "sources/orders.md", "content": "---\nkind: source\nid: orders\n---\n..." }
```

```http
DELETE /v1/workspaces/{workspaceId}/catalog/files?path=sources/orders.md
Authorization: Bearer {token}
```

`path` es una ruta relativa a un `.md`, como `sources/orders.md`: letras, dígitos, `.`,
`_` y `-`, cada nombre empieza con letra o dígito, sin `..`, hasta 4 niveles y 200
caracteres (si no, `400 INVALID_PATH`). `content` pesa como máximo 128 KB
(`413 FILE_TOO_LARGE`).

## API REST

Todas las rutas requieren membresía del workspace. Un catálogo desactivado devuelve
`{ "enabled": false }` — nunca un error.

| Método | Endpoint | Quién | Propósito |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/catalog` | Member+ | Búsqueda (`q`, `kind`, `domain`, `status`, `tag`) + facetas |
| `GET` | `/v1/workspaces/{id}/catalog/manifest` | Member+ | Conteos, KPIs de adopción, huérfanos, refs colgantes, staleness |
| `GET` | `/v1/workspaces/{id}/catalog/entries/{entryId}` | Member+ | Una entrada + vecinos de linaje + historial de certificación |
| `POST` | `/v1/workspaces/{id}/catalog/entries/{entryId}/certify` | Admin+, con sesión iniciada | `{ decision, note?, content_hash? }` — certificar, revocar o marcar obsoleta; los tokens reciben `403 SESSION_REQUIRED` |
| `GET` | `/v1/workspaces/{id}/catalog/lineage` | Member+ | Grafo completo de nodos+aristas |
| `POST` | `/v1/workspaces/{id}/catalog/enable` | Admin+ | Activar/desactivar |
| `POST` | `/v1/workspaces/{id}/catalog/seed` | Admin+ | Sembrar entradas `source` desde conectores |
| `PUT` | `/v1/workspaces/{id}/catalog/files` | Member+ | Upsert de un archivo markdown |
| `DELETE` | `/v1/workspaces/{id}/catalog/files?path=` | Member+ | Borrar un archivo |

Ver [API de Teams → Catálogo de datos](/es/teams/api/#catálogo-de-datos).

## Relacionado

- [Conexiones del workspace](/es/teams/connections/) — la mitad externa del catálogo.
- [Skill Marketplace](/es/teams/skill-marketplace/) — playbooks reutilizables (otra cosa).
