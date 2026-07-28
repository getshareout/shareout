---
title: Catálogo de datos
description: Un mapa opcional de los datos de tu workspace — fuentes, datasets, linaje, glosario — que los agentes mantienen al día y consultan al construir.
---

El **Catálogo de datos** es un mapa opcional, por workspace, de tus datos: sus **fuentes,
datasets, pipelines, dashboards, modelos, métricas y términos de negocio**. Se escribe como
archivos planos de markdown + YAML, lo mantienen al día sobre todo los agentes, y se lee de
dos formas — las personas lo navegan y buscan; el asistente de autoría lo consulta para usar
nombres de tabla reales, preferir datos **certificados** y evitar fuentes **obsoletas**.

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

## Qué contiene

Un archivo markdown describe un activo. El frontmatter YAML guarda los metadatos; el cuerpo
son notas. Solo tres campos son obligatorios — **kind**, **id**, **title** — y todo lo demás
es opcional, completado con el tiempo.

```markdown
---
kind: source              # source · event · dataset · table · view · pipeline · dashboard · model · metric · term
id: events_silver.chat_sent
title: Chat Sent
status: certified         # draft · certified · deprecated
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
| `dataset` | Datos que crean tus artifacts — `artifact` + `store` (ej. `table:daily_metrics`) |
| `table`, `view`, `pipeline`, `dashboard`, `model`, `metric` | Activos más finos en tu data mesh |
| `term` | Entrada de glosario — otros activos enlazan con `terms: [active-user]` |

Las aristas `upstream` / `downstream` cruzan planos libremente — por ejemplo un `dataset` de
artifact cuyo `upstream` es un `source` de conector.

### Mapea los dos tipos de datos

- **Datos externos** — todo lo que está detrás de una conexión del workspace (Snowflake,
  BigQuery, Sheets, Shopify…). Son entradas `source` con `connection` y `fqn`.
- **Datos que crean tus artifacts** — tablas y JSON guardados dentro de un artifact. Son
  entradas `dataset`. El linaje une ambos, así podés ver los datos de un dashboard trazados
  hasta la tabla del warehouse que los alimenta.

## Navegar el catálogo

El lente **Catálogo** es de solo lectura y está pensado para workspaces grandes (1.600+ entradas):

- **Vista de lista** — franja de KPIs (entradas, eventos, % certificado, % documentado,
  huérfanos), búsqueda instantánea, filtros por kind/dominio/estado y una **tabla densa
  ordenable** (nombre, kind, dominio, estado, origen, conteos de linaje). Clic en el encabezado
  de columna para ordenar.
- **Vista de entrada** — grilla de metadatos, cuerpo de notas y **tablas de linaje navegables**
  para vecinos upstream y downstream. Clic en cualquier vecino catalogado para saltar a su
  entrada; referencias sin catalogar aparecen como nodos punteados.

### Deep links

Marcá o compartí una vista del catálogo desde Home:

| Hash | Abre |
| --- | --- |
| `#l/catalog` | Lista del catálogo |
| `#l/catalog/{entryId}` | Una entrada específica |

## Por qué ayuda al asistente

Cuando un workspace tiene catálogo, el asistente de autoría lo consulta antes de construir —
así usa los nombres de tabla correctos, prefiere los datos que marcaste **certificados** y te
avisa antes de apoyarse en algo **obsoleto**. Es una pista, nunca una regla rígida: vos
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

## API REST

Todas las rutas requieren membresía del workspace. Un catálogo desactivado devuelve
`{ "enabled": false }` — nunca un error.

| Método | Endpoint | Quién | Propósito |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/catalog` | Member+ | Búsqueda (`q`, `kind`, `domain`, `status`, `tag`) + facetas |
| `GET` | `/v1/workspaces/{id}/catalog/manifest` | Member+ | Conteos, KPIs de adopción, huérfanos, refs colgantes, staleness |
| `GET` | `/v1/workspaces/{id}/catalog/entries/{entryId}` | Member+ | Una entrada + vecinos de linaje |
| `GET` | `/v1/workspaces/{id}/catalog/lineage` | Member+ | Grafo completo de nodos+aristas |
| `POST` | `/v1/workspaces/{id}/catalog/enable` | Admin+ | Activar/desactivar |
| `POST` | `/v1/workspaces/{id}/catalog/seed` | Admin+ | Sembrar entradas `source` desde conectores |
| `PUT` | `/v1/workspaces/{id}/catalog/files` | Member+ | Upsert de un archivo markdown |
| `DELETE` | `/v1/workspaces/{id}/catalog/files?path=` | Member+ | Borrar un archivo |

Ver [API de Teams → Catálogo de datos](/es/teams/api/#catálogo-de-datos).

## Relacionado

- [Conexiones del workspace](/es/teams/connections/) — la mitad externa del catálogo.
- [Skill Marketplace](/es/teams/skill-marketplace/) — playbooks reutilizables (otra cosa).
