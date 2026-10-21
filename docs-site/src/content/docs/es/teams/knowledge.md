---
title: Conocimiento del workspace
description: Biblioteca opt-in por workspace de lo que tu equipo sabe — aprendida de tus artefactos, navegable por personas y buscable por agentes.
---

**Knowledge** es una biblioteca por workspace de lo que tu equipo sabe. Lee tus artefactos
publicadas y destila cada una en una nota markdown corta — hechos clave, números, temas y
nombres que un compañero querría — para que el conocimiento repartido en cientos de artefactos
sea algo que podés recorrer y buscar en un solo lugar.

Está **opt-in y apagado por defecto**. Un workspace sin Knowledge funciona igual que antes.
Cuando lo activás, ShareOut aprende de tus artefactos en segundo plano y mantiene la biblioteca
al día mientras publicás. Cada nota enlaza a los artefactos de los que se aprendió, así podés
rastrear cualquier dato hasta su fuente.

Knowledge es **visible solo para miembros del workspace** y solo aprende de los artefactos de tu
propio workspace.

**Knowledge requiere un plan pago** (Pro, Teams o Enterprise). Los workspaces free ven un
prompt de upgrade; activarlo o ejecutar **Learn from existing pages** devuelve
`403 UPGRADE_REQUIRED` sin gastar créditos de IA.

## Activarlo

Abrí un workspace y elegí **Knowledge** en la navegación izquierda. Un owner o admin ve el
botón **Turn on knowledge**. Los miembros sin permisos de admin ven una nota pidiendo que un
admin lo active.

Una vez activo, el lens está vacío hasta que se aprendan artefactos. Tenés dos formas de llenarlo:

- **Learn from existing pages** — un owner o admin puede encolar tus artefactos recientes en un
  clic. Toma hasta los **200 artefactos live más recientes** y los aprende todos en segundo
  plano (donde la instancia corre Workflows; si no, una pasada corta ahora y el resto en el
  cron horario), con una barra de progreso. Devuelve `{ "queued": 0 }`
  cuando todo ya está al día.
- **Let it grow** — cada artefacto que publiques de ahora en adelante se aprende automáticamente.

```http
POST /v1/workspaces/{workspaceId}/knowledge/enable
Authorization: Bearer {token}
Content-Type: application/json

{ "enabled": true }
```

```http
POST /v1/workspaces/{workspaceId}/knowledge/backfill
Authorization: Bearer {token}
```

## Cómo funciona el aprendizaje

El aprendizaje corre en segundo plano en un ciclo horario:

1. **Publicás un artefacto.** El artefacto se encola para aprender. La cola es consciente del
   contenido — editar y re-publicar el mismo artefacto muchas veces en una mañana sigue dando una
   sola tarea, y re-publicar contenido idéntico no re-aprende.
2. **El learner la digiere, usualmente dentro de la hora.** En cada ciclo horario lee el texto,
   nombre, descripción y tags del artefacto, y escribe una nota digest con título, temas,
   entidades nombradas y unas frases de hechos concretos. Procesa un número limitado de artefactos
   por workspace por ciclo, así un backfill grande puede tomar varios ciclos.
3. **El digest se indexa para búsqueda.** Cada nota se embebe para que los agentes la encuentren
   por significado, no solo por palabras exactas.

