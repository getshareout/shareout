---
title: Editor visual (Live Studio)
description: El estudio WYSIWYG con chat integrado para artifacts HTML — layout, modos, ciclo de vida del draft y qué puede y no puede inferir el editor de tu HTML.
---

Todo artifact HTML tiene un **estudio WYSIWYG con chat integrado** en `/a/{slug}/edit`. Es separado del viewer en `/a/{slug}/`. Los artifacts no-HTML (Markdown, TXT, JSON, CSV) abren el [editor de fuente](/es/spec/source-editor/) en la misma URL.

Para una explicación en términos sencillos orientada a usuarios no técnicos, ver [El editor](/es/everyone/the-editor/).

## URLs

| URL | Propósito | Acceso |
|-----|-----------|--------|
| `/a/{slug}/edit` | Estudio visual — rail Agent, Inspect, Data | Owner, colaborador **editor** nombrado, o **owner/admin** del workspace (sesión requerida) |
| `/a/{slug}/` | Viewer en vivo — URL canónica de compartición | Según visibilidad del artifact |
| `/p/{slug}/` | Alias del viewer (mismo path que `/a/`) | Según visibilidad del artifact |

Las requests no autenticadas a `/a/{slug}/edit` redirigen al login de Google con `redirect=/a/{slug}/edit`.

## Disponibilidad por workspace

Live Studio está gated por el feature flag **`module.visual_editor`** por workspace
(default activado). Cuando está desactivado, `/a/{slug}/edit` devuelve una página amigable
de no disponible y los controles de edición en el home aparecen atenuados.

