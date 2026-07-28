---
title: Slack
description: Deliver artifacts to a Slack channel or DM.
---

import { Aside } from '@astrojs/starlight/components';

Send an artifact to Slack — a message, a rendered snapshot, or a PDF — on demand,
on a schedule, or on an event.

<Aside type="note">
For a **conversational DM bot** that reads and writes your pages from Slack chat, see
[Slack bot](/guides/slack-bot/). This page covers **outbound delivery** to channels and
DMs.
</Aside>

## How it works

Slack is a **workspace-level** connection: connect a Slack OAuth app once per
workspace (a bot token, stored encrypted), and any artifact in that workspace can
deliver to Slack. A workspace can hold several named connections (e.g. `team`,
`alerts`).

## Connect a workspace

```text
1. GET /v1/workspaces/{id}/connections/slack/install?connection=team&returnUrl=…
2. Open the returned URL and authorize the Slack app.
3. Slack redirects to /v1/oauth/slack/callback; the bot token is stored.
4. List channels: GET /v1/workspaces/{id}/connections/team/slack/channels
```

Bot scopes include `chat:write`, `files:write`, and `im:write` (DMs). If DM
delivery fails with `missing_scope` on an older connection, reconnect Slack.

## One-shot delivery

From **Home**, open a page tab and use the Inspector **Deliver** section — pick
email, Slack, or Telegram, choose a Slack channel from the searchable picker, and
send immediately (`POST /v1/artifacts/{id}/deliver`). If Slack is not connected
yet, **Connect** starts OAuth from the same panel.

Via API:

`POST /v1/artifacts/{id}/share/slack`:

```json
{ "connection": "team", "targetType": "channel", "channelId": "C0123456789", "mode": "snapshot", "message": "Latest numbers" }
```

DM a user instead:

```json
{ "connection": "team", "targetType": "dm", "slackUserId": "U0123456789", "mode": "pdf" }
```

- `mode`: `message` (text + link button), `snapshot` (PNG), `pdf`, or `both`.
- Channel posts need **owner/editor**; any viewer may DM **themselves**.

## On a schedule or event

Use a [job](/guides/jobs/) with `action: "slack"`:

```json
{
  "artifact_id": "art_abc123",
  "action": "slack",
  "schedule": "0 9 * * 1",
  "config": { "connection": "team", "channelId": "C0123456789", "mode": "snapshot" }
}
```

<Aside type="note">
Slack delivery fails until the workspace has a connection — set one up before
creating Slack jobs. The same destination layer powers email, Discord, and
webhooks, so they all behave the same way.
</Aside>
