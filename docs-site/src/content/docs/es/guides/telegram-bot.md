---
title: Bot de Telegram
description: Vinculá tu cuenta de ShareOut a Telegram y manejá tus artifacts desde el chat — leé, sacá snapshots, escribí datos y recibí notificaciones.
---

import { Steps, Aside } from '@astrojs/starlight/components';

**@ShareOutAI_bot** es un asistente a nivel de cuenta en Telegram. Una vez vinculado,
puede encontrar y leer tus artifacts, renderizar snapshots y PDFs, ejecutar fuentes de
datos REST en vivo, escribir datos en una página, y permitirte pausar alertas o
administrar jobs programados — todo con un paso de confirmación explícito antes de
cualquier mutación.

<Aside type="note">
Esto es distinto de `sdk.agent`, el widget de chat para visitantes que se embebe dentro
de un artifact publicado. El bot de Telegram opera sobre todos los artifacts a los que
podés acceder desde tu cuenta. Ver [Agente de chat con IA](/es/guides/ai-agent/) para
el asistente dentro de la página, y [Crew](/es/guides/crew/) para agentes autónomos del
lado del servidor en un artifact.
</Aside>

## Vincular tu cuenta

<Steps>

1. Abrí **ShareOut → Settings → Connect Telegram**.
2. Tocá el deep link — contiene un código de un solo uso válido por **15 minutos**.
3. El bot confirma la vinculación y registra un menú de comandos slash.
4. Mandá cualquier mensaje para empezar: pedile que encuentre una página, traiga
   números frescos o envíe un snapshot.

</Steps>

Si el link expira, generá uno nuevo desde Settings. Una cuenta de ShareOut puede
vincularse a múltiples chats de Telegram.

## Mensajes de voz

Mandá un **mensaje de voz** — o reenviá un archivo de audio — en lugar de escribir. El
bot lo transcribe con Whisper de Cloudflare Workers AI (detección automática de idioma,
así que español, inglés y clips mezclados funcionan), te muestra lo que entendió
(`🎙️ "…"`) y trata la transcripción igual que un mensaje escrito. **Los comandos slash
hablados también funcionan** — decí "snapshot del dashboard de ventas" y ejecuta
`/snapshot`.

<Aside type="note">
Se aceptan clips de hasta ~10 minutos / 20 MB; los más largos se rechazan amablemente.
Cada transcripción se registra para visibilidad de costos, pero no se cobra al balance
de un workspace.
</Aside>

## Alcance del workspace

El bot recuerda qué páginas buscar entre sesiones:

| Comando | Acción |
| --- | --- |
| `/workspaces` | Muestra un selector de workspaces (botones inline) |
| `/workspace {nombre}` | Cambia a un workspace por nombre o slug |
| `/personal` | Solo páginas personales |
| `/status` | Muestra el email de la cuenta vinculada y el alcance actual |

El alcance por defecto cubre **todas las páginas** a las que tenés acceso — artifacts
personales y de workspaces combinados. Los grupos de identidades vinculadas se respetan,
así que un login personal que pertenece a una cuenta de workspace también ve esos
artifacts.

## Tarjetas de artifact

`/artifacts` y `/search` devuelven tarjetas interactivas (hasta 10) en vez de texto
plano. Cada tarjeta tiene:

| Botón | Qué hace |
| --- | --- |
| **Open Page** | Abre la URL del artifact en vivo |
| **Snapshot** | Renderiza un PNG y lo manda al chat |
| **PDF** | Renderiza un PDF y lo manda al chat |
| **Ask AI** | Inicia un turno del agente sobre esa página |
| **Share** | Inicia un flujo para compartir por email |

Los atajos slash replican las tarjetas: `/snapshot {página}`, `/pdf {página}`,
`/share {página} with {email}`, `/alerts`, `/schedules`.

### Tickets de soporte

| Comando | Acción |
| --- | --- |
| `/support {mensaje}` | Abrir un ticket de soporte (mismo sistema que el botón Ayuda en la app) |
| `/bug {mensaje}` | Alias de `/support` |

Ver [Pedir ayuda](/es/everyone/get-help/) para el ciclo completo del ticket.

