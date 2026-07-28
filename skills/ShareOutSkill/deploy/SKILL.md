---
name: "shareout-deploy"
version: "1.2.0"
updated_at: "2026-07-27T20:30:00Z"
description: "Install and deploy a self-hosted ShareOut instance on the user's Cloudflare account. Use when the user wants to install ShareOut, self-host, Deploy to Cloudflare, set up their Artifact World, configure domain/DNS/secrets for ShareOut, or get a fresh instance running in minutes — including when they do not have a Cloudflare account yet."
---

# ShareOut Deploy Skill

**Goal:** ShareOut running on **their** Cloudflare account in minutes. You drive the
boring parts; they only handle Cloudflare signup / login, Workers Paid (payment), and
DNS if they want a custom domain.

This skill is for **install / deploy / configure**. After the instance is up, switch to
the product skill ([../SKILL.md](../SKILL.md)) and set `origin` to their worker URL.

**Where this file lives:** only in `getshareout/shareout` under `skills/ShareOutSkill/deploy/`.
That monorepo path is the source of truth ([../../README.md](../../README.md)). The
standalone `getshareout/shareout-skill` repo is a mirror for agents that only install
the skill — still edit deploy docs here, then mirror on release.

---

## Working in this repo (read before you touch Cloudflare)

You are in a **monorepo**. Wrong directory / wrong command is the #1 install failure.

| Path | What it is | Deploy / edit? |
|------|------------|----------------|
| `shareout-app/` | Worker, SDK, editor, `wrangler.toml`, migrations | **Yes** — product lives here |
| `skills/ShareOutSkill/` | Agent skill markdown (this tree) | Docs only; edit here, then `npm run build:skill` if shipping the zip |
| `docs-site/` | Human docs (Astro) | Not required to get a Worker live |
| `examples/` | Demos | **Never** treat as production code |
| repo root | Thin `package.json` that runs `npm --prefix shareout-app run deploy` | OK for Deploy button / one-liner |

**Hard rules for agents:**

