---
title: Integrations overview
description: Connect external services to your artifacts.
---

Pull live data from external services into your artifacts, or push artifacts out
to where your team already works.

## Available

| Provider | What it gives you |
| --- | --- |
| [Google Sheets](/integrations/google-sheets/) | Read spreadsheet data with OAuth |
| [Google Analytics](/integrations/google-analytics/) | GA4 reports via pasted service-account key |
| [Google Ads](/integrations/google-ads/) | Campaign spend, clicks, conversions |
| [Facebook Ads](/integrations/facebook-ads/) | Meta campaign insights |
| [Shopify](/integrations/shopify/) | Products, orders, inventory |
| [Slack](/integrations/slack/) | Deliver artifacts to a channel or DM |
| Tienda Nube | LATAM e-commerce |
| GitHub | Backup and export |
| CORS proxy | Call allow-listed external APIs from the page |

## Two kinds of connection

- **Per-artifact / OAuth-in-page** — e.g. Google Sheets: the visitor (or owner)
  authorizes, and the artifact fetches data. Simple, no admin setup.
- **Workspace-level** — platform connectors and REST/warehouse connectors are
  defined once per workspace. Artifacts reference them by name via
  `sdk.connection('name')`. Most platform connectors now use a **bring-your-own
  credentials** model: paste your provider token or service-account key in the
  workspace admin catalog, **Test** before saving, then copy the
  `sdk.connection('name')` snippet.

The connector catalog is always visible in workspace admin — browse providers,
connect, and test without hunting through settings.

## Token safety

Credentials are never exposed to the page — calls are proxied through the Worker,
and secrets are encrypted at rest. Use `POST /v1/workspaces/{id}/connections/test`
to verify pasted credentials before saving. For LLM API keys (OpenAI, Anthropic,
…), use the secrets proxy in the [AI agent guide](/guides/ai-agent/#bring-your-own-keys).
