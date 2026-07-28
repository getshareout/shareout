---
title: Asistente del workspace
description: Concierge con IA en el home del workspace — orientación, creación de páginas, consultas a conectores, schedules e hilos de chat nombrados.
---

import { Aside } from '@astrojs/starlight/components';

El **asistente del workspace** es un chat en la página de inicio del workspace.
Los miembros autenticados pueden preguntar sobre sus páginas, conectores y equipo —
y (cuando está habilitado) ejecutar consultas de **solo lectura** contra conectores
de warehouse.

Comparte un motor de agente con los bots de [Telegram](/es/guides/telegram-bot/)
y [Slack](/es/guides/slack-bot/) — misma selección de tools, flujo de confirmación
y contrato de almacenamiento. Telegram y Slack ahora también tienen consultas a
conectores y propuestas de schedules (no solo la web). El Home web está acotado a
un workspace y un usuario autenticado.

## Disponibilidad

Controlado por el feature flag `ai.web_agent`. Los workspaces **Pro y Teams** lo
tienen activado por defecto. Los workspaces **free** ven un prompt de upgrade con
link a billing en lugar del dock de chat. Los super-admins pueden seguir
alternándolo por workspace vía la API de [Features](/es/teams/admin/#features) o
la UI de admin.

Cuando está desactivado, el dock del agente en Home queda oculto y la API devuelve
`404`. Cuando está activo pero el [crédito de IA](/es/teams/billing/#credito-de-ia-incluido)
mensual está agotado, las sesiones nuevas de chat devuelven HTTP **402**
(`AI_CREDIT_EXHAUSTED`).

## Qué puede hacer

| Capacidad | Notas |
| --- | --- |
| Orientación | Lista páginas, conectores y cantidad de miembros |
| **Búsqueda en el workspace** | `search_workspace` — búsqueda fuzzy rankeada en páginas, carpetas, datasets, conectores, personas, schedules, crew y alertas (mismo motor que ⌘K) |
| **Crear páginas** | `create_artifact` construye y publica una página nueva desde una descripción — requiere confirmación antes de publicar |
| **Construir desde un archivo** | Pasá `source_file_id` en `create_artifact` después de `read_file` — hojas de cálculo, decks y CSV se convierten en páginas vivas |
| **Biblioteca de archivos** | `list_files` / `read_file` — explorá uploads, adjuntos de chat, archivos por email y shares desde el teléfono; ves procedencia y artifacts previos hechos con el mismo archivo |
| Editar páginas existentes | `edit_page` para cambios de texto/layout en una página que ya existe |
| Consultas de solo lectura | `SELECT` ad-hoc en conectores con **consulta IA** habilitada |
| Proponer schedules | Sugiere un cron (ej. enviar una página por email) — requiere confirmación |
| Hilos nombrados (web) | Drawer de historial estilo ChatGPT — crear, renombrar, eliminar hilos; título automático del primer mensaje |
| Widgets inline (web) | Tarjetas ricas en el hilo (previews de artifacts, resultados de conectores) — no se envían a Telegram/Slack |
| Historial | Últimos 20 turnos por hilo, almacenados en el servidor |
| Brief proactivo diario | Una vez por día al abrir Home — resumen corto con IA vía `GET /v1/home/agent/brief` |
| **Present this** | `present_artifact` — generar un deck de slides desde una página publicada |
| **Metric watch** | `watch_metric` — watch de tabla de un clic (alertas de anomalía solo en campana) |

Las acciones destructivas o de escritura siempre pasan por un paso de
**confirmación**. El asistente no puede mutar data stores arbitrarios ni ejecutar
SQL distinto de `SELECT`, pero **sí puede publicar una página nueva** después de
que confirmes una propuesta `create_artifact`.

<Aside type="caution">
Las consultas a conectores son opt-in por conector. Los admins activan **AI query:
On** en el panel de conectores. Usá credenciales de solo lectura.
</Aside>

## UI

En el [Home del workspace](/es/everyone/your-workspace/), la pastilla inferior
**Preguntale a tu workspace…** abre una **hoja** de chat redimensionable (altura
por defecto `min(480px, 52vh)`). Arrastrá el agarre superior para cambiar el
tamaño; doble clic alterna altura completa del viewport. El panel incluye drawer
de historial de hilos, texto en streaming y widgets inline. Las respuestas llegan
por Server-Sent Events (SSE). Colapsá con **Esc**, el scrim o minimizar — el
workspace queda visible detrás del overlay atenuado.

El **modo respuesta de ⌘K** es un camino aparte y más liviano: escribí una pregunta
que termine en `?` en la paleta de comandos para una respuesta de un turno con
citas a páginas — sin hilo, sin herramientas, sin publish. Usá el dock cuando
necesites chat multi-turno, adjuntar archivos o `create_artifact`.

### Entrada por voz

Cuando tu navegador soporta grabación, aparece un botón de **micrófono** en el
compositor. Tocá una vez para grabar, otra para detener. El audio se transcribe en
el servidor (Whisper vía Workers AI — el mismo motor que el
[bot de Telegram](/es/guides/telegram-bot/)) y cae en el cuadro de texto para que lo
revises antes de enviar. Se aceptan clips de hasta unos 10 minutos; el navegador debe
otorgar permiso de micrófono.

### Adjuntos de archivos

Un **clip** en el compositor sube un archivo a tu biblioteca de assets y lo adjunta
al próximo mensaje. El asistente ve una referencia `[Attached file: … — file id …]`
y puede llamar `read_file` para parsear hojas de cálculo (esquemas de hojas + filas de
muestra), presentaciones (texto de slides) o texto plano antes de proponer
`create_artifact`.

Si hacés **Compartir → ShareOut** desde otra app en el teléfono con la PWA de ShareOut
instalada, Home abre con el archivo ya adjunto en el compositor — listo para pedir
*"convertí esto en un dashboard."*

Los archivos enviados por email al inbox del workspace (`{slug}@inbox.shareout.site`)
también aparecen en `list_files` con etiqueta de origen *emailed in*. Cuando un nombre
de archivo ya construyó un artifact, el asistente se orienta a **actualizar** esa
página en lugar de crear un duplicado.

El streaming usa scroll **reading-first** (compartido con el agente del editor,
el builder de creación y los widgets de chat para visitantes):

- Después de enviar un mensaje, tu turno queda anclado cerca del tope mientras la
  respuesta se escribe abajo — la vista no salta salvo que ya estés en el borde vivo.
- Si te alejás del borde o seleccionás texto, el contenido nuevo **no te mueve**;
  aparece un badge de no leídos y **ir al final**.
- **Búsqueda en el hilo** filtra mensajes sin perder tu lugar.
- Al reabrir un hilo guardado, retomás en tu **último mensaje de usuario**, no al fondo.

Las rutas acotadas a Home usan `/v1/home/agent/…`; las del workspace usan
`/v1/workspace/{workspaceId}/agent/…` — mismas capacidades, distinta scope key.

## API REST

Todas las rutas requieren sesión o bearer token y membresía en el workspace. El
flag `ai.web_agent` debe estar activo.

| Método | Endpoint | Propósito |
| --- | --- | --- |
| `POST` | `/v1/home/agent/chat` o `/v1/workspace/{id}/agent/chat` | Enviar mensaje; stream SSE. `thread_id` opcional. |
| `POST` | `…/agent/confirm` | Aprobar acción pendiente (`{ "token": "…" }`) |
| `GET` | `…/agent/brief` | Brief proactivo diario (solo Home) |
| `GET` | `…/agent/media/{token}` | Media adjunta a una respuesta |
| `GET` | `…/agent/threads` | Listar hilos nombrados (solo web) |
| `POST` | `…/agent/threads` | Crear hilo (`{ "title"?: "…" }`) |
| `POST` | `…/agent/threads/{id}/rename` | Renombrar (`{ "title": "…" }`) |
| `DELETE` | `…/agent/threads/{id}` | Eliminar hilo y sus mensajes |
| `POST` | `…/agent/transcribe?seconds=` | Transcribir clip de voz (cuerpo de audio crudo) → `{ "text" }` |

### Chat (SSE)

```http
POST /v1/workspace/{workspaceId}/agent/chat
Authorization: Bearer {token}
Content-Type: application/json

{ "text": "¿Qué conectores tenemos?" }
```

La respuesta es `text/event-stream`. Los eventos incluyen chunks de texto,
indicadores de escritura y un evento final `done`.

### Confirmar una acción propuesta

```http
POST /v1/workspace/{workspaceId}/agent/confirm
Authorization: Bearer {token}
Content-Type: application/json

{ "token": "pending-action-token" }
```

## Consultas IA en conectores

```http
PATCH /v1/workspaces/{workspaceId}/connections/{connectionId}
Authorization: Bearer {token}
Content-Type: application/json

{ "agent_query_enabled": true }
```

Solo conectores de warehouse (Snowflake, BigQuery, Postgres, etc.) soportan
consultas ad-hoc.

## Relacionado

- [Conexiones del workspace](/es/teams/connections/)
- [Admin del workspace](/es/teams/admin/)
- [Agente de chat IA](/es/guides/ai-agent/) — asistente para visitantes dentro de un artifact
