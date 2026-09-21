---
title: AI provider
description: Give your instance an LLM key, or run without one on purpose.
---

Every AI feature in ShareOut is inert until the instance has a provider key. Nothing
crashes — the features are simply dead, quietly. This page is how you turn them on, and
what stays off if you choose not to.

## What is off without a key

- **Crew AI** — crews cannot plan or run
- **Ask your space** — the home assistant
- **In-artifact chat** — the visitor-facing assistant
- **Editor AI** — rewrite, shorten, translate, fix grammar
- **Knowledge** — ingest, distill, consolidate
- **Auto-summaries** — artifact TL;DRs

Everything else — publishing, data, realtime, sharing, scheduling, delivery — works
without an LLM key. An instance with no AI is a legitimate configuration, not a broken
one.

## Three providers

The chain supports three, and by default tries them in this order:

| Order | Secret | What it is |
|-------|--------|------------|
| 1 | `VERCEL_AI_GATEWAY` | A Vercel AI Gateway key. Useful when you want routing, budgets or observability in front of the model |
| 2 | `ANTHROPIC_API_KEY` | An Anthropic API key, called directly on the native Messages API |
| 3 | `OPENAI_API_KEY` | An OpenAI API key, called directly |

Set any of them. With more than one, a provider-level failure (`401`, `402`, `403`, `429`,
or any `5xx`) fails over to the next entry, so a gateway that runs out of credit does not
take your assistant or crews down.

To change the order, set `AI_PROVIDER_ORDER` to a comma-separated list, e.g.
`anthropic,openai`. Configured providers you leave out still follow, in the default order.

Models: on the gateway, the assistant, crews and page builds all use the same model —
`deepseek/deepseek-v4.1-flash` by default (see [Pick a model](#pick-a-model) to change
it without touching code — a workspace or instance choice there takes priority). On
Anthropic direct, everything uses Claude Sonnet 5 (`claude-sonnet-5`); on OpenAI direct,
`gpt-4o`. `BUILD_MODEL` is a build-agent-only fallback below that. Model ids live in
`src/data/agent/models.ts`.

## Set it

```bash
cd shareout-app
npx wrangler secret put ANTHROPIC_API_KEY
# or
npx wrangler secret put VERCEL_AI_GATEWAY
# or
npx wrangler secret put OPENAI_API_KEY
```

Secrets take effect immediately — no redeploy.

Verify by reading the instance config back, rather than trusting the command:

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Authorization: Bearer $SHAREOUT_TOKEN" \
  | jq '.ai'
```

`providers` should list what you set, in failover order. An empty array means every AI
feature is still inert.

## Per-workspace keys

A workspace can bring its own key instead of spending the instance's, which is how you
bill AI to the team using it:

```bash
curl -sS -X PUT "$ORIGIN/v1/workspaces/$WORKSPACE_ID/llm" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"provider":"openai","apiKey":"sk-..."}'
```

`provider` must be `openai` or `vercel-gateway`; per-workspace Anthropic keys are not supported yet.

This needs **`CREDENTIALS_KEY`** set, because the key is encrypted at rest:

```bash
openssl rand -hex 32 | npx wrangler secret put CREDENTIALS_KEY
```

Without it the endpoint returns `CONFIG_ERROR` and the workspace silently keeps using
the instance key. `CREDENTIALS_KEY` is also what encrypts stored connector credentials,
so it is worth setting even if you never use per-workspace AI keys.

A workspace with its own key uses it; everyone else falls back to the instance chain.

## Pick a model

The Vercel AI Gateway model is not hardcoded — pick any model the gateway serves, per
workspace or instance-wide, from its live catalog rather than a list baked into this repo:

```bash
# What the gateway offers right now (requires VERCEL_AI_GATEWAY to be set)
curl -sS "$ORIGIN/v1/ai/gateway-models" -H "Authorization: Bearer $SHAREOUT_TOKEN" | jq '.models'

# Set a workspace's own model (admin of that workspace)
curl -sS -X PUT "$ORIGIN/v1/workspaces/$WORKSPACE_ID/llm/model" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"model":"deepseek/deepseek-v4.1-flash"}'

# Set the instance-wide default (superadmin)
curl -sS -X PUT "$ORIGIN/v1/admin/ai-settings" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"defaultGatewayModel":"deepseek/deepseek-v4.1-flash"}'
```

Precedence: a workspace's own model wins, then the instance default, then the hardcoded
`deepseek/deepseek-v4.1-flash`. `DELETE .../llm/model` (or `defaultGatewayModel: null`)
clears an override back to the next fallback. Both also have a dropdown — Settings → AI
in a workspace, and `/admin?view=instance` → **Default AI model** for the instance.
This only applies to the `vercel-gateway` provider entry; the Anthropic- and
OpenAI-direct entries keep their own fixed model, since they cannot serve an arbitrary
gateway catalog id.

## Cost

The instance key pays for every AI feature every member uses. Before opening an instance
to a whole company:

- `/admin?view=tokens` shows LLM token use and cost over time
- `/admin?view=costs` puts it next to the rest of the instance spend
- per-workspace keys move the bill to the workspace that generates it

## Feature flags that stay off by default

Most AI surfaces are **on** once a key exists (`ai.crew`, `ai.web_agent`, visitor/editor
chat, Telegram bot). Two stay **off** until an instance admin enables them under
**Admin → Features** (or the workspace feature API):

| Flag | Why it is opt-in |
|------|------------------|
| `ai.create` | `/create` is a multi-step plan/preview/publish loop — easy to burn tokens on a public instance |
| `ai.slack_bot` | Needs a Slack app, OAuth, and email match; shipping it on by default confuses instances that only use Slack as a delivery destination |

Telegram (`ai.telegram_bot`) is on by default because connect is a single bot token and a
Settings link — still inert without an LLM key.
