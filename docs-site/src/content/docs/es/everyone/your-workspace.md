---
title: Tu workspace (Home)
description: El Home rediseñado de ShareOut — lentes, páginas en pestañas, el Inspector, modo Edit rápido y el dock del agente.
---

El **Home** de ShareOut es donde gestionás páginas, ves qué necesita atención y abrís artifacts sin salir de una sola superficie. El workspace rediseñado tiene tres regiones:

| Región | Qué hace |
| --- | --- |
| **Rail izquierdo** | Marca, **Crear con IA**, lentes (Brief, Todos los artifacts, Assets, Schedules, Alerts, Analytics, Datasets, **Catálogo**, Crew AI, Library, Connectors), **Admin** (owners/admins), Following, menú de cuenta |
| **Canvas** | Pestañas (Home + páginas abiertas); widgets del Brief y vistas de artifacts; **dock del agente** abajo |
| **Barra superior** | Campana de **notificaciones** (a la izquierda del avatar), menú de cuenta, cambio de espacio |
| **Rail derecho** | **Inspector** contextual — Activity en Home; Details / Deliver / Comments / Automate / Editing en pestañas de artifacts |

Los rails y paneles son redimensionables; los anchos se recuerdan en tu navegador.

## Brief — Needs You y Pulse

En **Home**, el canvas muestra tu **Brief** como widgets arrastrables y el rail
derecho muestra **Activity**:

| Widget | Qué muestra |
| --- | --- |
| **Recently viewed** | Páginas que abriste recientemente |
| **Needs you** | Filas accionables (comentarios, shares, pedidos de acceso, alertas, runs fallidos) |
| **Runs** | Ejecuciones recientes de schedules y crew |
| **Activity** | Conteos Pulse en vivo (publicaciones, vistas, creaciones, favoritos, conexiones, skills…) |
| **For you** | Recomendaciones personalizadas |

Arrastrá el grip de cada widget para **reordenar**; redimensioná desde la esquina.
El layout se guarda en tu navegador.

- **Needs You** — filas individuales que requieren acción: comentarios o respuestas sin resolver (que no son tuyos), shares hacia vos, pedidos de acceso, alertas de métricas, tests fallidos, ejecuciones fallidas de jobs o crew.
- **Pulse** — conteos agregados ambientales dentro del widget Activity. Elegí **Hoy**, **7 días** o **30 días**.

