---
title: Slack bot
description: Link your ShareOut account to Slack DMs and manage your artifacts from chat — read, snapshot, write data, and get notified.
---

import { Steps, Aside } from '@astrojs/starlight/components';

Chat with your ShareOut pages from **Slack DMs**. After linking your account, a
strictly-scoped AI assistant can find, read, and summarize your artifacts, run live REST
data sources, send snapshots/PDFs, and — with your explicit **Confirm** button — pause
alerts, share pages, run a crew, publish content edits, or write to a page's data.

<Aside type="note">
This is different from `sdk.agent`, the visitor-facing chat widget you embed inside a
published artifact. The Slack bot operates across every artifact you can access from your
account. It is also different from [Slack delivery](/integrations/slack/) — one-shot and
cron **outbound** posts to channels or DMs. This guide covers the **conversational** DM
bot (`/shareout` + free text).
</Aside>

## Link your account

<Steps>

1. Install the ShareOut Slack app on a workspace and connect it under **Workspace →
   Connections** (OAuth bot token).
2. Open **ShareOut → Settings → Connect Slack**.
3. Pick the workspace connection; ShareOut matches your login email to your Slack profile
   (`users:read.email`).
4. Open a **DM with ShareOut** in Slack and try `/shareout help` or ask naturally:
   *"summarize the sales dashboard"*.

</Steps>

To disconnect, send `/shareout unlink` in the DM or link again from Settings (replaces the
prior link).

## Commands

All commands use the `/shareout` slash command (subcommands mirror Telegram where
possible):

| Command | Action |
| --- | --- |
| `/shareout help` | Show command list |
| `/shareout artifacts` | List pages in current scope (Block Kit cards) |
| `/shareout search {text}` | Search pages by name/slug |
| `/shareout workspaces` | List workspaces you can access |
| `/shareout workspace {slug}` | Switch scope to one workspace |
| `/shareout workspace all` | Search all accessible pages |
| `/shareout personal` | Personal pages only |
| `/shareout status` | Linked account + current scope |
| `/shareout settings` | Link to ShareOut settings |
| `/shareout unlink` | Disconnect this DM |
| `/shareout snapshot {page}` | Agent sends a PNG |
| `/shareout pdf {page}` | Agent sends a PDF |
| `/shareout alerts` / `/shareout schedules` | List alerts / scheduled jobs |
| `/shareout support {message}` | Open a support ticket (same system as the in-app Help button) |

Free-text messages (no slash) go to the same AI agent as [Telegram](/guides/telegram-bot/).
See [Get help](/everyone/get-help/) for the full ticket lifecycle.

## Workspace scope

Scope persists per linked Slack DM. The default covers **all pages** you can access —
personal and workspace artifacts combined.

## Artifact cards

`/shareout artifacts` and `/shareout search` return **Block Kit cards** (up to 10):

| Button | What it does |
| --- | --- |
| **Open Page** | Opens the live artifact URL |
| **Snapshot** | Renders a PNG and sends it in chat |
| **PDF** | Renders a PDF and sends it in chat |
| **Ask AI** | Starts an agent turn about that page |

Write proposals (share, edit, crew, table/json writes) show **Confirm / Cancel**
buttons; nothing runs until Confirm.

## What the bot can do

Same tool suite as the [Telegram account assistant](/guides/telegram-bot/#what-the-bot-can-do)
— capabilities and confirmation rules are identical. Data writes go through the same
handlers as the [data API](/guides/data/).

## Security

Access is resolved through the same gate as every other ShareOut API call (owner,
collaborator, workspace member, row-level `access_policy`). Credentials stay
server-side.

## Rate limits

Per-user AI chat quota (same as in-app agent chat). Gated by the `ai.slack_bot` feature
flag on your account.

## Related

- [Telegram bot](/guides/telegram-bot/) — feature-parity reference on Telegram
- [Slack delivery](/integrations/slack/) — outbound posts (jobs, alerts, one-shot share)
- [AI chat agent](/guides/ai-agent/) — visitor-facing chat widget inside a published artifact
- [Crew](/guides/crew/) — server-side autonomous agents on a single artifact
- [Scheduled jobs](/guides/jobs/) — schedule deliveries, including `action: slack`
- [Get help](/everyone/get-help/) — raise and follow support tickets from any channel
