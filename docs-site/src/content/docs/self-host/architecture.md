---
title: Self-host architecture
description: Three planes, storage bindings, and how a self-hosted ShareOut instance is wired.
---

ShareOut is a Cloudflare Worker that publishes and serves interactive HTML
artifacts. Every install is self-hosted on **your** Cloudflare account —
configuration (origins, admin roster, optional bindings) is the fork in the road.

## Three planes

1. **Control** — REST API, auth, workspace admin (`/v1/*`, `/auth/*`, `/home`).
2. **Storage** — D1 (metadata), R2 (HTML/assets), KV (slugs / rate limits),
   Durable Objects (tables, realtime, MiniDB, chat, …).
3. **Execution** — Sandboxed artifact HTML in the browser + ShareOut SDK
   (`json` → `table` → realtime).

## Origins

| Var | Role |
|-----|------|
| `SHAREOUT_BASE_URL` | Trusted app apex (cookies, OAuth callback, canonical URLs). |
| `ARTIFACT_ORIGIN` | Optional untrusted content host. Unset ⇒ same-zone paths. |

Workspace subdomains (`https://acme.<apex>/…`) need wildcard DNS to the worker.
Without wildcard DNS, use apex `/@workspace/slug` and `/a/<slug>/` URLs.

## Typical self-host knobs

| | |
|--|--|
| Admin | `/setup` first user, or `SETUP_ADMIN_EMAIL` to lock who can claim it |
| Marketing site | Optional — point `MARKETING_ORIGIN` at your own site, or leave unset |
| Custom domain | Yours — update `SHAREOUT_BASE_URL` after DNS |

## Related

- [Self-host overview](/self-host/overview/)
- [Secrets](/self-host/secrets/)
- [Ops](/self-host/ops/)
- Agent-oriented map: `AGENTS.md` in the public repo
