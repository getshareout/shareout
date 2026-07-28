---
title: Self-host secrets
description: Required vs optional Worker secrets and vars for a self-hosted ShareOut instance.
---

Set secrets with `npx wrangler secret put NAME` (or the Cloudflare dashboard).
Vars go in `wrangler.toml` `[vars]` or the dashboard **Variables** tab.

## Required for a working boot

| Name | Kind | Notes |
|------|------|--------|
| `SESSION_SECRET` | secret | Long random string (`openssl rand -hex 32`). Signing sessions & tokens. |
| `SHAREOUT_BASE_URL` | var | Public origin of this instance, no trailing slash. Must match what browsers and agents call. |

D1, R2, KV, and Durable Object bindings come from `wrangler.toml` — the Deploy
button provisions names; replace placeholder IDs after create if needed.

## Strongly recommended

| Name | Kind | Notes |
|------|------|--------|
| `SETUP_ADMIN_EMAIL` | var | First admin must match this email; otherwise the first signed-in user becomes admin while nothing names one. |
| `INSTANCE_ADMIN_EMAILS` | var | Comma-separated emails with `/admin` access. How you add an instance owner without editing source — see [Ops](/self-host/ops/#running-the-instance). |

## Optional auth & mail

| Name | Kind | Notes |
|------|------|--------|
| — | — | **Password sign-in needs no configuration.** It is always available and is how `/setup` creates the first admin. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | secret | Enables Google on `/auth/login`. Callback: `{SHAREOUT_BASE_URL}/auth/callback`. |
| Email binding `EMAIL` | binding | Enables emailed one-time codes. Without it those codes only reach the worker log. |
| `EMAIL_DEFAULT_FROM` | var | From-address when Email is bound. |

## Optional product features

| Name | Kind | Notes |
|------|------|--------|
| `ARTIFACT_ORIGIN` | var | Second origin for untrusted content; unset = same-zone. |
| `ADMIN_ALERTS_DISABLED` | var | `1` to silence Telegram/ops alerts (OSS template default). |
| `TEAM_METRICS_ENABLED` | var | `0` on self-host (OSS template default). |
| `STORAGE_QUOTA_BYTES` / `STORAGE_MAX_FILE_BYTES` | var | Per-owner storage caps. Unset or `0` = unlimited, the default. |
| `DAILY_BANDWIDTH_BYTES_PER_OWNER` | var | Auto-pause an owner's public artifacts over this daily estimated egress. Unset or `0` = no cap, the default. |
| `ARTIFACT_BADGE` | var | `1` adds a "Made with ShareOut" badge to public artifacts. Off by default. |
| `OPEN_VISIBILITY_DISABLED` | var | `1` keeps every artifact private; no public links. |
| `ADMIN_BRIDGE_SECRET` | secret | **Leave unset** unless you run a private bridge worker. Unset ⇒ `/internal/admin/*` denies all. |
| Telegram / Slack bot tokens | secret | Only if you use those integrations. |
| `OPENAI_API_KEY` / `VERCEL_AI_GATEWAY` | secret | **AI is off until one is set** — Crew, assistants, editor AI, knowledge. See [Ops → AI providers](/self-host/ops/#ai-providers). |
| `CREDENTIALS_KEY` | secret | `openssl rand -hex 32`. Encrypts per-workspace AI keys and connector credentials; those endpoints refuse without it. |

## Local development

Copy `shareout-app/.dev.vars.example` → `.dev.vars` and set at least
`SESSION_SECRET`. Use `/auth/dev?email=you@example.com&redirect=/home` for a
session without OAuth.
