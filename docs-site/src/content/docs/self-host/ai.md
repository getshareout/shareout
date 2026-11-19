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
`anthropic/claude-sonnet-5.5` by default (see [Pick a model](#pick-a-model) to change
it without touching code — a workspace or instance choice there takes priority). On
Anthropic direct, everything uses Claude Sonnet 5.5 (`claude-sonnet-5-5`); on OpenAI direct,
`gpt-4o`. `BUILD_MODEL` is a build-agent-only fallback below that. Reading a scanned
document (a PDF with no text layer) is the exception: it uses Claude Haiku 5.5
(`anthropic/claude-haiku-5.5` on the gateway, `claude-haiku-5-5` on Anthropic direct)
unless `SCAN_MODEL` names another model; the workspace's model choice does not apply to
it, and OpenAI direct keeps `gpt-4o`. Model ids live in `src/data/agent/models.ts`.

## Build agent (optional)

Turn on **Page build agent** under Admin → Features (per workspace, or for the whole
instance) and AI page builds run as a tool-using agent instead of one long completion.
`BUILD_AGENT=on` forces it for every workspace; `BUILD_AGENT=off` is a kill switch that
wins over the flag. It writes the page as files in small steps, checks its own work (JavaScript
syntax, manifest, missing files, undeclared tables, ShareOut's publishing rules), fixes
what the check finds, and only then publishes. With a `BROWSER` binding it also tests the
published page and fixes up to two rounds of problems; without one, it publishes after the
static check. If it still can't produce a passing page, nothing is announced as done: the
user is told, and the operator gets an alert when [Telegram alerts](#alerts) are
configured. Default off. It works on every route above; on direct Anthropic it also uses server-side
compaction, context editing and a task budget.

All AI page builds (agent or not) think at `BUILD_EFFORT` (`low`, `medium` or `high`;
default `medium`), use the workspace's model choice (then the instance's, then
`BUILD_MODEL`), and are given the workspace's brand accent, logo, language and house-style
context file. The agent can also look up ShareOut's artifact guide while it builds.

Every build, agent or one-shot, is listed in `/admin?view=health` → **Page builds** (the
latest 25, kept 90 days): when, outcome (`published`, `previewed`, `gave_up`, `failed`,
`truncated`), workspace, path, duration, tokens in and out, cost, and each step behind
**steps** — model calls, tool calls, static checks, the page test and the publish.

The same switch moves the assistant's page edits onto the agent: it changes an HTML page's
existing files in small steps, checks that the change broke nothing the page did not
already have, and shows the change for the user to confirm before anything is published.
Other page types, and workspaces where it is off, keep the one-shot editor.

### Builds that outlive the tab

With the `BUILD_JOBS` Durable Object bound (it is in the default `wrangler.toml`), a page
build from Create or from a confirmed assistant build runs as a job on the server instead of
inside the browser's request. Closing the tab doesn't stop it: the page is still published,
the assistant's result still lands in its thread, and a build that ends while nobody is
watching shows up in the bell and on Home ("Needs you"), in the user's language. A client
that loses its connection reattaches with `GET /v1/builds/{id}/events` and gets the steps so
far. Each user runs one build at a time (a double click joins the running one), and a job
still running after 12 minutes is stopped. Without the binding, builds run inline as before.
Adding the class needs a `wrangler deploy` (not `versions upload`) the first time.

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
`anthropic/claude-sonnet-5.5`. `DELETE .../llm/model` (or `defaultGatewayModel: null`)
clears an override back to the next fallback. Both also have a dropdown — **Admin → AI &
models** in a workspace, and `/admin?view=instance` → **AI defaults** for the instance.
This only applies to the `vercel-gateway` provider entry; the Anthropic- and
OpenAI-direct entries keep their own fixed model, since they cannot serve an arbitrary
gateway catalog id.

## Cost

The instance key pays for every AI feature every member uses. Before opening an instance
to a whole company:

- `/admin?view=tokens` shows LLM token use and cost over time
- `/admin?view=costs` puts it next to the rest of the instance spend
- per-workspace keys move the bill to the workspace that generates it

### What a workspace is charged: cost × markup

Every AI amount a workspace sees — its Admin → Billing (spend, monthly AI budget, AI
report), its Summary, crew and Knowledge costs, and the AI usage line on an invoice — is
its **price**: the metered cost × a markup. Storage, serving, email and browser time are
not marked up. The markup in force is the first of:

1. the workspace's own markup;
2. the instance default;
3. none — the workspace is billed at cost (1×).

Set the instance default in `/admin?view=instance` → **AI defaults** (*AI resale
markup*), or:

```bash
curl -sS -X PUT "$ORIGIN/v1/admin/ai-settings" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"defaultMarkup":1.5}'
```

One workspace's markup is set from its Admin → Billing (a block only instance admins
see) or with `PUT /v1/workspaces/$WORKSPACE_ID/ai-markup` `{"markup": 1.5}`; `null`
falls back to the instance default. Both take a multiplier from 1 (at cost) to 10;
anything else is `400 VALIDATION_ERROR`. Workspace admins never see the cost, the markup
or the margin, and a workspace markup change is not written to that workspace's audit
log, which its admins can read.

A workspace's **monthly AI budget** (set by its own admins in Admin → Billing) is
measured at its price, so the budget, the AI report and an invoice's usage line agree.

### Alerts

Set `SUPPORT_ALERT_TELEGRAM_CHAT_ID` (a Telegram chat id) and `TELEGRAM_BOT_TOKEN` and
the operator gets a Telegram message, each throttled so a bad day sends one, not
hundreds:

| When | Throttle | Knob |
|------|----------|------|
| An instance provider refuses calls for lack of credit or a spend limit (a workspace's own key never alerts) | once an hour per provider | — |
| The instance's AI spend for the UTC day crosses a line. Costs are priced hourly, so this can trail by up to an hour | once a day | `AI_SPEND_ALERT_USD_PER_DAY` — off when unset |
| The Vercel AI Gateway credit falls below a floor (checked hourly; also written to the Worker log as an error) | once a day | `AI_CREDIT_ALERT_USD` — default `20` |
| A page build failed or the build agent gave up | every time | — |
| A new support ticket opens | every time | — |

Without the chat id and bot token nothing is sent; the checks still run.

## All AI settings

| Name | Kind | Default | What it does |
|------|------|---------|--------------|
| `VERCEL_AI_GATEWAY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | secret | — | The providers ([above](#three-providers)) |
| `AI_PROVIDER_ORDER` | var | `vercel-gateway,anthropic,openai` | Failover order over the configured providers |
| `BUILD_AGENT` | var | unset (follows the **Page build agent** flag) | `on` forces the [build agent](#build-agent-optional) everywhere; `off` turns it off everywhere |
| `BUILD_EFFORT` | var | `medium` | How hard page builds think: `low`, `medium`, `high`. Anything else falls back to `medium` |
| `BUILD_MODEL` | var | unset | Page builds only, when no workspace or instance model is picked: a gateway slug on the gateway, a first-party id (no `/`) on Anthropic direct |
| `SCAN_MODEL` | var | Claude Haiku 5.5 | Model that transcribes scanned documents: a gateway slug, or a first-party id on Anthropic direct |
| `AI_SPEND_ALERT_USD_PER_DAY` | var | off | Daily spend line for the Telegram [alert](#alerts) |
| `AI_CREDIT_ALERT_USD` | var | `20` | Gateway credit floor for the Telegram [alert](#alerts) |
| `CREDENTIALS_KEY` | secret | — | Needed for [per-workspace keys](#per-workspace-keys) |

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
