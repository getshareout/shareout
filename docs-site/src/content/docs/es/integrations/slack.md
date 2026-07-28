---
title: Slack
description: Entregá artifacts a un canal o DM de Slack.
---

import { Aside } from '@astrojs/starlight/components';

Mandá un artifact a Slack — un mensaje, un snapshot renderizado, o un PDF — a demanda,
de forma programada, o ante un evento.

<Aside type="note">
Para un **bot conversacional por DM** que lee y escribe tus páginas desde Slack, ver
[Bot de Slack](/es/guides/slack-bot/). Esta página cubre la **entrega saliente** a
canales y DMs.
</Aside>

## Cómo funciona

Slack es una conexión **a nivel workspace**: conectá una app de OAuth de Slack una vez por
workspace (un bot token, guardado encriptado), y cualquier artifact de ese workspace puede
entregar a Slack. Un workspace puede tener varias conexiones con nombre (por ejemplo `team`,
`alerts`).

## Conectá un workspace

```text
1. GET /v1/workspaces/{id}/connections/slack/install?connection=team&returnUrl=…
2. Open the returned URL and authorize the Slack app.
3. Slack redirects to /v1/oauth/slack/callback; the bot token is stored.
4. List channels: GET /v1/workspaces/{id}/connections/team/slack/channels
```

Los scopes del bot incluyen `chat:write`, `files:write`, y `im:write` (DMs). Si la
entrega de DM falla con `missing_scope` en una conexión más vieja, reconectá Slack.

## Entrega de una sola vez

Desde **Home**, abrí una pestaña de página y usá la sección **Deliver** del
Inspector — elegí email, Slack o Telegram, seleccioná un canal de Slack desde el
picker buscable y enviá al instante (`POST /v1/artifacts/{id}/deliver`). Si Slack
no está conectado, **Connect** inicia OAuth desde el mismo panel.

Por API:

`POST /v1/artifacts/{id}/share/slack`:

```json
{ "connection": "team", "targetType": "channel", "channelId": "C0123456789", "mode": "snapshot", "message": "Latest numbers" }
```

Para mandar un DM a un usuario:

```json
{ "connection": "team", "targetType": "dm", "slackUserId": "U0123456789", "mode": "pdf" }
```

- `mode`: `message` (texto + botón de link), `snapshot` (PNG), `pdf`, o `both`.
- Los posts en canales necesitan **owner/editor**; cualquier viewer puede mandarse un DM **a sí mismo**.

## De forma programada o ante un evento

Usá un [job](/es/guides/jobs/) con `action: "slack"`:

```json
{
  "artifact_id": "art_abc123",
  "action": "slack",
  "schedule": "0 9 * * 1",
  "config": { "connection": "team", "channelId": "C0123456789", "mode": "snapshot" }
}
```

<Aside type="note">
La entrega a Slack falla hasta que el workspace tenga una conexión — configurá una antes de
crear jobs de Slack. La misma capa de destino alimenta email, Discord y
webhooks, así que todos se comportan igual.
</Aside>
