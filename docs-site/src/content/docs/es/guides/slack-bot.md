---
title: Bot de Slack
description: Vinculá tu cuenta de ShareOut a DMs de Slack y manejá tus artifacts desde el chat — leé, sacá snapshots, escribí datos y recibí notificaciones.
---

import { Steps, Aside } from '@astrojs/starlight/components';

Chateá con tus páginas de ShareOut desde **DMs de Slack**. Una vez vinculada tu cuenta,
un asistente de IA estrictamente acotado puede encontrar, leer y resumir tus artifacts,
ejecutar fuentes de datos REST en vivo, enviar snapshots/PDFs, y — con tu botón
**Confirmar** explícito — pausar alertas, compartir páginas, correr un crew, publicar
ediciones de contenido o escribir datos en una página.

<Aside type="note">
Esto es distinto de `sdk.agent`, el widget de chat para visitantes que se embebe dentro
de un artifact publicado. El bot de Slack opera sobre todos los artifacts a los que podés
acceder desde tu cuenta. También es distinto de la [entrega a Slack](/es/integrations/slack/) —
publicaciones **salientes** one-shot y por cron a canales o DMs. Esta guía cubre el bot
**conversacional** por DM (`/shareout` + texto libre).
</Aside>

## Vincular tu cuenta

<Steps>

1. Instalá la app de ShareOut en Slack y conectala en **Workspace → Connections** (token OAuth del bot).
2. Abrí **ShareOut → Settings → Connect Slack**.
3. Elegí la conexión del workspace; ShareOut matchea tu email de login con tu perfil de Slack (`users:read.email`).
4. Abrí un **DM con ShareOut** en Slack y probá `/shareout help` o preguntá en natural: *"resumí el dashboard de ventas"*.

</Steps>

Para desconectar, enviá `/shareout unlink` en el DM o volvé a vincular desde Settings (reemplaza el link anterior).

## Comandos

Todos los comandos usan el slash `/shareout` (los subcomandos espejan Telegram donde aplica):

| Comando | Acción |
| --- | --- |
| `/shareout help` | Mostrar lista de comandos |
| `/shareout artifacts` | Listar páginas en el scope actual (cards Block Kit) |
| `/shareout search {text}` | Buscar páginas por nombre/slug |
| `/shareout workspaces` | Listar workspaces a los que tenés acceso |
| `/shareout workspace {slug}` | Cambiar scope a un workspace |
| `/shareout workspace all` | Buscar en todas las páginas accesibles |
| `/shareout personal` | Solo páginas personales |
| `/shareout status` | Cuenta vinculada + scope actual |
| `/shareout settings` | Link a settings de ShareOut |
| `/shareout unlink` | Desconectar este DM |
| `/shareout snapshot {page}` | El agente envía un PNG |
| `/shareout pdf {page}` | El agente envía un PDF |
| `/shareout alerts` / `/shareout schedules` | Listar alertas / jobs programados |
| `/shareout support {mensaje}` | Abrir un ticket de soporte (mismo sistema que el botón Ayuda en la app) |

Mensajes de texto libre (sin slash) van al mismo agente de IA que [Telegram](/es/guides/telegram-bot/).
Ver [Pedir ayuda](/es/everyone/get-help/) para el ciclo completo del ticket.

## Scope de workspace

El scope persiste por DM de Slack vinculado. El default cubre **todas las páginas** a las que podés acceder — artifacts personales y de workspace combinados.

## Cards de artifacts

`/shareout artifacts` y `/shareout search` devuelven **cards Block Kit** (hasta 10):

| Botón | Qué hace |
| --- | --- |
| **Open Page** | Abre la URL live del artifact |
| **Snapshot** | Renderiza un PNG y lo envía en el chat |
| **PDF** | Renderiza un PDF y lo envía en el chat |
| **Ask AI** | Inicia un turno del agente sobre esa página |

Propuestas de escritura (share, edit, crew, writes a table/json) muestran botones **Confirmar / Cancelar**; nada corre hasta Confirmar.

## Qué puede hacer el bot

El mismo conjunto de tools que el [asistente de cuenta de Telegram](/es/guides/telegram-bot/#qué-puede-hacer-el-bot) — capacidades y reglas de confirmación idénticas. Las escrituras de datos pasan por los mismos handlers que la [API de datos](/es/guides/data/).

## Seguridad

El acceso se resuelve por la misma puerta que cualquier otra llamada a la API de ShareOut (owner, colaborador, miembro de workspace, `access_policy` a nivel fila). Las credenciales quedan del lado del servidor.

## Límites de tasa

Cuota de chat con IA por usuario (igual que el chat in-app). Gated por el feature flag `ai.slack_bot` en tu cuenta.

## Relacionado

- [Bot de Telegram](/es/guides/telegram-bot/) — referencia de paridad en Telegram
- [Entrega a Slack](/es/integrations/slack/) — publicaciones salientes (jobs, alertas, share one-shot)
- [Agente de chat con IA](/es/guides/ai-agent/) — widget de chat para visitantes dentro de un artifact publicado
- [Crew](/es/guides/crew/) — agentes autónomos del servidor en un artifact
- [Jobs programados](/es/guides/jobs/) — programá entregas, incluido `action: slack`
- [Pedir ayuda](/es/everyone/get-help/) — abrir y seguir tickets de soporte desde cualquier canal