**Quién puede editar:** el owner del artifact (incluyendo [cuentas vinculadas](/es/start/authentication/#cuentas-vinculadas)),
un colaborador con rol **editor** u **owner**, o un **owner** / **admin** del workspace
del artifact. Los **members** del workspace siguen necesitando invitación explícita como
editor — la membresía sola no otorga acceso de edición.

## Layout del estudio

El editor renderiza el HTML del artifact en un iframe canvas sandboxed junto a un **rail de estudio** de vidrio:

| Modo / panel | Qué hace |
|-------------|----------|
| **Agent** | Chat de IA que ve el manifest y el modelo de datos, mantiene historial de conversación, transmite prosa y propone patches de HTML (aplicar / rechazar) |
| **Inspect** | Seleccioná un elemento del canvas; editá estilo y comportamiento de ShareOut inline — bindings, condicionales, actions, campos de formulario, links/transiciones, charts, templates |
| **Data** | Modelo de datos del manifest (sources / tables / json), conteos de filas en vivo, CRUD de JSON inline |

**Paneles del footer** (se abren desde la toolbar; comparten la misma superficie de vidrio):

| Panel | Qué hace |
| --- | --- |
| **Outline** | Estructura del documento (páginas, secciones, tabs) |
| **Details** | Renombrar, visibilidad, colaboradores, eliminar |
| **Validation** | Verificación de cumplimiento de la HTML spec (mismas reglas que `editor_readiness` al publicar) |
| **Version history** | Navegá y revertí a publicaciones anteriores |
| **Share** | Copiá link, código de embed |
| **Connect** | Conectores de datos del workspace; agregá conexiones REST desde la UI |
| **Metrics & alerts** | Métricas seguibles y reglas de umbral para este artifact |
| **Inbox** | Email entrante capturado por este artifact |

Las ediciones del canvas escriben atributos `data-shareout-*` reales. Los cambios fluyen por **undo/redo → autosave de draft → broadcast de colaboración**.

El chrome del estudio es un rail flotante junto al canvas con un pill compacto de validez
para warnings de spec. El rail **colapsa** a una pestaña peek; seleccionar un elemento
auto-cambia a **Inspect** (deshabilitado hasta que haya selección). Una franja de input
del agente permanece en todos los modos.

## Edit-Lite (Home del workspace) vs Live Studio

| | **Edit-Lite** (pestaña en Home) | **Live Studio** (`/a/{slug}/edit`) |
| --- | --- | --- |
| **Ideal para** | Texto, imágenes, links y bloques rápidos | Bindings, modelo de datos, collab, Inspect completo |
| **Superficie** | Toggle View/Edit en una pestaña de [Home](/es/everyone/your-workspace/) | URL dedicada del editor |
| **Collab** | Draft single-player | Multi-editor Yjs |
| **IA** | Reescribir selección en el panel de propiedades | Agente completo con patches HTML |

Misma API draft/publish bajo `/v1/artifacts/{id}/editor/*`; Edit-Lite abre **editor completo ↗**
cuando necesitás herramientas del estudio.

## Preview del editor (offline)

El editor visual resuelve **todas las lecturas del SDK desde valores `default` del
manifest** — json, tablas y conectores live (`sources.connections.<name>.default`). No hay
fetch de red ni query de warehouse en el estudio. Un artifact que encadena su UI detrás de
`await sdk.table(...).exec()` o `sdk.connection(...).query()` igual renderiza y sigue siendo
editable cuando hay defaults declarados; una source sin `default` hace preview vacío.

## Por qué importa el cumplimiento de la HTML spec

El estudio lee la HTML spec del artifact — no puede inferir estructura. Sin cumplimiento, los owners ven los paneles Data y Outline vacíos y no hay autocompletado de bindings, aunque la página publicada funcione bien en el viewer.

| Funcionalidad del estudio | Declaración requerida |
|--------------------------|----------------------|
| Sources en la pestaña Data | `<script type="shareout/manifest">` |
| Autocompletado de bindings | Entradas `sources` en el manifest |
| Navegación en Outline | `data-shareout-page`, `data-shareout-section`, tabs |
| Editores de comportamiento en Inspect | `data-shareout-binding`, `data-shareout-action`, `data-shareout-if`, etc. |
| Agregar/quitar templates | `data-shareout-template` |

Verificá el cumplimiento antes de publicar: [HTML spec overview](/es/spec/html-spec/).

## Autosave y ciclo de vida del draft

El estudio guarda automáticamente como **borrador personal** (`artifact_drafts` se indexa por `artifact_id` + `user_id`). Los drafts son independientes de las versiones publicadas — el viewer en vivo sigue sirviendo el último estado publicado hasta que alguien publique desde el estudio.

En la práctica:

| Evento | Qué pasa |
|--------|----------|
| Editás y esperás ~2s | Se guarda **tu** draft |
| Recargás | Cargás **tu** draft (o el HTML publicado si no tenés draft) |
| Un colaborador recarga | Carga **su** draft — no el tuyo |
| Publicás | El HTML de **tu** canvas queda live; se limpia **tu** fila de draft; los demás conservan el suyo |
| Dos pestañas tuyas guardan | Concurrencia optimista: `POST /editor/draft` con `baseUpdatedAt` devuelve **409 `DRAFT_CONFLICT`** si otra sesión tuya guardó primero |

La concurrencia es por usuario (tus pestañas / dispositivos / agente actuando como vos), no un draft compartido único.

## Colaboración

Varios editores pueden trabajar a la vez. Las ediciones **en vivo** van por WebSocket Yjs (`/editor/ws`) mientras las sesiones están abiertas. Eso es distinto del draft personal: al recargar la página, cada uno vuelve a ver su propio draft (o el HTML publicado).

Si llega un publish o un HTML remoto grande mientras tenés cambios sin guardar, el estudio ofrece conservar el tuyo o cargar el de ellos — no pisa en silencio.

Los owners bypasean la [política de acceso](/es/spec/access-policy/) y ven todos los datos al editar. Los colaboradores viewer quedan sujetos a la política.

## Agent (IA)

El chat del Agent necesita una clave de IA en el Worker (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY` o `VERCEL_AI_GATEWAY`). Si no hay ninguna, Live Studio igual abre: Inspect, Data, draft, publish y collab funcionan; el panel Agent muestra un estado claro de “no configurado” en lugar de fallar a mitad del stream.

La vista previa del canvas usa solo **valores `default` del manifest** — nunca consultas live al warehouse (ver [preview del editor](#preview-del-editor-offline) o la sección equivalente en EN).

## API REST del editor

Los agentes normalmente crean o actualizan artifacts via `POST /v1/publish`. El estudio también expone rutas autenticadas bajo `/v1/artifacts/{id}/editor/*`:

| Ruta | Propósito |
|------|-----------|
| `GET /editor` | Cargar estado del editor (`html`, `draftUpdatedAt`, colaboradores, assets, …) |
| `GET /editor/draft` | Obtener el draft actual |
| `POST /editor/draft` | Guardar draft (acepta `baseUpdatedAt` para concurrencia optimista) |
| `DELETE /editor/draft` | Descartar draft |
| `POST /editor/publish` | Publicar desde el estudio |
| `GET /editor/history` | Lista de historial de versiones |
| `POST /editor/rollback` | Revertir a una versión anterior |
| `POST /editor/upload` | Subir asset |
| `POST /editor/chat/{mode}` | Chat del agente (stream SSE) |
| `GET/POST /editor/sdk/{type}/{action}` | Editores de config del SDK (sheets, github, realtime, slides, …) |
| WebSocket `/editor/ws` | Canal de colaboración Yjs |

## Estilo vs. estructura

- **Clases `.so-` + `shareout.css`** — estilo visual, preservado en cada guardado.
- **Atributos `data-shareout-*`** — lo que el estudio lee y edita.

Estas dos capas son independientes: cambiar estilos visuales en Inspect no altera atributos de comportamiento, y re-publicar datos actualizados no toca el estilo.

## Slides y dashboards

El estudio visual descripto aquí cubre **artifacts HTML generales**. Los módulos de slides y dashboards usan su propio par editor/artifact publicado (editor `/a/` + viewer publicado `/p/`). Ver las secciones de [slides](/es/slides/) y [dashboards](/es/dashboards/).

## Ver también

- [El editor](/es/everyone/the-editor/) — explicación no técnica
- [Editor de fuente](/es/spec/source-editor/) — Markdown, CSV, JSON, TXT
- [Política de acceso](/es/spec/access-policy/) — filtrado de filas por viewer
