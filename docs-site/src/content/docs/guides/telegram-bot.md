---
title: Telegram bot
description: Link your ShareOut account to Telegram and manage your artifacts from chat — read, snapshot, write data, and get notified.
---

import { Steps, Aside } from '@astrojs/starlight/components';

**@ShareOutAI_bot** is an account-level assistant in Telegram. Once linked, it can
find and read your artifacts, render snapshots and PDFs, run live REST data sources,
write to a page's data, and let you pause alerts or manage scheduled jobs — all with
an explicit confirmation step before anything mutates.

<Aside type="note">
This is different from `sdk.agent`, the visitor-facing chat widget you embed inside
a published artifact. The Telegram bot operates across every artifact you can access
from your account. See [AI chat agent](/guides/ai-agent/) for the in-page assistant,
and [Crew](/guides/crew/) for server-side autonomous agents on a single artifact.
</Aside>

## Link your account

<Steps>

1. Open **ShareOut → Settings → Connect Telegram**.
2. Tap the deep link — it contains a one-time code valid for **15 minutes**.
3. The bot confirms the link and registers a slash-command menu.
4. Send any message to start: ask it to find a page, pull fresh numbers, or send a
   snapshot.

</Steps>

If the link expires, generate a new one from Settings. One ShareOut account can be
linked to multiple Telegram chats.

## Voice messages

Send a **voice note** — or forward an audio file — instead of typing. The bot
transcribes it with Cloudflare Workers AI Whisper (automatic language detection, so
Spanish, English, and mixed clips all work), echoes back what it heard
(`🎙️ "…"`), then treats the transcript exactly like a typed message. **Spoken slash
commands work too** — say "snapshot the sales dashboard" and it runs `/snapshot`.

<Aside type="note">
Clips up to about 10 minutes / 20 MB are accepted; longer ones are politely declined.
Each transcription is logged for cost visibility but is not billed to a workspace
balance.
</Aside>

## Workspace scope

The bot remembers which pages to search across sessions:

| Command | Action |
| --- | --- |
| `/workspaces` | Show a workspace picker (inline buttons) |
| `/workspace {name}` | Switch to a workspace by name or slug |
| `/personal` | Personal pages only |
| `/status` | Show the linked account email and current scope |

The default scope covers **all pages** you can access — personal and workspace
artifacts combined. Linked identity groups are honoured, so a personal login that
belongs to a workspace account sees those artifacts too.

## Artifact cards

`/artifacts` and `/search` return tappable cards (up to 10) instead of plain text.
Each card has:

| Button | What it does |
| --- | --- |
| **Open Page** | Opens the live artifact URL |
| **Snapshot** | Renders a PNG and sends it in chat |
| **PDF** | Renders a PDF and sends it in chat |
| **Ask AI** | Starts an agent turn about that page |
| **Share** | Starts a share-by-email flow |

Slash shortcuts mirror the cards: `/snapshot {page}`, `/pdf {page}`,
`/share {page} with {email}`, `/alerts`, `/schedules`.

### Support tickets

| Command | Action |
| --- | --- |
| `/support {message}` | Open a support ticket (same system as the in-app Help button) |
| `/bug {message}` | Alias for `/support` |

See [Get help](/everyone/get-help/) for the full ticket lifecycle.

## What the bot can do

### Read and media (immediate, no confirmation)

| Capability | Description |
| --- | --- |
| List artifacts | All pages you can access |
| Search artifacts | By name or slug |
| Read artifact | HTML as text, JSON store, table samples, blob metadata |
| List data sources | Live REST connections on an artifact |
| Run data source | Execute a live REST query (owner or workspace member) |
| Send snapshot | Render a page to PNG and deliver in chat |
| Send PDF | Render a page to PDF and deliver in chat |

### Write and manage (confirmation required)

Mutating actions show an inline **Confirm / Cancel** keyboard. Permission is
re-checked at the moment you tap Confirm — not when the proposal is created.

| Capability | Who can use it |
| --- | --- |
| List metric alerts | Any linked user |
| List scheduled jobs | Any linked user |
| Pause / resume / delete an alert | Alert owner |
| Pause / resume / delete a job | Job owner |
| Share artifact by email | Artifact owner |
| Run the page's AI crew | Owner or editor |
| Edit page content | Owner or editor |
| Add a row to a table (`sdk.table()`) | Owner or editor |
| Update rows in a table (by id or filter) | Owner or editor |
| Set a key in the JSON store (`sdk.json`) | Owner or editor |

Data writes go through the same handlers as the [data API](/guides/data/). Row-level
`access_policy` rules apply — a row-scoped editor can only write within their allowed
scope, and the JSON store stays owner/editor-only when a policy is active.

The bot writes to **existing** tables only; it won't create a table from chat. Use
`read_artifact` first to learn a table's columns or JSON keys before shaping a write.

## Security

Access is resolved through the same gate as every other ShareOut API call:

| Access level | Bot sees the artifact? |
| --- | --- |
| Owner | Yes — full access |
| Collaborator (explicit share) | Yes — role and row-level policy honoured |
| Workspace member + `visibility: workspace` | Yes — viewer role + row-level policy |
| Private workspace artifact (not shared with you) | No |
| Public link only | No (unless you are owner or collaborator) |

Credentials stay server-side. The bot never receives API tokens or workspace secrets.
Write proposals are stored per chat in a Durable Object coordinator and consumed once
on tap.

## Notifications from the bot

Scheduled jobs and metric alerts can deliver to your linked Telegram chat. Set
`action: telegram` in a job or alert config and omit `chatId` to route to your own
chat automatically. See [Scheduled jobs](/guides/jobs/) for the full config reference.

## Rate limits

Per-chat rate limiting uses the same AI chat quota as the in-app agent chat. The bot
is gated by the `ai.telegram_bot` feature flag on your account.

## Related

- [AI chat agent](/guides/ai-agent/) — visitor-facing chat widget inside a published artifact
- [Crew](/guides/crew/) — server-side autonomous agents (the page's `ask_crew` target)
- [Scheduled jobs](/guides/jobs/) — schedule deliveries, including `action: telegram`
- [Metric alerts](/guides/metric-alerts/) — threshold alerts with Telegram delivery
- [Get help](/everyone/get-help/) — raise and follow support tickets from any channel
- [SDK: Agent store](/sdk/agent/) — `sdk.agent` reference for in-page chat