Se omiten artefactos no aprobados por moderación y artefactos [olvidados](#tus-controles).

### Consolidación nocturna

Después de los digests, un **consolidador nocturno** los fusiona en notas más ricas:

- **Overview** (`index.md`) — tronco auto-escrito que resume cuántos artefactos se aprendieron y los temas principales.
- **Páginas de tema** — hechos agrupados por asunto bajo `topics/`.
- **Páginas de entidad** — clientes, productos y personas bajo `entities/` (con dedup de alias para que "Acme" y "Acme Corp" colapsen).

El consolidador reutiliza los mismos límites y tombstones que el learner — las notas editadas a mano o fijadas nunca se sobrescriben.

### Guidance (reglas de casa)

La rama **Guidance** en el árbol de Knowledge guarda los archivos de contexto manual del equipo — voz, estilo, convenciones — el mismo markdown que antes vivía en Admin → Intelligence. Los miembros leen; los admins escriben. El asistente del workspace y `/v1/skill` inyectan el archivo guidance de entrada como contexto ambiental.

Gestioná Guidance desde el lens Knowledge (no hay pestaña admin separada). Las rutas REST siguen en `/v1/workspaces/{id}/context*` — ver [Workspaces → archivos de contexto](/es/teams/workspaces/#archivos-de-contexto-de-workspace).

### Tus controles

Seguís al mando de la biblioteca. En la vista de detalle de cualquier nota podés:

- **Edit** — reescribir una nota a mano. Una nota que editás queda marcada como tuya y **el learner nunca la sobrescribe**.
- **Pin** — marcar una nota para conservar. Fijar sigue el mismo camino "es tuya" que editar, así una nota fijada no cambia sola.
- **Forget** (owner/admin) — eliminar una nota. Olvidar también evita que ese artefacto se re-aprenda.

## Qué contiene

Knowledge es un árbol pequeño de archivos markdown, un archivo por nota. El frontmatter YAML
guarda los metadatos; el cuerpo son notas planas. Cada nota lleva los artefactos de origen en
`sources`.

El árbol se organiza por **kind** de nota:

| Kind | Qué es |
| --- | --- |
| `overview` | El tronco (`index.md`) — resumen auto-escrito de cuántos artefactos se aprendieron y los temas más comunes |
| `artifact-digest` | Un digest por artefacto, bajo `artifacts/` — las hojas que escribe el learner automáticamente |
| `topic` | Una página de tema bajo `topics/` |
| `entity` | Un cliente, persona, producto o sistema bajo `entities/` |
| `decision` | Un registro de "decidimos X porque Y" |
| `timeline` | Qué pasó en un período |

Hoy el learner escribe los **digests por artefacto**; el consolidador mantiene **overview**, **topics** y **entities**. Las notas **decision** y **timeline** son parte del mismo árbol y podés escribirlas vos o un agente por el [control de edición](#tus-controles) o la [API](#api-rest). Los archivos **Guidance** son solo manuales.

## Navegar Knowledge

El lens **Knowledge** abre en vista **árbol** por defecto — ramas indentadas para Overview, Topics, Entities, Pages (digests), Decisions y Guidance. Elegí un nodo para leerlo en el panel de detalle. Cambiá a **Table** para la lista densa ordenable (franja KPI, búsqueda, filtro por kind).

- **Vista árbol** — escaneá jerarquía, badges de frescura y marcadores de fijado de un vistazo. Guidance vive en su propia rama.
- **Vista tabla** — franja KPI (artefactos aprendidos, temas, entidades, última actualización), búsqueda, filtro por kind y filas ordenables.
- **Detalle de nota** — metadatos, cuerpo destilado y **Sources**: cada fuente muestra el nombre del artefacto y lo abre en una pestaña. Una fuente que no podés abrir (borrada, retenida o el artefacto privado de otra persona) aparece como "artefacto not available", sin enlace. Una línea de frescura ("Learned 3 days ago") muestra qué tan actual es.

### De un artefacto a sus notas

En la pestaña de un artefacto, **Detalles** del Inspector lista **Conocimiento de este artefacto** — las notas aprendidas de él — cuando hay alguna. Cada una abre la nota en Conocimiento (`#l/knowledge/<path>`).

**Learn from existing pages** muestra una barra de progreso mientras corre el distill on-demand (`GET /knowledge/status` — `queued`, `processed`, `total`, `running`). Donde la instancia corre Workflows se aprenden todos en segundo plano; si no, los backfills grandes siguen en el cron horario después de que termine la barra. `running` indica que todavía quedan artefactos en cola.

### Deep links

Marcá o compartí una vista de Knowledge desde Home:

| Hash | Abre |
| --- | --- |
| `#l/knowledge` | Lista de Knowledge |
| `#l/knowledge/{path}` | Una nota específica (ej. `#l/knowledge/artifacts/art_5d2e74a1.md`) |

## Para agentes

Con Knowledge activo, el [asistente del workspace](/es/teams/workspace-assistant/) puede
consultarlo en lugar de re-leer cada artefacto. Tiene las mismas tools de solo lectura que el
conector MCP, más el lector de notas:

- **`knowledge_search`** — buscar lo que el workspace sabe por tema, cliente, persona o pregunta.
  Devuelve **pasajes** citados de los Archivos subidos (PDFs, docs, planillas…) y artefactos, más
  las notas que coinciden. El filtro `kind` lo limita a notas.
- **`knowledge_get`** — leer una nota completa, con cuerpo destilado y artefactos fuente. Cada fuente viene con su título y enlace (o marcada como no disponible), y el asistente cita esos enlaces en su respuesta.
- **`knowledge_entity`** — un cliente, persona, producto o proyecto: con qué se conecta y los
  pasajes que lo mencionan.
- **`knowledge_facts`** — datos registrados (montos, fechas, estados…) de una entidad, cada uno
  con la frase de donde salió.
- **`knowledge_status`** — qué se aprendió, qué sigue procesándose y qué no se pudo leer.

Todas funcionan solo dentro de un workspace del que sos miembro (no en tu espacio Personal),
devuelven `{ "enabled": false }` cuando Knowledge está apagado y solo muestran pasajes y datos
de Archivos y artefactos que podés abrir.

## API REST

Los tokens de servicio y los miembros pueden leer y hacer crecer la biblioteca por REST. Todas
las rutas requieren membresía del workspace.

| Method | Endpoint | Quién | Propósito |
| --- | --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/knowledge` | Member+ | Settings + counts |
| `GET` | `/v1/workspaces/{id}/knowledge/status` | Member+ | Progreso de entrenamiento (ventana 24h) |
| `GET` | `/v1/workspaces/{id}/knowledge/tree` | Member+ | Resúmenes agrupados por kind |
| `GET` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | Una nota — cuerpo markdown + sources, con título, slug y enlace de cada artefacto fuente cuando lo podés abrir |
| `GET` | `/v1/workspaces/{id}/knowledge/from/{artifactId}` | Member+ | Notas aprendidas de un artefacto; vacío si Conocimiento está apagado o no podés abrir el artefacto |
| `PUT` | `/v1/workspaces/{id}/knowledge/files/{path}` | Member+ | Reemplazar markdown; marca como editada a mano |
| `DELETE` | `/v1/workspaces/{id}/knowledge/files/{path}?forget=1` | Admin+ | Eliminar nota; `forget=1` evita re-aprendizaje |
| `POST` | `/v1/workspaces/{id}/knowledge/enable` | Admin+ | Activar/desactivar (**plan pago** para activar) |
| `POST` | `/v1/workspaces/{id}/knowledge/backfill` | Admin+ | Encolar hasta 200 artefactos; `{ queued, kicked }` (**plan pago**) |

## Privacidad y alcance

- **Solo miembros.** La biblioteca Knowledge es visible para miembros del workspace. Los sharees externos no ven Knowledge.
- **Solo tus artefactos.** Las notas se derivan de los artefactos publicados de tu workspace.
- **Opt-in.** Knowledge está apagado hasta que un owner o admin lo active.

## Relacionado

- [Asistente del workspace](/es/teams/workspace-assistant/)
- [Catálogo de datos](/es/teams/catalog/)
- [Tu workspace (Home)](/es/everyone/your-workspace/)
