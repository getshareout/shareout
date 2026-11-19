---
title: Tu workspace (Home)
description: El Home de ShareOut — el rail izquierdo, artefactos en pestañas, el Inspector, modo Edit rápido y el dock del agente.
---

El **Home** de ShareOut es donde gestionás artefactos, ves qué necesita atención y abrís artefactos sin salir de una sola superficie. El workspace tiene estas regiones:

| Región | Qué hace |
| --- | --- |
| **Rail izquierdo** | Marca, **Nuevo**, **Buscar** (⌘K) y después **Inicio**, **Artefactos**, **Skills de IA**, **Automatizaciones**, **Tareas con IA** (owners/admins), **Datos**, **Conocimiento**, **Catálogo** y **Admin** (owners/admins). Abajo de todo, **Ayuda y soporte** y **Documentación** |
| **Canvas** | Inicio, el lente que elegiste o un artefacto abierto; **dock del agente** abajo |
| **Barra superior** | Pestañas de artefactos abiertos, la campana de **notificaciones** y el menú de cuenta (donde cambiás de espacio) |
| **Rail derecho** | El **Inspector** del artefacto abierto — **Detalles**, **Comentarios**, **Automatizar** (y **Editando** mientras editás). En Inicio no aparece |

En tu espacio **Personal** el rail muestra solo Inicio, Artefactos, Skills de IA y
Automatizaciones; Tareas con IA, Datos, Conocimiento, Catálogo y Admin aparecen dentro
de un workspace de equipo.

Los rails y paneles son redimensionables; los anchos se recuerdan en tu navegador.

## Inicio — Te necesita, Para vos, Reciente

**Inicio** es una página tranquila y fija. Una línea arriba resume qué pasó desde tu
última visita (o te dice que estás al día). Debajo, hasta tres listas:

| Lista | Qué muestra |
| --- | --- |
| **Te necesita** | Filas que requieren acción: comentarios o respuestas sin resolver (que no son tuyos), shares hacia vos, pedidos de acceso, alertas y vigías de métricas, tests fallidos, ejecuciones fallidas de jobs o tareas con IA, y más. **×** descarta una fila |
| **Para vos** | Artefactos elegidos para vos |
| **Reciente** | Los artefactos que abriste y la actividad reciente (publicaciones, comentarios, ejecuciones) en una sola lista, lo más nuevo primero |

Una lista vacía no se muestra — **Te necesita** aparece solo cuando algo te espera.
Cuando las tres están vacías, Inicio muestra **Creá tu primer artefacto**.

El menú **Más** (**⋯**, arriba a la derecha de Inicio) tiene el resto:

- **Personalizar** — arrastrá las listas para reordenarlas y cambiales el tamaño desde
  la esquina; después, **Listo**. El layout se guarda en tu navegador.
