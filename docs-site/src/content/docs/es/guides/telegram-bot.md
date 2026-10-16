---
title: Bot de Telegram
description: Vinculá tu cuenta de ShareOut a Telegram y manejá tus artefactos desde el chat — leé, sacá snapshots, escribí datos y recibí notificaciones.
---

import { Steps, Aside } from '@astrojs/starlight/components';

**@ShareOutAI_bot** es un asistente a nivel de cuenta en Telegram. Una vez vinculado,
puede encontrar y leer tus artefactos, renderizar snapshots y PDFs, ejecutar fuentes de
datos REST en vivo, escribir datos en un artefacto, y permitirte pausar alertas o
administrar jobs programados — todo con un paso de confirmación explícito antes de
cualquier mutación.

<Aside type="note">
Esto es distinto de `sdk.agent`, el widget de chat para visitantes que se embebe dentro
de un artefacto publicado. El bot de Telegram opera sobre todos los artefactos a los que
podés acceder desde tu cuenta. Ver [Agente de chat con IA](/es/guides/ai-agent/) para
el asistente dentro del artefacto, y [Crew](/es/guides/crew/) para agentes autónomos del
lado del servidor en un artefacto.
</Aside>

## Vincular tu cuenta

<Steps>

1. Abrí **ShareOut → Settings → Connect Telegram**.
2. Tocá el deep link — contiene un código de un solo uso válido por **15 minutos**.
3. El bot confirma la vinculación y registra un menú de comandos slash.
4. Mandá cualquier mensaje para empezar: pedile que encuentre un artefacto, traiga
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

El bot recuerda qué artefactos buscar entre sesiones:

| Comando | Acción |
| --- | --- |
| `/workspaces` | Muestra un selector de workspaces (botones inline) |
| `/workspace {nombre}` | Cambia a un workspace por nombre o slug |
| `/personal` | Solo artefactos personales |
| `/status` | Muestra el email de la cuenta vinculada y el alcance actual |

El alcance por defecto cubre **todos los artefactos** a los que tenés acceso — artefactos
personales y de workspaces combinados. Los grupos de identidades vinculadas se respetan,
así que un login personal que pertenece a una cuenta de workspace también ve esos
artefactos.

## Tarjetas de artefacto

`/artifacts` y `/search` devuelven tarjetas interactivas (hasta 10) en vez de texto
plano. Cada tarjeta tiene:

