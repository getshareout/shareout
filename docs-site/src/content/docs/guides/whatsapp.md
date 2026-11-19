---
title: WhatsApp assistant
description: Chat with your workspace's pages on WhatsApp — the same assistant and commands as Telegram, turned on per workspace and billed per reply.
---

import { Steps, Aside } from '@astrojs/starlight/components';

The ShareOut assistant also answers on **WhatsApp**: the same assistant, commands and
confirmations as the [Telegram bot](/guides/telegram-bot/). It works inside one workspace at
a time and only sees what your ShareOut account can see there.

It only answers. People write first; ShareOut never starts a WhatsApp conversation.

## Turn it on for a workspace

WhatsApp is **off** until a workspace owner or admin turns it on: **Admin → Settings →
WhatsApp → Let members use the assistant on WhatsApp**. The switch shows only when the
instance has a WhatsApp number set up.

Each reply the assistant sends is a WhatsApp message billed to the workspace. It counts
toward the workspace's monthly AI budget and shows in the AI report under **By channel →
WhatsApp** and **WhatsApp messages**, next to the assistant's own AI use.

## Connect your WhatsApp

<Steps>

1. In ShareOut, open your account menu → **Connect WhatsApp**.
2. WhatsApp opens with a message ready, including a one-time code valid for **15 minutes**.
   Tap **Send**.
3. The assistant confirms who you are and which workspace it works in. If you belong to
   several workspaces with WhatsApp on, it asks which one.

</Steps>

Send `/unlink` to disconnect. To move to another workspace, send `/workspace`.

## What's different from Telegram

Every WhatsApp message costs money, so the assistant writes **one message per answer**:

- no live typing of the answer and no "working on it" lines — you see *typing…* until it
  is ready;
- `/artifacts` and `/search` send one list with each page's link, instead of a card per page;
- a voice note is answered directly, without echoing the transcript first;
- support replies arrive by email and in ShareOut (WhatsApp only lets ShareOut answer within
  24 hours of your last message).

Photos and files are not read; send text or a voice note.

## For instance operators

The assistant uses Meta's WhatsApp Cloud API directly. You need a verified Meta business, a
WhatsApp Business phone number, an app with the WhatsApp product, and a payment method in
Meta's Billing Hub (service messages are charged since October 1, 2026, after 1,000 free a
month per number).

| Variable | Kind | What |
| --- | --- | --- |
| `WHATSAPP_PHONE_NUMBER_ID` | var | The business phone number id (Meta app → WhatsApp → API setup). |
| `WHATSAPP_ACCESS_TOKEN` | secret | A system-user token with `whatsapp_business_messaging`. |
| `WHATSAPP_APP_SECRET` | secret | The Meta app secret; every webhook call is checked against its signature. |
| `WHATSAPP_VERIFY_TOKEN` | secret | Any string; type the same one in the webhook settings. |
| `WHATSAPP_BUSINESS_NUMBER` | var | The number in international digits (`5491112345678`), for the Connect link. |

Point the app's webhook to `https://<your instance>/whatsapp/webhook` and subscribe to the
**messages** field.

<Aside type="caution">
Meta's terms forbid offering a general-purpose AI assistant on its business platform. The
assistant stays on ShareOut — the workspace's pages, data, knowledge, sharing, schedules and
alerts — and declines anything else in one sentence.
</Aside>

Each reply is metered at Meta's list price for the recipient's country (the USD rate card
effective October 1, 2026), then resold at the workspace's AI markup like the rest of its AI
use. The free monthly tier is not passed through.