- **Hoy**, **7d**, **30d** — qué tan atrás llega la actividad de **Reciente**.
- **Visibilidad de actividad** (owners y admins) — quién ve cada tipo de evento (ver
  [Admin del workspace → Visibilidad de actividad](/es/teams/admin/#visibilidad-de-actividad)).

## Pro search (⌘K)

Un solo motor de búsqueda rankeado y tolerante a typos alimenta todos los saltos en Home:

| Superficie | Cómo abrir |
| --- | --- |
| **Paleta de comandos** | **⌘K** / **Ctrl+K** en cualquier parte de Home, o **Buscar** en el rail izquierdo — busca artefactos, carpetas, personas y acciones, y además texto de artefactos, Conocimiento, datasets, conectores, programaciones, tareas con IA, alertas y skills de IA |
| **Búsqueda rápida en Artefactos** | Escribí en el cuadro **Búsqueda rápida…** sobre la lista de **Artefactos** — filtra la lista mientras escribís |

Sin texto, la paleta muestra tus **Búsquedas recientes** (**×** quita una, **Borrar**
vacía la lista) y los **Abiertos hace poco**. Una búsqueda se recuerda cuando abrís un
resultado o apretás **Enter**. Los resultados llegan en dos partes: artefactos,
carpetas, personas y acciones aparecen mientras escribís, sin espera; las coincidencias
**En el texto de los artefactos**, **En Conocimiento** y los demás grupos se suman un
momento después, abajo. **↑↓** navegan, **Enter** abre, **Esc** cierra.

**Preguntarle a la IA:** la última fila siempre es **Preguntarle a la IA: «tu consulta»**.
Elegila para hacer una pregunta puntual sobre los artefactos del workspace — ej.
`revenue del último trimestre`. Llama a `POST /v1/ask` y muestra la respuesta con links
**Fuentes** a los artefactos citados. Es solo lectura (sin herramientas ni publish) —
distinto del dock **Preguntale a tu espacio…** de abajo, que corre el
[asistente del workspace](/es/teams/workspace-assistant/) completo.

El mismo motor respalda `GET /v1/search` y la herramienta **`search_workspace`** del asistente — ver [API de Teams → Search](/es/teams/api/#search).

## Notificaciones

Una **campana** en la barra superior (a la izquierda del avatar) abre un panel acoplado a la derecha — mismo lenguaje de hoja glass que cuenta y ayuda. Un badge rojo cuenta ítems que te necesitan.

Las pestañas **Sin leer** y **Vistas** dividen el feed. **Sin leer** agrupa lo que
todavía te espera: **Necesita tu aprobación**, **Tareas pendientes** y **Recientes** (la
actividad de **Te necesita**). **Vistas** lista notificaciones que abriste o descartaste
dentro de la ventana actual (atenuadas, solo lectura).

| Tipo de tarjeta | Qué muestra |
| --- | --- |
| **Aprobación** | Solicitudes de publish-approval — **Aprobar** / **Rechazar** cuando sos votante pendiente; si no, estado en espera de revisión |
| **Tarea pendiente** | Action items asignados a vos, con vencimiento (**Vencida**, **Vence hoy**…) — **Hecho** / **Reabrir** |
| **Actividad** | Comentarios, respuestas, shares, solicitudes de acceso, archivos enviados al inbox del workspace, runs fallidos, **alertas de métricas**, **metric watches**, **datos obsoletos** (Sheets sin sync en 7+ días), **artefactos sin uso** (janitor mensual) y artefactos creados con IA que terminaron mientras no mirabas — **×** descarta una |

**Abrir la campana marca su actividad como leída.** El badge la descuenta en el acto y,
la próxima vez, esos ítems están en **Vistas** (también salen de **Te necesita** en
Inicio). No hay un paso aparte de "marcar todo como leído". Las aprobaciones quedan hasta
que alguien decide, y las tareas pendientes quedan hasta que las marcás **Hecho**. Abrir
una tarjeta de actividad navega al destino.

El contador del badge = aprobaciones pendientes que podés decidir + actividad sin leer + tareas pendientes abiertas. El panel se carga al abrir la página desde el feed de actividad y la cola de publish-approval.

### Digest semanal del workspace

Cada **lunes a las 13:00 UTC**, cada workspace activo envía a sus **miembros internos**
un email de categoría **product** con el resumen de los últimos siete días: artefactos
publicadas/actualizadas (con descripciones auto-generadas), más vistas, comentarios
abiertos de la semana y flags de **datos obsoletos**. Las semanas muertas se omiten.
Opt-out en preferencias de email (**product**). Distinto del digest semanal de
marketing personal.

## Lentes del workspace

Además de Inicio, el rail izquierdo abre lentes de página completa dentro de Home —
sin app de admin separada:

| Lente | Quién | Qué hacés ahí |
| --- | --- | --- |
| **Artefactos** | Todos | Todos los artefactos y archivos subidos, en carpetas — ver abajo |
| **Skills de IA** | Todos | **Skills** — las oficiales recomendadas por ShareOut y las del workspace — y **Módulos**, con **Nuevo módulo** para librerías JS |
| **Automatizaciones** | Todos | Tus envíos programados; el chip **Alertas** pasa a las alertas de métricas |
| **Tareas con IA** | Owners/admins | Gestionar tareas con IA (automatizaciones crew) |
| **Datos** | Miembros del workspace | **Fuentes de datos** — listar, crear e instalar conectores OAuth — y **Tablas**, los datasets del workspace |
| **Conocimiento** | Miembros (lo activan los admins) | Explorar el [conocimiento del workspace](/es/teams/knowledge/) opcional — notas aprendidas de tus artefactos |
| **Catálogo** | Miembros del workspace | Explorar el [catálogo de datos](/es/teams/catalog/) opcional — fuentes, linaje, glosario |
| **Admin** | Owners/admins | Panel de control — una página por tema en una barra lateral, agrupadas en Personas, Contenido, IA y facturación, Seguridad y Espacio de trabajo |

Cada lente tiene flujos de creación nativos — te quedás en Home en lugar de derivar al chat.

Ya no hay lente **Recursos**. Los archivos que subís (**Nuevo** → **Subir archivos**, o
soltándolos sobre Inicio) se convierten en artefactos — documentos, imágenes y video — y
quedan en **Artefactos** como cualquier otro. Los links a archivos anteriores siguen
funcionando.

Ver [Admin del workspace](/es/teams/admin/) para la referencia completa del lente Admin.

## Deep links y mobile

Las URLs de Home son marcables:

| Hash | Abre |
| --- | --- |
| `#l/brief` | Inicio (por defecto) |
| `#l/artifacts` | Artefactos |
| `#l/catalog` | Lista del catálogo de datos |
| `#l/catalog/{entryId}` | Una entrada específica del catálogo |
| `#l/admin` | Lente Admin |
| `#a/{slug}` | Pestaña de ese artefacto |

Un link a un lente que no está en tu rail (un `#l/assets` viejo, por ejemplo) abre Inicio.
Atrás/adelante del navegador navega entre lentes y pestañas. En el teléfono el rail
izquierdo es un **drawer hamburguesa** en lugar de barra fija.

En **Artefactos**, las carpetas aparecen arriba de las tarjetas de artefactos —
hacé clic en una carpeta para entrar (estilo Drive) con un **breadcrumb** para
volver. Creá, renombrá o borrá carpetas desde el encabezado (carpetas de equipo:
`owner`/`admin` cualquiera, los miembros las que crearon salvo que un admin lo
desactive; las personales son tuyas). Borrar una carpeta deja
sus artefactos en Artefactos — nunca borra los artefactos. Los filtros Recientes,
Favoritos, Compartidos conmigo y Míos siguen mostrando todo; las carpetas son
navegación, no un filtro que oculta artefactos.

Usá la fila de filtros para ver los **Eliminados recientemente** (artefactos
en soft-delete que podés restaurar).

## Abrí artefactos en pestañas

Hacé clic en una tarjeta para abrirla en una **pestaña** junto a Inicio — como un IDE. Las pestañas nuevas se abren primero, justo después de Inicio. Podés tener muchos artefactos abiertos; un **punto sucio** en la pestaña indica cambios sin guardar en el modo Edit rápido.

- **Arrastrá para reordenar** — agarrá cualquier pestaña de artefacto abierto (Inicio queda fija) y arrastrala.
- **Todas las pestañas abiertas** — cuando las pestañas ya no entran, un botón al final de la fila lista todas las abiertas; con más de ocho suma un cuadro **Buscar pestaña**.
- **Abrir en pestaña nueva** — el ícono ↗ en una tarjeta abre el artefacto en vivo en otra pestaña del navegador.
- **Vista de dispositivo** — en una pestaña HTML abierta, el ícono de teléfono enmarca el canvas como viewport móvil.
- **Pantalla completa** — el ícono de expandir junto al toggle de dispositivo pide pantalla completa nativa en el iframe de vista previa; **Esc** para salir.

## Edit rápido vs editor completo

Cada pestaña HTML tiene un toggle **Ver / Editar**:

| Modo | Ideal para |
| --- | --- |
| **Ver** | Previsualizar el artefacto en vivo dentro de Home |
| **Editar** | Ajustes rápidos de texto y layout sin abrir Live Studio |

En **Editar** podés:

- Pasar el mouse sobre cualquier elemento para marcarlo y hacer clic para seleccionarlo — un texto, una imagen, un link o un bloque entero. La lista **Elementos** del panel lateral muestra el artefacto como un árbol: al pasar el mouse resalta un elemento, al hacer clic lo selecciona y te lleva hasta él
- Reescribir texto inline; ponerlo en negrita, cursiva o como link, cambiarle color y tamaño, o usar **Convertir en…** para pasarlo a título o párrafo
- Cambiar imágenes (URL o subida) y links; darle a un bloque fondo, padding y alineación
- **Subir** o **Bajar** un elemento, **Duplicar**lo o **Eliminar**lo
- **Pedile a la IA** sobre lo que seleccionaste — o, sin nada seleccionado, sobre el artefacto entero (*¿Qué cambiamos en este artefacto?*). Los pedidos rápidos dependen de lo que elegiste: un texto tiene **Reescribir**, **Acortar**, **Corregir ortografía** y **Traducir**; un bloque, **Ordenar espacios** y **Convertir en tarjeta**; una imagen, **Escribir texto alternativo**. O escribí tu propio pedido
- Ver el cambio de la IA en su lugar como **Propuesta de la IA**: alterná **Antes** / **Después** para comparar y después **Aplicar cambio**, **Probar otra vez** o **Descartar** (**Esc** descarta). El resto queda bloqueado hasta que elijas
- **Deshacer / rehacer**, autosave en tu borrador privado y **Publicar** cuando esté listo
- Abrir el **editor completo ↗** (`/a/{slug}/edit`) para bindings, modelo de datos, collab y herramientas Inspect avanzadas

El modo Edit es para owners, colaboradores editor nombrados y **owners/admins** del workspace. Los miembros `member` necesitan invitación explícita **Can edit**.

Atajos en Edit: **⌘/Ctrl+S** guarda tu borrador ya (solo el botón **Publicar** publica), **⌘/Ctrl+Z** deshacer, **⌘/Ctrl+Shift+Z** o **⌘/Ctrl+Y** rehacer, **Esc** deseleccionar.

**Si el borrador cambió en otro lado** — en otra pestaña, en otro dispositivo o por el
agente — el guardado se pausa y una barra dice **Este borrador cambió en otro lado.**
Elegí **Mantener el mío** para guardar tu versión, o **Cargar el nuevo** para descartar
tus cambios sin guardar y abrir el borrador más nuevo.

**Si alguien publicó mientras editabas**, **Publicar** se frena con
**Cambió desde que empezaste (…)**, con la versión, quién la publicó y cuándo.
**Ver qué cambió** abre la diferencia; **Publicar igual** pone tu versión en vivo
encima de la suya.

## Inspector (rail derecho)

En una pestaña de artefacto, el Inspector tiene tres pestañas: **Detalles**,
**Comentarios** y **Automatizar**. En el modo Edit muestra una sola, **Editando**: las
propiedades del elemento seleccionado, el árbol **Elementos** y **Pedile a la IA**.

En teléfonos y tablets (pantallas de hasta 1100px de ancho) no hay rail derecho: tocá
**Opciones** en la barra del artefacto para abrir el mismo panel como una hoja desde
abajo.

| Pestaña | Qué hay |
| --- | --- |
| **Detalles** | Título y descripción (clic para editar), estrella, una línea con dueño · versión · fecha y pills de estado, y la nota de cambios de la versión en vivo ("Actualizado …"). Botones: **Abrir**, **Editar**, **Copiar enlace**, **Descargar original** (PDF convertidos) y **Eliminar**. Después, quién puede verlo en una línea, con el botón **Compartir**; **Secciones (N)** en [artefactos de varias secciones](/es/guides/multi-page/); y **Organización** (carpeta y etiquetas) para quienes editan. **Más** pliega **Aprobaciones** (**Aprobar esta versión**), **Analítica** y **Pruebas** (quienes editan), **Conocimiento de este artefacto** cuando [Conocimiento](/es/teams/knowledge/) aprendió notas de él, y dos filas que abren su propia vista: **Datos** (artefactos HTML) y **Versiones** — mirá [Historial de versiones](/es/everyone/version-history/) |
| **Comentarios** | Hilo completo, respuestas, @menciones, compositor. Filtro **Abiertos / Todos**, **Resolver / Reabrir**, **Asignar** y la marca "en vN" para comentarios de versiones anteriores — mirá [Revisión y aprobaciones](/es/everyone/review/) |
| **Automatizar** | **Actualizar los datos** (Drive, un link o un Excel por mail — quienes editan, en un workspace), **Enviar ahora** (quienes editan), las **Programaciones** y **Alertas** de este artefacto, **Monitoreo** (quienes editan) y **Acciones rápidas**: **Programar envío**, **Crear alerta**, **Armar una tarea con IA**, o contar algo a medida en el chat. Owners y editores ven los schedules compartidos y sus propios envíos personales; las suscripciones personales de otras personas quedan privadas |

**Enviar ahora** es un envío puntual a **email**, **Slack** o **Telegram** — corre al
instante, sin turno del agente. Elegí un canal de Slack de una lista (sin pegar IDs).
**Programar** lo convierte en un job recurrente. Si Telegram o Slack no están
conectados, **Conectar** te guía; **Verificar de nuevo** refresca el estado tras OAuth.

**Monitoreo** tiene **metric watches** de un clic sobre las tablas de este artefacto —
conteo de filas, suma de columna o último valor. Avisa en la campana cuando el valor se
mueve ±20% respecto a la línea base (chequeo horario). Ver
[Alertas de métricas → Watches](/es/guides/metric-alerts/#metric-watches).

Enviar ahora usa la misma capa de destinos que los [jobs programados](/es/guides/jobs/) —
`POST /v1/artifacts/{id}/deliver` con `action` `email`, `slack` o `telegram`.
Ver [API Teams → Entrega de artefactos](/es/teams/api/#entrega-de-artefactos-puntual).

## Chat del agente (panel inferior)

Abajo del canvas, **Preguntale a tu espacio…** es una pastilla en reposo que abre
un **panel de chat inferior redimensionable** sobre el workspace (atenúa el canvas
detrás). Arrastrá el agarre superior para agrandar o achicar; doble clic alterna
altura completa. La altura elegida se recuerda por navegador. **Esc**, el scrim o
el control de minimizar vuelven a la pastilla — no hay dock de chat en el rail derecho.

El asistente puede orientarte, **crear artefactos nuevos** desde una descripción,
ejecutar queries read-only en conectores cuando está habilitado y proponer
schedules — mismas reglas que el [asistente del workspace](/es/teams/workspace-assistant/).
Las acciones destructivas siempre piden confirmación; publicar un artefacto nuevo
requiere un paso explícito de aprobación.

Tocá el **micrófono** en el compositor para dictar un mensaje — el audio se transcribe
al cuadro de texto antes de enviar (ver [Asistente del workspace → Entrada por voz](/es/teams/workspace-assistant/#entrada-por-voz)).

Una vez por día, cuando el asistente está habilitado, Home obtiene un **brief proactivo**
corto (`GET /v1/home/agent/brief`) — un resumen cálido con IA de lo que te necesita
y runs recientes — y lo muestra en el hilo del chat (sin tomar toda la pantalla en mobile).

### Checklist de configuración (miembros nuevos)

Si te uniste a un workspace en los últimos **14 días** (contados desde que aceptaste la
invitación) — o, en tu espacio Personal, si tu cuenta es así de nueva — el chat te
prepara un **checklist de configuración** localizado. Sin llamada al modelo, y no se
abre solo: la pastilla **Preguntale a tu espacio…** muestra un punto de no leído.
Mientras no tengas un primer artefacto, el saludo ofrece algunas ideas para arrancar que
mandás con un clic. Después, una tarjeta **Puesta en marcha** muestra un anillo de
progreso y **solo el próximo paso**, con un botón que lo hace:

| Quién | Pasos, en orden |
| --- | --- |
| Owners y admins | Publicá tu primer artefacto · Conectá una fuente de datos · Invitá a tu equipo · Configurá una alerta |
| Miembros internos | Publicá tu primer artefacto · Conectá tu agente · Explorá un artefacto compartido · Dejá un comentario |
| Espacio Personal | Publicá tu primer artefacto · Probá el asistente · Compartí un artefacto |

Los sharees externos no ven checklist.

- **Invitá a tu equipo** y **Conectá tu agente** tienen un botón **Omitir** y no cuentan
  para el porcentaje, así el 100% sigue alcanzable.
- Los pasos se tachan solos según lo que hacés de verdad — al volver a la pestaña
  después de conectar algo, la tarjeta se actualiza.
- Preguntá *"¿cómo empiezo?"* en cualquier momento y el agente puede mostrar el mismo
  checklist con su herramienta `show_onboarding`.
- Al **100%**, un momento de anillo azul se dispara una vez (`POST /v1/home/onboarding/celebrate`);
  los workspaces establecidos tienen backfill para que no se retroactive.

Descartalo con el botón **Ocultar** de la tarjeta (`POST /v1/home/onboarding/dismiss`).
Estado: `GET /v1/home/onboarding?workspace=`.

## Menú de cuenta

Tu avatar abre un menú para cambiar entre **espacios Personal y de equipo**, gestionar
**cuentas vinculadas** (varias cuentas Google en un login), conectar Telegram (Settings
puede enlazar directo al bot) o cerrar sesión.

## Crear con IA

Abrí **Nuevo** arriba del rail izquierdo y elegí **Describilo a la IA** (aparece cuando
la creación con IA está activada en la instancia). Contá qué necesitás; la IA puede
hacerte una o dos preguntas y después muestra **¿Listo para crear esto?** con
**¿Quién puede verlo?** — **Privado** (por defecto), **Equipo** (en un workspace de
equipo) o **Cualquiera con el enlace** (donde se permiten links públicos). Tocá
**Crear**.

Se abre una pestaña **Creando · {nombre}** y ves cómo se arma el artefacto; cuando
termina, el artefacto real la reemplaza. Si falla, la pestaña ofrece **Probá de nuevo**.
Cerrar esa pestaña frena la creación. Cerrar el navegador no la frena en una instalación
estándar (mirá [builds que sobreviven a la pestaña](/es/self-host/ai/#builds-que-sobreviven-a-la-pestaña)):
sigue corriendo en el servidor y un aviso en la campana (y en **Te necesita**) te dice
cuando tu artefacto está listo. Podés crear uno a la vez. Por debajo es
`POST /v1/create/generate`.

## Relacionado

- [Cambiá lo que quieras](/es/everyone/the-editor/) — edición en lenguaje simple
- [Editor visual (Live Studio)](/es/spec/editor/) — referencia del estudio `/edit`
- [Trabajen juntos](/es/everyone/collaborators/) — invitaciones y acceso
- [Asistente del workspace](/es/teams/workspace-assistant/) — IA en el home del workspace
