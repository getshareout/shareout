---
title: Self-host ShareOut
description: Deploy your own ShareOut instance on Cloudflare Workers — Deploy button, secrets, and first admin.
---

import { Steps } from '@astrojs/starlight/components';

Run ShareOut on **your** Cloudflare account. ShareOut is **self-hosted only** —
there is no hosted cloud product and no ShareOut checkout. You need a Cloudflare
account and Cloudflare’s **Workers Paid** plan (Durable Objects); that billing is
Cloudflare’s, not ShareOut’s.

## Agents: start here

If a coding agent is installing ShareOut for you, point it at the **deploy skill**
in the product repo (source of truth for all agent docs):

- [skills/ShareOutSkill/deploy/SKILL.md](https://github.com/getshareout/shareout/blob/main/skills/ShareOutSkill/deploy/SKILL.md)
- Cloudflare checklist + companion skills: [deploy/cloudflare.md](https://github.com/getshareout/shareout/blob/main/skills/ShareOutSkill/deploy/cloudflare.md)
- Where the skill is allowed to live: [skills/README.md](https://github.com/getshareout/shareout/blob/main/skills/README.md)

Do **not** edit the separate [`shareout-skill`](https://github.com/getshareout/shareout-skill)
repo as primary — it is a publish mirror. After deploy, agents load
`GET {ORIGIN}/v1/skill` from **your** Worker.

## Prerequisites

- Cloudflare account with **[Workers Paid](https://developers.cloudflare.com/workers/platform/pricing/)**
  (required — Durable Objects power tables, realtime, and chat; Cloudflare’s plan, not a ShareOut fee)
- Node 24+ for local development / CLI deploy
- GitHub access to the public ShareOut repo (Deploy button clones it)

## Deploy

<Steps>

1. **CLI (about five minutes)** — recommended:

   ```bash
   git clone https://github.com/getshareout/shareout.git
   cd shareout/shareout-app
   npm ci
   npx wrangler login
   npm run deploy   # provisions D1/R2/KV + SESSION_SECRET + BASE_URL, migrates, deploys
   ```

   Or use **Deploy to Cloudflare** from the [public repo README](https://github.com/getshareout/shareout)
   with **Root directory** `shareout-app` and **Deploy command** `npm run deploy`
   (not bare `npx wrangler deploy`).

2. **Open the worker URL.** An empty database redirects to `/setup`. Create the
   first admin with an email and a password — no mail provider and no OAuth
   client needed. That registration endpoint closes as soon as the account exists.

   Google sign-in and email one-time codes are both optional additions afterwards.

3. **Publish a hello page** to prove the path:

   ```bash
   export SHAREOUT_ORIGIN=https://shareout.<your-account>.workers.dev
   export SHAREOUT_TOKEN=so_…   # Settings → API tokens after sign-in
   npm run smoke:hello
   ```

4. **Prove the data plane** (JSON store, tables, datasets):

   ```bash
   export SHAREOUT_ORIGIN=… SHAREOUT_TOKEN=…
   npm run smoke:data
   ```

   Full walkthrough: [Data plane smoke](/self-host/data-smoke/).

5. **Point agents at this instance** — save credentials with origin:

   ```json
   { "token": "so_…", "origin": "https://shareout.<your-account>.workers.dev" }
   ```

   Then load `GET $ORIGIN/v1/skill` or the monorepo skill with that origin.

   Your Worker ships its own copy of the skill and rewrites every URL in it to
   `SHAREOUT_BASE_URL` before serving. **`npm run deploy` sets `SHAREOUT_BASE_URL` for you** —
   if you skipped that, `GET $ORIGIN/health` returns a `warnings` entry until you set it.

6. **Day 1 extras** — set an AI key if you want Create with AI / Crew
   (`OPENAI_API_KEY` or Vercel AI Gateway); invite a teammate under Admin; confirm
   `curl …/v1/admin/instance` → `gaps` is empty (or you accept each gap). Details in the
   [repo README Day 1](https://github.com/getshareout/shareout#day-1-after-health-is-green).

</Steps>

## Optional next steps

| Goal | What to do |
|------|------------|
| Custom domain | [Domain and DNS](/self-host/domain/) — update `SHAREOUT_BASE_URL` |
| Google sign-in | `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET`; callback `{origin}/auth/callback` |
| Email one-time codes | Configure the `EMAIL` binding + from-address vars |
| Workspace subdomains | Wildcard DNS → worker; see [Domain and DNS](/self-host/domain/) |
| Split content CDN | Set `ARTIFACT_ORIGIN` to a second zone (optional hardening) |

Same-zone serving (no CDN) is the default and is fine for most self-hosts.

## What degrades without Cloudflare Paid / optional bindings

| Binding | If missing |
|---------|------------|
| Durable Objects | Core product incomplete — need Cloudflare Workers Paid |
| `EMAIL` | One-time codes and lifecycle mail → worker logs. Password sign-in is unaffected |
| `AI` / `VECTORIZE` | Semantic search → keyword fallback |
| `BROWSER` | No thumbnails / browser smoke |
| Queues | Analytics ingest may lag or sync-fallback |

Details: [Architecture](/self-host/architecture/) · [Ops](/self-host/ops/).