Los owners y admins del workspace pueden ajustar quién ve cada tipo de evento en **Activity → configuración** (ver [Admin del workspace → Visibilidad de actividad](/es/teams/admin/#visibilidad-de-actividad)).

## Pro search (⌘K)

Un solo motor de búsqueda rankeado y tolerante a typos alimenta todos los saltos en Home:

| Superficie | Cómo abrir |
| --- | --- |
| **Paleta de comandos** | **⌘K** / **Ctrl+K** en cualquier parte de Home — busca páginas, carpetas, datasets, conectores, personas, schedules, crew y alertas |
| **Salto inline** | Escribí en el cuadro de búsqueda sobre las tarjetas en **All Artifacts** — mismos resultados, abre como pestaña in-studio |

Sin texto muestra **recientes**. Los resultados se agrupan (Pages, Folders, Data, People, Schedules, Crew, Alerts, Actions) con miniaturas, avatares del owner, conteos de vistas y pills de estado. **↑↓** navegan, **Enter** abre, **Esc** cierra.

**Modo respuesta:** terminá la consulta con **`?`** para hacer una pregunta puntual sobre las páginas del workspace — ej. `revenue last quarter?`. La paleta muestra una fila **Ask**; **Enter** llama a `POST /v1/ask` y renderiza la respuesta con links **Sources** a las páginas citadas. Es solo lectura (sin herramientas ni publish) — distinto del dock **Ask your workspace…** de abajo, que corre el [asistente del workspace](/es/teams/workspace-assistant/) completo.

El mismo motor respalda `GET /v1/search` y la herramienta **`search_workspace`** del asistente — ver [API de Teams → Search](/es/teams/api/#search).

## Notificaciones

Una **campana** en la barra superior (a la izquierda del avatar) abre un panel acoplado a la derecha — mismo lenguaje de hoja glass que cuenta y ayuda. Un badge rojo cuenta ítems que te necesitan.

Las pestañas **Unread** y **Seen** dividen el feed: **Unread** tiene aprobaciones y actividad que aún te esperan; **Seen** lista notificaciones que abriste o descartaste dentro de la ventana actual (atenuadas, solo lectura).

| Tipo de tarjeta | Qué muestra |
| --- | --- |
| **Aprobación** | Solicitudes de publish-approval — **Aprobar** / **Rechazar** cuando sos votante pendiente; si no, estado en espera de revisión |
| **Actividad** | Comentarios, respuestas, shares, solicitudes de acceso, **action items** asignados a vos, archivos enviados al inbox del workspace, runs fallidos, **alertas de métricas**, **metric watches**, **datos obsoletos** (Sheets sin sync en 7+ días) y **páginas sin uso** (janitor mensual) de **Needs you** — descartá una a una o **Marcar todo leído** |

Abrir una tarjeta de actividad navega al destino y la marca como **vista** (sale del contador de no leídas). Descartar o **Marcar todo leído** también mueve ítems a **Seen**.

El contador del badge = aprobaciones pendientes que podés decidir + ítems de actividad sin descartar. El panel se carga al abrir la página desde el feed de actividad y la cola de publish-approval.

### Digest semanal del workspace

Cada **lunes a las 13:00 UTC**, cada workspace activo envía a sus **miembros internos**
un email de categoría **product** con el resumen de los últimos siete días: páginas
publicadas/actualizadas (con descripciones auto-generadas), más vistas, comentarios
abiertos de la semana y flags de **datos obsoletos**. Las semanas muertas se omiten.
Opt-out en preferencias de email (**product**). Distinto del digest semanal de
marketing personal.

## Lentes del workspace

Además del Brief, el rail izquierdo abre lentes de página completa dentro de Home —
sin app de admin separada:

| Lente | Quién | Qué hacés ahí |
| --- | --- | --- |
| **Datasets** | Miembros del workspace | Explorar y crear datasets del workspace |
| **Catálogo** | Todos | Explorar el [catálogo de datos](/es/teams/catalog/) opcional — fuentes, linaje, glosario |
| **Crew AI** | Owners/admins | Gestionar automatizaciones crew |
| **Library** | Todos | Skills oficiales **Recommended by ShareOut**, explorar skills del workspace y **+ New module** para librerías JS |
| **Assets** | Todos | Subir archivos reutilizables, versionar deliverables, armar bundles y enviar links de descarga — ver [Archivos y entregas](/es/everyone/assets/) |
| **Connectors** | Miembros del workspace | Listar, crear e instalar conectores OAuth |
| **Admin** | Owners/admins | Panel de diez pestañas — Overview, Artifacts, Members, **Compartir**, Billing, Automation, AI, Security, Support, Settings |

Cada lente tiene flujos de creación nativos — te quedás en Home en lugar de derivar al chat.
Admin también enlaza a Connectors, Schedules, Alerts y Crew para tareas transversales.

Ver [Admin del workspace](/es/teams/admin/) para la referencia completa del lente Admin.

## Deep links y mobile

Las URLs de Home son marcables:

| Hash | Abre |
| --- | --- |
| `#l/brief` | Lente Brief (Home por defecto) |
| `#l/artifacts` | Todos los artifacts |
| `#l/assets` | Assets (archivos y entregas) |
| `#l/catalog` | Lista del catálogo de datos |
| `#l/catalog/{entryId}` | Una entrada específica del catálogo |
| `#l/admin` | Lente Admin |
| `#a/{slug}` | Pestaña del artifact de esa página |

Atrás/adelante del navegador navega entre lentes y pestañas. En el teléfono el rail
izquierdo es un **drawer hamburguesa** en lugar de barra fija.

En **Todos los artifacts**, las carpetas aparecen arriba de las tarjetas de páginas —
hacé clic en una carpeta para entrar (estilo Drive) con un **breadcrumb** para
volver. Creá, renombrá o borrá carpetas desde el encabezado (carpetas de equipo
requieren `owner`/`admin`; las personales son tuyas). Borrar una carpeta deja
sus páginas en Todos los artifacts — nunca borra las páginas. Los filtros Recent,
Favorites, Shared y Mine siguen mostrando todo; las carpetas son navegación, no
un filtro que oculta páginas.

Usá la fila de filtros para ver páginas **Eliminadas recientemente** (artifacts
en soft-delete que podés restaurar).

## Abrí páginas en pestañas

Hacé clic en una tarjeta para abrirla en una **pestaña** junto a Home — como un IDE. Podés tener muchas páginas abiertas; un **punto sucio** en la pestaña indica cambios sin guardar en el modo Edit rápido.

- **Arrastrá para reordenar** — agarrá cualquier pestaña de página abierta (Home queda fija) y arrastrala.
- **Abrir en pestaña nueva** — el ícono ↗ en una tarjeta abre la página en vivo en otra pestaña del navegador.
- **Vista de dispositivo** — en una pestaña HTML abierta, el ícono de teléfono enmarca el canvas como viewport móvil.
- **Pantalla completa** — el ícono de expandir junto al toggle de dispositivo pide pantalla completa nativa en el iframe de vista previa; **Esc** para salir.

## Edit rápido vs editor completo

Cada pestaña HTML tiene un toggle **View / Edit**:

| Modo | Ideal para |
| --- | --- |
| **View** | Previsualizar la página en vivo dentro de Home |
| **Edit** | Ajustes rápidos de texto y layout sin abrir Live Studio |

En **Edit** podés:

- Hacer clic en texto para reescribirlo inline; cambiar color, tamaño, links, imágenes (URL o subida)
- Insertar, reordenar, duplicar o borrar bloques (texto, título, imagen, botón, divisor)
- Usar **IA en la selección** (reescribir, acortar, gramática, traducir o prompt personalizado)
- **Deshacer / rehacer**, autosave de drafts y **Publicar** cuando esté listo
- Abrir el **editor completo ↗** (`/a/{slug}/edit`) para bindings, modelo de datos, collab y herramientas Inspect avanzadas

El modo Edit es para owners, colaboradores editor nombrados y **owners/admins** del workspace. Los miembros `member` necesitan invitación explícita **Can edit**.

Atajos en Edit: **⌘/Ctrl+S** publicar, **⌘/Ctrl+Z** deshacer, **Esc** deseleccionar.

## Inspector (rail derecho)

En una pestaña de artifact, el Inspector es una pila de secciones colapsables
(arrastrá para reordenar — tu layout se recuerda por navegador):

| Sección | Propósito |
| --- | --- |
| **Details** | Estrella, título, visibilidad (control segmentado), árbol de carpetas, meta pills compactas, tarjeta **Shared with** (invitar inline + desglose por viewer), tags, tests |
| **Deliver** | Envío puntual a **email**, **Slack** o **Telegram** — corre al instante, sin turno del agente. Elegí un canal de Slack desde un picker buscable (sin pegar IDs). **Schedule** abre Automate para crear un job recurrente. Si Telegram o Slack no están conectados, **Connect** te guía; **Check again** refresca el estado tras OAuth. |
| **Watches** | **Metric watches** de un clic sobre tablas de esta página — conteo de filas, suma de columna o último valor. Avisa en la campana cuando el valor se mueve ±20% respecto a la línea base (chequeo horario). Ver [Alertas de métricas → Watches](/es/guides/metric-alerts/#metric-watches). |
| **Comments** | Hilo completo, respuestas, @menciones, compositor |
| **Automate** | Schedules y triggers crew de esta página |
| **Editing** | Panel de propiedades con Edit activo (formato, bloques, IA) |

En **Home**, el Inspector muestra **Activity** (Needs You + Pulse).

Deliver usa la misma capa de destinos que los [jobs programados](/es/guides/jobs/) —
`POST /v1/artifacts/{id}/deliver` con `action` `email`, `slack` o `telegram`.
Ver [API Teams → Entrega de artifacts](/es/teams/api/#entrega-de-artifacts-puntual).

## Chat del agente (panel inferior)

Abajo del canvas, **Preguntale a tu workspace…** es una pastilla en reposo que abre
un **panel de chat inferior redimensionable** sobre el workspace (atenúa el canvas
detrás). Arrastrá el agarre superior para agrandar o achicar; doble clic alterna
altura completa. La altura elegida se recuerda por navegador. **Esc**, el scrim o
el control de minimizar vuelven a la pastilla — no hay dock de chat en el rail derecho.

El asistente puede orientarte, **crear páginas nuevas** desde una descripción,
ejecutar queries read-only en conectores cuando está habilitado y proponer
schedules — mismas reglas que el [asistente del workspace](/es/teams/workspace-assistant/).
Las acciones destructivas siempre piden confirmación; publicar una página nueva
requiere un paso explícito de aprobación.

Tocá el **micrófono** en el compositor para dictar un mensaje — el audio se transcribe
al cuadro de texto antes de enviar (ver [Asistente del workspace → Entrada por voz](/es/teams/workspace-assistant/#entrada-por-voz)).

Una vez por día, cuando el asistente está habilitado, Home obtiene un **brief proactivo**
corto (`GET /v1/home/agent/brief`) — un resumen cálido con IA de lo que te necesita
y runs recientes — y lo muestra en el hilo del chat (sin tomar toda la pantalla en mobile).

### Checklist de configuración (miembros nuevos)

Cuando te unís a un workspace en los últimos **14 días**, el dock se abre solo con un
**checklist de configuración** localizado — sin llamada al modelo, solo un saludo cálido
y un anillo de progreso. Las tareas se derivan en vivo del estado real (publicar,
conectar datos, Telegram, Slack, alerta, skill para admins; explorar, comentar,
Telegram, skill+publicar para miembros internos). Los sharees externos no ven checklist.

- Cada ítem tiene un botón de acción inline (conectar, publicar, abrir Connectors, etc.).
- **Slack** es opcional y no cuenta para el porcentaje, así el 100% sigue alcanzable.
- Preguntá *"¿cómo empiezo?"* en cualquier momento y el agente puede mostrar el mismo
  checklist con su herramienta `show_onboarding`.
- Al volver a la pestaña después de conectar Telegram (o terminar OAuth de un conector)
  los ítems se tachan solos.
- Al **100%**, un momento de anillo azul se dispara una vez (`POST /v1/home/onboarding/celebrate`);
  los workspaces establecidos tienen backfill para que no se retroactive.

Descartalo con el control de dismiss del checklist (`POST /v1/home/onboarding/dismiss`).
Estado: `GET /v1/home/onboarding?workspace=`.

## Menú de cuenta

Tu avatar abre un menú para cambiar entre **espacios Personal y de equipo**, gestionar
**cuentas vinculadas** (varias cuentas Google en un login), conectar Telegram (Settings
puede enlazar directo al bot) o cerrar sesión.

## Crear con IA

**Crear con IA** en el rail izquierdo inicia generación in-studio (`/v1/create/generate`) para que las páginas nuevas caigan en tu workspace sin salir de Home.

## Relacionado

- [Cambiá lo que quieras](/es/everyone/the-editor/) — edición en lenguaje simple
- [Editor visual (Live Studio)](/es/spec/editor/) — referencia del estudio `/edit`
- [Trabajen juntos](/es/everyone/collaborators/) — invitaciones y acceso
- [Asistente del workspace](/es/teams/workspace-assistant/) — IA en el home del workspace
