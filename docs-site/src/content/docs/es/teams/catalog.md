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

```http
POST /v1/workspaces/{workspaceId}/catalog/entries/{entryId}/certify
Authorization: Bearer {token}
Content-Type: application/json

{ "decision": "certified", "note": "Coincide con la plataforma de anuncios en marzo", "content_hash": "…" }
```

`decision` es `certified`, `revoked` o `deprecated`. Mandá el `content_hash` de la entrada
que revisaste (`certification.content_hash`): si alguien la editó mientras tanto, recibís
`409 CONFLICT` en lugar de certificar una versión que nadie miró. Los miembros reciben `403`.

## Métricas que se calculan

Una entrada `metric` puede llevar su definición completa — de dónde salen los datos, qué se
suma, por qué períodos y aperturas se puede ver — y ShareOut la calcula por vos. Cada
respuesta dice si la métrica está certificada y por quién, qué versión de la definición usó,
de dónde salieron las filas y qué tan frescas son.

```markdown
---
kind: metric
id: metric.roas
title: ROAS
title_es: Retorno de la inversión publicitaria
owner: ana@agencia.example
source: { shared_table: ads_daily }     # o { connection: conn_…, fqn: dataset.tabla } / { connection: conn_…, sql: "SELECT …" }
type: ratio                             # simple: una medida · ratio: numerador ÷ denominador
numerator: { agg: sum, expr: Ingresos }
denominator: { agg: sum, expr: Inversión }
time: { dimension: Fecha, grains: [week, month] }
dimensions: [{ name: cliente, column: cliente_id }, { name: canal, column: Canal }]
filters: ["Estado = 'activo'"]
format: { kind: ratio, decimals: 2, suffix: "x" }   # o currency (con currency: ARS / USD), percent, number
freshness_sla: 26h
---
```

- **¿No tenés warehouse?** Actualizá los datos de anuncios, analytics, tu tienda o una planilla
  en una **tabla compartida** del espacio (con un job programado o un crew) y apuntá la métrica
  a esa tabla con `source: { shared_table: … }`. Los warehouses funcionan directo: BigQuery,
  Snowflake, Supabase, Redshift y Aurora PostgreSQL.
- **Se revisa al guardar.** Una clave mal escrita ("numerador") se rechaza indicando la que
  probablemente quisiste poner; las columnas son nombres simples; cada filtro es una condición.
- **Quién la puede calcular.** Todo el espacio calcula una métrica certificada. Un borrador lo
  calculan propietarios, administradores y quien lo escribió — y todo el equipo cuando los datos
  ya están abiertos (una tabla compartida, o una conexión que el asistente puede consultar).

Abrí una métrica en el lente **Catálogo** para ver su fórmula ("Σ Ingresos ÷ Σ Inversión"),
períodos y dimensiones, y **Probala**: elegí período, fechas y apertura, y los números vuelven
con el formato de tu idioma (`2,50x`, `$ 1.520,50`).

```http
POST /v1/workspaces/{workspaceId}/catalog/metrics/metric.roas/query
Authorization: Bearer {token}
Content-Type: application/json

{ "grain": "month", "by": ["canal"], "from": "2026-03-01", "to": "2026-03-31" }
```

La respuesta trae `rows` (`period`, cada apertura, `value`), más `status`, `certified_by`,
`certified_at`, `spec_hash`, `format`, `source`, `freshness` y `computed_at`. Propietarios y
administradores reciben también el SQL que se ejecutó.

## Navegar el catálogo

El lente **Catálogo** está pensado para workspaces grandes (1.600+ entradas):

- **Vista de lista** — franja de KPIs (entradas, eventos, % certificado, % documentado,
  huérfanos), búsqueda instantánea, filtros por kind/dominio/estado y una **tabla densa
  ordenable** (nombre, kind, dominio, estado, origen, conteos de linaje). Clic en el encabezado
  de columna para ordenar. Las entradas editadas después de certificarse llevan la marca
  **cambió**. El filtro **Métrica** muestra las métricas con su estado, dueño, fuente y
  frescura.
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

## API REST

Todas las rutas requieren membresía del workspace. Un catálogo desactivado devuelve
`{ "enabled": false }` — nunca un error.

| Método | Endpoint | Quién | Propósito |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/catalog` | Member+ | Búsqueda (`q`, `kind`, `domain`, `status`, `tag`) + facetas |
| `GET` | `/v1/workspaces/{id}/catalog/manifest` | Member+ | Conteos, KPIs de adopción, huérfanos, refs colgantes, staleness |
| `GET` | `/v1/workspaces/{id}/catalog/entries/{entryId}` | Member+ | Una entrada + vecinos de linaje + historial de certificación |
| `POST` | `/v1/workspaces/{id}/catalog/entries/{entryId}/certify` | Admin+ | `{ decision, note?, content_hash? }` — certificar, revocar o marcar obsoleta |
| `GET` | `/v1/workspaces/{id}/catalog/metrics` | Member+ | Métricas con estado, fórmula, fuente y frescura |
| `GET` | `/v1/workspaces/{id}/catalog/metrics/{metricId}` | Member+ | Una métrica completa |
| `POST` | `/v1/workspaces/{id}/catalog/metrics/{metricId}/query` | Member+ (certificada) | `{ grain?, by?, from?, to?, where? }` → filas con su procedencia |
| `GET` | `/v1/workspaces/{id}/catalog/metrics/{metricId}/explain` | Member+ | Fórmula y consulta; el SQL para Admin+ |
| `GET` | `/v1/workspaces/{id}/catalog/lineage` | Member+ | Grafo completo de nodos+aristas |
| `POST` | `/v1/workspaces/{id}/catalog/enable` | Admin+ | Activar/desactivar |
| `POST` | `/v1/workspaces/{id}/catalog/seed` | Admin+ | Sembrar entradas `source` desde conectores |
| `PUT` | `/v1/workspaces/{id}/catalog/files` | Member+ | Upsert de un archivo markdown |
| `DELETE` | `/v1/workspaces/{id}/catalog/files?path=` | Member+ | Borrar un archivo |

Ver [API de Teams → Catálogo de datos](/es/teams/api/#catálogo-de-datos).

## Relacionado

- [Conexiones del workspace](/es/teams/connections/) — la mitad externa del catálogo.
- [Skill Marketplace](/es/teams/skill-marketplace/) — playbooks reutilizables (otra cosa).