| Botón | Qué hace |
| --- | --- |
| **Open Page** | Abre el artefacto en vivo (con inicio de sesión en un toque si está activado — ver [Links que abren](#links-que-abren)) |
| **Snapshot** | Renderiza un PNG y lo manda al chat |
| **PDF** | Renderiza un PDF y lo manda al chat |
| **Ask AI** | Inicia un turno del agente sobre ese artefacto |
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
| Listar artefactos | Todos los artefactos a los que tenés acceso, cada uno con un link que abre |
| Buscar artefactos | Por nombre, etiquetas o descripción |
| Leer artefacto | HTML como texto, JSON store, muestras de tablas, metadatos de blobs; un sitio de varias páginas lista sus subpáginas y el bot puede leer cualquiera |
| Encontrar la sección justa | “¿Dónde se cubre X?” → el artefacto, la subpágina, el título de la sección y una cita corta, con un link que abre en esa sección |
| Qué cambió | Historial de versiones: quién publicó, notas de cambio, aprobaciones, cuál está publicada (owner o colaborador) |
| Estado de revisión | Hilos de comentarios: abiertos o resueltos, asignado, versión |
| Listar fuentes de datos | Conexiones REST en vivo de un artefacto |
| Ejecutar fuente de datos | Corre una query REST en vivo (owner o miembro del workspace) |
| Enviar snapshot | Renderiza el artefacto a PNG y lo entrega en el chat |
| Enviar PDF | Renderiza el artefacto a PDF y lo entrega en el chat |

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
| Compartir artefacto por email | Owner del artefacto |
| Ejecutar el crew de IA del artefacto | Owner o editor |
| Editar contenido del artefacto | Owner o editor |
| Agregar una fila a una tabla (`sdk.table()`) | Owner o editor |
| Actualizar filas de una tabla (por id o filtro) | Owner o editor |
| Establecer una clave en el JSON store (`sdk.json`) | Owner o editor |
| Volver a una versión anterior (se guarda como nueva) | Owner o editor |
| Aprobar una versión, o retirar la aprobación | Quien tenga acceso a comentar |
| Resolver, reabrir o asignar un comentario | Quien tenga acceso a comentar |

Las escrituras de datos pasan por los mismos handlers que la [API de datos](/es/guides/data/).
Las reglas de `access_policy` a nivel de fila se aplican — un editor con alcance de fila
solo puede escribir dentro de su scope permitido, y el JSON store permanece solo para
owner/editor cuando hay una policy activa.

El bot escribe en tablas **existentes** únicamente; no crea una tabla desde el chat.
Usá `read_artifact` primero para conocer las columnas de una tabla o las claves JSON
antes de dar forma a una escritura.

## Preguntá dónde se cubre algo

Preguntá con tus palabras — *“¿dónde cubren nuestros procedimientos la clasificación de
residuos y cómo los identificamos?”* — y el bot te responde con el artefacto, la
subpágina (si es un sitio de varias páginas), el título o número de la sección, una cita
corta y un link que abre esa subpágina justo en la sección.

- Con [Conocimiento](/es/teams/knowledge/) activado, los artefactos publicados se
  aprenden **sección por sección en todas las páginas de un sitio**, así que la respuesta
  es inmediata.
- Sin Conocimiento, el bot lee en el momento los pocos artefactos que mejor coinciden y
  que podés abrir.
- En los dos casos solo cita artefactos que **vos** podés abrir.

## Links que abren

Cada link que manda el bot es una URL completa de tu instancia (`/a/{slug}/`, más
`?page=` para una subpágina y `&section=` para una sección), en texto plano para que
Telegram lo haga tocable.

Los artefactos privados o del espacio igual necesitan que inicies sesión en el
navegador que abre Telegram:

- **Por defecto**, la pantalla de inicio de sesión (código por email o Google) te
  devuelve a la página y sección exactas. Iniciás sesión una vez por navegador.
- **Inicio de sesión en un toque** (ajuste de la instancia): quien administra pone
  `TELEGRAM_LOGIN_LINKS=1` y vincula el bot al dominio con `/setdomain` en BotFather. Las
  respuestas traen botones **Abrir** que inician tu sesión con tu cuenta de Telegram
  vinculada. Solo te sirven a vos: si reenviás el botón, Telegram lo firma para quien lo
  toque, así que esa persona ve la pantalla de inicio de sesión de siempre. Cada toque
  sirve una sola vez y vence en minutos.

## Seguridad

El acceso se resuelve a través de la misma puerta que cualquier otra llamada a la API
de ShareOut:

| Nivel de acceso | ¿El bot ve el artefacto? |
| --- | --- |
| Owner | Sí — acceso completo |
| Colaborador (share explícito) | Sí — rol y política de fila respetados |
| Miembro del workspace + `visibility: workspace` | Sí — rol viewer + política de fila |
| Artefacto privado del workspace (no compartido con vos) | No |
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

- [Agente de chat con IA](/es/guides/ai-agent/) — widget de chat para visitantes dentro de un artefacto publicado
- [Crew](/es/guides/crew/) — agentes autónomos del servidor (destino de `ask_crew` del artefacto)
- [Jobs programados](/es/guides/jobs/) — programá entregas, incluido `action: telegram`
- [Alertas de métricas](/es/guides/metric-alerts/) — alertas por umbral con entrega a Telegram
- [Pedir ayuda](/es/everyone/get-help/) — abrir y seguir tickets de soporte desde cualquier canal
- [SDK: Agent store](/es/sdk/agent/) — referencia de `sdk.agent` para el chat en el artefacto