1. **Always** `npm run deploy` (root or `shareout-app/`). **Never** bare `npx wrangler deploy` on a fresh clone — placeholder D1/KV ids (`0000…`) are not rewritten by Workers Builds.
2. `npm run deploy` runs `provision:cf` → migrations → deploy. `provision:cf` **rewrites `shareout-app/wrangler.toml` in place** with real D1/KV ids and usually `SHAREOUT_BASE_URL`. That is expected local state. Do **not** commit those ids back to a public PR unless the user owns a private fork and asked you to.
3. Node **≥ 24** (see `.nvmrc`). Workers **Paid** is required (Durable Objects).
4. Default resource names in `wrangler.toml` are `shareout` / `shareout-db` / `shareout-artifacts`. On an account that **already** has a ShareOut (or those names), rename **before** first `provision:cf` or you will attach to / collide with the existing R2/D1/worker. See [Second instance on the same account](#second-instance-on-the-same-account).
5. AI keys (`OPENAI_API_KEY` / Vercel AI Gateway) are **optional** for install + public publish. Without them, Crew/chat AI stay off (`/v1/admin/instance` gaps) — do not block smoke on that. Password admin + `smoke:hello` is enough to call install done.
6. First admin password must be **≥ 12 characters**. Prefer `/setup` or `POST /v1/auth/password/register` while the DB has zero users.
7. Do not invent founder zones, prod account ids, or routes into `wrangler.toml`. The OSS template is intentional.

Full Cloudflare checklist: [cloudflare.md](cloudflare.md).

---

## Agent success criteria (do not stop early)

You are done when **all** of these are true:

1. Worker is deployed and `{ORIGIN}/health` returns `200` with **`"schema": "ready"`
   and no `warnings`**. Anything else means the instance is not finished — read the
   warning and fix that first.
2. `SESSION_SECRET` is set; `SHAREOUT_BASE_URL` equals `{ORIGIN}` (no trailing slash).
3. First admin can sign in (password; Google and email codes optional).
4. `npm run smoke:hello` (or equivalent publish) returns a live artifact URL.
5. You saved credentials for later agent use:

```json
// ~/.shareout/credentials
{
  "token": "so_…",
  "origin": "https://shareout.<account>.workers.dev"
}
```

Hand the user: **ORIGIN**, how to open Home, how to mint tokens, and that their agents
should load skill from `{ORIGIN}/v1/skill` or this repo with that origin.

---

## Load Cloudflare companion skills first

ShareOut is a Cloudflare Workers app. The **only hard part** is Cloudflare account setup.
Load these agent skills when available (Claude Code / Cursor skill directories, or tell the
user to install them):

| Skill | When |
|-------|------|
| **wrangler** | Every deploy: login, secrets, D1/R2/KV create, `wrangler deploy` |
| **cloudflare** | Platform overview, Workers, D1, R2, KV, custom domains |
| **workers-best-practices** | Reviewing `wrangler.toml`, bindings, secrets, observability |
| **durable-objects** | DO migrations, Workers Paid, realtime/tables issues |
| **cloudflare-email-service** | Optional: emailed one-time codes and lifecycle mail |

**Install hints (if missing):**

```text
npx skills add cloudflare/skills   # community pack often includes wrangler + workers skills
# or clone / enable: cloudflare, wrangler, workers-best-practices, durable-objects
```

Those companion skills assume the user **already has** a Cloudflare account and focus on
CLI/config. For **no account yet**, use the bootstrap below — then switch to wrangler /
cloudflare skills for `login`, bindings, and deploy details. Prefer live Cloudflare docs
over model memory for pricing and dashboard clicks.

**Official docs (always authoritative over model memory):**

| Topic | URL |
|-------|-----|
| Create Cloudflare account | https://developers.cloudflare.com/fundamentals/account/create-account/ |
| Workers + Pages signup | https://dash.cloudflare.com/sign-up/workers-and-pages |
| Workers get started | https://developers.cloudflare.com/workers/get-started/guide/ |
| Wrangler | https://developers.cloudflare.com/workers/wrangler/ |
| Deploy to Cloudflare button | https://developers.cloudflare.com/workers/platform/deploy-button/ |
| Custom domains | https://developers.cloudflare.com/workers/configuration/routing/custom-domains/ |
| D1 | https://developers.cloudflare.com/d1/ |
| R2 | https://developers.cloudflare.com/r2/ |
| Durable Objects | https://developers.cloudflare.com/durable-objects/ |
| Workers Paid / pricing | https://developers.cloudflare.com/workers/platform/pricing/ |
| Email Workers | https://developers.cloudflare.com/email-routing/email-workers/ |

Full ShareOut-specific CF checklist: [cloudflare.md](cloudflare.md).

---

## Path 0 — No Cloudflare account yet (agent + human)

**You cannot create their Cloudflare account or enter a payment card for them.** You *can*
get them from zero → logged-in Wrangler + Workers Paid in a few guided minutes, then run
`npm run deploy` yourself.

### Detect first

```bash
node -v                    # need >= 24 for ShareOut
npx wrangler --version     # install via npm if missing (wrangler skill)
npx wrangler whoami        # success = already ready → skip to Path A
```

| `whoami` result | Meaning | Next |
|-----------------|---------|------|
| Shows account email / Account ID | Logged in | Confirm Workers Paid, then Path A |
| Not logged in / auth error | No CLI session | Signup (if needed) → `wrangler login` |
| Command missing | No wrangler | `npm i -D wrangler@latest` in the app, or use `npx wrangler` |

Also ask once: “Do you already have a Cloudflare account?” If no / unsure → step Z1.

### Z1. Create the account (human in browser)

Give them **one** link and wait:

1. Open **https://dash.cloudflare.com/sign-up/workers-and-pages**  
   (generic create-account docs: https://developers.cloudflare.com/fundamentals/account/create-account/)
2. Sign up with email or Google/GitHub — verify email if asked.
3. Land in the dashboard (Workers & Pages is enough; they do **not** need a domain yet).

Tell them: ShareOut runs on **workers.dev** first; custom domain is optional later.

### Z2. Enable Workers Paid (human — required)

Durable Objects (tables, realtime, chat) need **Workers Paid** (~$5/month minimum account
charge; see current numbers on the pricing page — do not invent fees).

1. Open https://developers.cloudflare.com/workers/platform/pricing/ for the live price.
2. In the dashboard: **Workers & Pages** → plan / billing → subscribe to **Workers Paid**  
   Deep link pattern: `https://dash.cloudflare.com/?to=/:account/workers-and-pages`
3. Confirm they finished payment / plan change before you deploy. Deploying DOs on Free
   fails with plan errors — do not keep retrying.

### Z3. Connect the agent (`wrangler login`)

On their machine (or the agent’s terminal if it can open a browser):

```bash
npx wrangler login
```

They approve OAuth in the browser (“Allow” Wrangler). Then:

```bash
npx wrangler whoami
```

Must print their account. If headless / no browser: create an API token in the dashboard
(Workers Scripts Edit + D1 + R2 + Account Settings Read is typical) and export
`CLOUDFLARE_API_TOKEN=…` for the shell that will run `npm run deploy`. Prefer OAuth when
possible.

Load the **wrangler** companion skill for token scopes / login troubleshooting.

### Z4. Continue install

Account + Paid + `whoami` green → [Path A](#path-a--cli-deploy-recommended) (or Path B if
they prefer the Deploy button — that path also creates/connects a CF account during OAuth,
but still needs Workers Paid and deploy command `npm run deploy`).

**Time budget to sell:** with a card ready, Z1–Z3 is usually a few minutes; `npm run deploy`
+ `/setup` + smoke is the rest of the “~5–10 min” story.

---

## Two install paths — pick one

| Path | Best when | Agent effort |
|------|-----------|--------------|
| **0. No CF account** | User has never used Cloudflare | Guide Z1–Z3, then A |
| **A. CLI (recommended)** | User said "you deploy it" / headless / fastest green | You run `npm run deploy` end-to-end |
| **B. Deploy button** | Human has browser + GitHub connected to Cloudflare | Guide human; **Deploy command must be `npm run deploy`** |

Always confirm: **Workers Paid** is required for Durable Objects (tables, realtime, chat).
Free Workers alone is not enough for full product.

**Why not bare `npx wrangler deploy`?** Workers Builds does **not** rewrite placeholder
D1/KV ids in `wrangler.toml`. `npm run deploy` runs `provision:cf` first (create
resources + patch ids + `SESSION_SECRET` + `SHAREOUT_BASE_URL`), then migrations, then
deploy. That is the five-minute path.

---

## Path A — CLI deploy (recommended)

### A0. Preconditions

```bash
node -v          # >= 24
npx wrangler --version   # v4.x
npx wrangler whoami      # must be logged in; else Path 0 → npx wrangler login
```

If `whoami` fails or they have no account → [Path 0](#path-0--no-cloudflare-account-yet-agent--human) first.
### A1. Clone, install, deploy

Either works:

```bash
git clone https://github.com/getshareout/shareout.git
cd shareout
npm run deploy
# root package.json → npm ci + deploy inside shareout-app/
```

```bash
cd shareout/shareout-app
npm ci
npm run deploy
# provision:cf → D1/R2/KV + SESSION_SECRET + SHAREOUT_BASE_URL → migrations → wrangler deploy
```

First deploy can take several minutes (bundle builds via `predeploy`). Do not kill it early.

Read the workers.dev URL from wrangler output → that is `ORIGIN`
(`https://{worker-name}.{account-subdomain}.workers.dev`).

### A2. Continue [Post-deploy](#post-deploy-always)

---

## Path B — Deploy to Cloudflare (human + agent)

Workers Builds will fail or ship a broken Worker unless settings match this:

1. Open the repo README Deploy button, or:

   ```
   https://deploy.workers.cloudflare.com/?url=https://github.com/getshareout/shareout/tree/main/shareout-app
   ```

   Prefer the **`…/tree/main/shareout-app`** URL. Repo-root Deploy often errors with
   *Could not detect a directory containing static files*.

2. In build settings (verify every line — defaults are wrong):
   - **Git branch:** the branch you intend (dashboard often defaults to `main`)
   - **Root directory:** `shareout-app` **or** `/` if using the monorepo root `npm run deploy`
   - **Deploy command:** `npm run deploy` — **not** `npx wrangler deploy`
3. Human completes Cloudflare OAuth and Workers Paid if needed.
4. Note the workers.dev URL → that is provisional `ORIGIN`.
5. Agent continues from [Post-deploy](#post-deploy-always).

If the build already ran with bare `wrangler deploy`, do not keep poking the dashboard —
clone locally, `npm run deploy` once from `shareout-app/`, then re-check `/health`.

---

## Second instance on the same account

Default names collide with an existing ShareOut on that Cloudflare account. **Before**
`provision:cf` / `npm run deploy`, edit `shareout-app/wrangler.toml`:

| Field | Default | Example for a second instance |
|-------|---------|-------------------------------|
| `name` | `shareout` | `shareout-acme` |
| D1 `database_name` | `shareout-db` | `shareout-acme-db` |
| R2 `bucket_name` | `shareout-artifacts` | `shareout-acme-artifacts` |
| KV titles | derived as `{name}-{binding}` | automatic once `name` changes |

Leave placeholder ids (`0000…`) so `provision:cf` creates **new** resources. Do not reuse
another instance’s D1/R2/KV unless the user explicitly wants that.

Credentials: if `~/.shareout/credentials` already points at another origin, write a
separate file (e.g. `/tmp/shareout-acme/credentials.json`) or overwrite only after the
user confirms.

---

## Post-deploy (always)

### 1. Confirm health

```bash
export ORIGIN="https://shareout.<account>.workers.dev"   # or custom domain
curl -sS "$ORIGIN/health"
```

Expected: `{"status":"ok", ... ,"schema":"ready"}` with **no `warnings` array**.

| In the response | Means | Fix |
|-----------------|-------|-----|
| `"schema":"missing"` | D1 exists but has no tables | `npx wrangler d1 migrations apply DB --remote` from `shareout-app/` |
| `SHAREOUT_BASE_URL is unset` | Agent-facing URLs point at the hosted instance | Set the var, redeploy |

The **Deploy to Cloudflare button** only finishes cleanly when the **Deploy command**
is `npm run deploy` (runs `provision:cf` + migrations). Bare `npx wrangler deploy`
leaves placeholder KV/D1 ids and an empty schema — if you see that, run
`npm run deploy` from `shareout-app/` once.

### 1b. Read the instance config

Once an admin exists, one call tells you everything still missing and what each gap
costs — check it before declaring the install finished:

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Authorization: Bearer $SHAREOUT_TOKEN" | jq .gaps
```

A **personal** token (`so_…`) belonging to an instance admin works here, so this step no
longer needs a browser session. Workspace agent tokens (`sot_…`) are refused on purpose.

Each entry is `{setting, disables, fix}`. **An empty array is the goal.** The common
ones on a fresh instance:

| Gap | Why it matters |
|-----|----------------|
| `VERCEL_AI_GATEWAY or OPENAI_API_KEY` | **AI is off until one is set** — Crew, home assistant, in-artifact chat, editor AI, knowledge. It degrades silently, so nothing will tell the user unless you do. |
| `CREDENTIALS_KEY` | Per-workspace AI keys and connector credentials cannot be stored |
| `EMAIL binding` | Invites and one-time codes reach the Worker log, not an inbox |
| `INSTANCE_ADMIN_EMAILS` | No stable owner — the earliest user keeps being treated as admin |

Do not silently accept gaps. Report them to the user with the `fix` line, and offer to
apply the ones that are secrets you can set for them.

Working through the gaps, changing feature flags, or standing up workspaces and admins
for other people: **[configure.md](configure.md)**.

### 2. Align `SHAREOUT_BASE_URL`

Must match the public origin users and agents will call (no trailing slash). Redeploy or
set via dashboard Variables if wrong.

### 3. First admin (`/setup`)

1. Open `$ORIGIN` → empty DB redirects to `/setup`.
2. Create the admin there with an **email and password**. No Email binding and no
   OAuth client needed — this is the whole point of the password path.
3. Headless? Same thing over the API, while the instance still has no users:

   ```bash
   curl -sS -X POST "$ORIGIN/v1/auth/password/register" \
     -H 'Content-Type: application/json' \
     -d '{"email":"you@example.com","password":"<at least 12 characters>"}'
   ```

   It returns `404` once any user exists, so it cannot be used twice.
4. Optional: set `SETUP_ADMIN_EMAIL` so only that email can claim first admin.

### 4. Mint API token

In-product: avatar / Settings → API token → copy `so_…` once.

Or after session exists, use self-serve API (see product skill [../auth.md](../auth.md)).

### 5. Smoke publish

```bash
export SHAREOUT_ORIGIN="$ORIGIN"
export SHAREOUT_TOKEN="so_…"
npm run smoke:hello
# expect 201 + live URL containing "Hello ShareOut"
```

### 6. Persist agent credentials

```bash
mkdir -p ~/.shareout
cat > ~/.shareout/credentials <<EOF
{
  "token": "$SHAREOUT_TOKEN",
  "origin": "$SHAREOUT_ORIGIN"
}
EOF
chmod 600 ~/.shareout/credentials
```

### 7. Point agents at this instance

- **Skill zip from live instance (preferred):** `GET $ORIGIN/v1/skill` (version check
  `$ORIGIN/v1/skill/version`). The Worker ships its own copy and rewrites every URL
  inside it to `SHAREOUT_BASE_URL` first, so the skill an agent reads already names
  this instance — nothing to substitute by hand.
- **Or** use this repo's `skills/ShareOutSkill/` with `origin` set to their Worker URL
  in credentials — every example is already `$ORIGIN` / `$ORIGIN_HOST`.

> **Verify before handing it over:** `curl -s $ORIGIN/health` must not contain a
> `warnings` entry. A `SHAREOUT_BASE_URL is unset` warning means the skill still
> points at the hosted instance, and anything an agent publishes lands there.

Product usage skill: [../SKILL.md](../SKILL.md) — section **Instance origin**.

---

## Optional polish (after hello works)

Do these only if the user asked — order of value:

| Want | Action | Details |
|------|--------|---------|
| Company domain | Custom domain on Worker + update `SHAREOUT_BASE_URL` | [cloudflare.md](cloudflare.md#custom-domain) |
| Workspace subdomains | Wildcard DNS `*.company.com` → Worker | [cloudflare.md](cloudflare.md#workspace-subdomains) |
| Google login | `GOOGLE_CLIENT_ID` / `SECRET`; callback `$ORIGIN/auth/callback` | [secrets](../../../docs-site/src/content/docs/self-host/secrets.md) |
| Emailed one-time codes | Email binding / Email Routing | skill **cloudflare-email-service** |
| Split artifact CDN | Second host + `ARTIFACT_ORIGIN` | optional hardening |
| Docs site | Deploy `docs-site/` separately; set `DOCS_HOST` + `DOCS_ORIGIN` | optional |

Full ops: [Self-host overview](../../../docs-site/src/content/docs/self-host/overview.md).

---

## Failure quick-fix

| Symptom | Likely cause | Fix |
|---------|--------------|-----|
| `wrangler whoami` fails / not logged in | No CF account or no CLI OAuth | [Path 0](#path-0--no-cloudflare-account-yet-agent--human): signup → `wrangler login` |
| Deploy fails on DO / class | Workers Free plan | Upgrade to **Workers Paid** (human billing) |
| `KV namespace '0000…' not found` / bad `database_id` | Bare `wrangler deploy` or Deploy button without `npm run deploy` | From `shareout-app/`: `npm run deploy` |
| *Could not detect a directory containing static files* | Deploy button aimed at monorepo **root** without root `npm run deploy` | Use `…/tree/main/shareout-app` URL, or root dir `/` + deploy command `npm run deploy` |
| Workers Builds used wrong branch / prod names | Dashboard defaulted to `main` | Set branch explicitly; or rename resources for a second instance |
| R2 / D1 create fails “already exists” | Second install, same default names | Rename worker/D1/R2 in `wrangler.toml`, then `provision:cf` |
| `/setup` or password register fails oddly | Password &lt; 12 chars, or users already exist | Longer password; register only works on empty DB |
| One-time code never arrives | No Email binding | Use password sign-in, or `wrangler tail` to read the code from logs |
| Links go to wrong host | `SHAREOUT_BASE_URL` stale | Set to public origin; redeploy |
| Publish 401 | Bad/missing token | Mint new token; fix credentials file |
| `npm ci` peer errors | Node &lt; 24 or stale lock | Use Node 24 (`.nvmrc`); clean install |
| Agent publishes to the wrong host | Origin not set | Always set `origin` in credentials / `SHAREOUT_ORIGIN` — never invent a default |
| AI features silent / Crew empty | No `OPENAI_API_KEY` / gateway | Optional — report gap; do not fail the install for it |

---

## What you must not do

- Do not invent founder account IDs, zones, or routes into `wrangler.toml`.
- Do not pretend you can create a Cloudflare account or enter billing for the user —
  guide Path 0 and wait for them.
- Do not commit `.dev.vars`, secrets, or `so_` tokens.
- Do not commit provisioned D1/KV ids from a personal account into the public OSS repo.
- Do not tell the user a ShareOut *product* feature needs a plan — there are none, and
  every feature is on. (**Workers Paid** is a Cloudflare platform requirement, not a
  ShareOut tier.)
- Do not skip smoke publish; "deploy succeeded" is not "product works".
- Do not leave `SHAREOUT_BASE_URL` pointing at `shareout.workers.dev` template placeholder.
- Do not attach a “test” deploy to an existing production Worker/D1/R2 without the user asking.
- Do not require AI keys before declaring install complete.

---

## After deploy — handoff message (template)

```text
Your ShareOut is live at: {ORIGIN}
Admin: open {ORIGIN} → signed in as first admin
API token: saved to ~/.shareout/credentials (origin + token)
Smoke: hello artifact published

Next for your coding agent:
  1. Load skills/ShareOutSkill/SKILL.md (or GET {ORIGIN}/v1/skill)
  2. Use origin {ORIGIN} for all API/SDK calls
  3. Publish with Authorization: Bearer so_…

Optional: custom domain — see skills/ShareOutSkill/deploy/cloudflare.md
```