## Qué puede hacer el bot

### Lectura y media (inmediato, sin confirmación)

| Capacidad | Descripción |
| --- | --- |
| Listar artifacts | Todas las páginas a las que tenés acceso |
| Buscar artifacts | Por nombre o slug |
| Leer artifact | HTML como texto, JSON store, muestras de tablas, metadatos de blobs |
| Listar fuentes de datos | Conexiones REST en vivo de un artifact |
| Ejecutar fuente de datos | Corre una query REST en vivo (owner o miembro del workspace) |
| Enviar snapshot | Renderiza la página a PNG y la entrega en el chat |
| Enviar PDF | Renderiza la página a PDF y la entrega en el chat |

### Escritura y gestión (requiere confirmación)

Las acciones que mutan datos muestran un teclado inline **Confirm / Cancel**. El
permiso se re-verifica en el momento en que tocás Confirm — no cuando se crea la
propuesta.

| Capacidad | Quién puede usarla |
| --- | --- |
| Listar alertas de métricas | Cualquier usuario vinculado |
| Listar jobs programados | Cualquier usuario vinculado |
| Pausar / reanudar / eliminar una alerta | Owner de la alerta |
| Pausar / reanudar / eliminar un job | Owner del job |
| Compartir artifact por email | Owner del artifact |
| Ejecutar el crew de IA de la página | Owner o editor |
| Editar contenido de la página | Owner o editor |
| Agregar una fila a una tabla (`sdk.table()`) | Owner o editor |
| Actualizar filas de una tabla (por id o filtro) | Owner o editor |
| Establecer una clave en el JSON store (`sdk.json`) | Owner o editor |

Las escrituras de datos pasan por los mismos handlers que la [API de datos](/es/guides/data/).
Las reglas de `access_policy` a nivel de fila se aplican — un editor con alcance de fila
solo puede escribir dentro de su scope permitido, y el JSON store permanece solo para
owner/editor cuando hay una policy activa.

El bot escribe en tablas **existentes** únicamente; no crea una tabla desde el chat.
Usá `read_artifact` primero para conocer las columnas de una tabla o las claves JSON
antes de dar forma a una escritura.

## Seguridad

El acceso se resuelve a través de la misma puerta que cualquier otra llamada a la API
de ShareOut:

| Nivel de acceso | ¿El bot ve el artifact? |
| --- | --- |
| Owner | Sí — acceso completo |
| Colaborador (share explícito) | Sí — rol y política de fila respetados |
| Miembro del workspace + `visibility: workspace` | Sí — rol viewer + política de fila |
| Artifact privado del workspace (no compartido con vos) | No |
| Solo link público/no listado | No (salvo que seas owner o colaborador) |

Las credenciales quedan del lado del servidor. El bot nunca recibe tokens de API ni
secrets del workspace. Las propuestas de escritura se almacenan por chat en un
Durable Object coordinador y se consumen una sola vez al confirmar.

## Notificaciones desde el bot

Los jobs programados y las alertas de métricas pueden entregarse a tu chat de Telegram
vinculado. Configurá `action: telegram` en un job o alerta y omitís `chatId` para
enrutar automáticamente a tu propio chat. Ver [Jobs programados](/es/guides/jobs/)
para la referencia completa de configuración.

## Límites de uso

El rate limiting por chat usa la misma cuota de AI chat que el agente dentro de la
app. El bot está controlado por el feature flag `ai.telegram_bot` en tu cuenta.

## Relacionado

- [Agente de chat con IA](/es/guides/ai-agent/) — widget de chat para visitantes dentro de un artifact publicado
- [Crew](/es/guides/crew/) — agentes autónomos del servidor (destino de `ask_crew` de la página)
- [Jobs programados](/es/guides/jobs/) — programá entregas, incluido `action: telegram`
- [Alertas de métricas](/es/guides/metric-alerts/) — alertas por umbral con entrega a Telegram
- [Pedir ayuda](/es/everyone/get-help/) — abrir y seguir tickets de soporte desde cualquier canal
- [SDK: Agent store](/es/sdk/agent/) — referencia de `sdk.agent` para el chat en la página
