---
title: Public artifacts — policy & flows
description: Who can publish public artifacts, your responsibilities, how ShareOut reviews and authorizes them, Teams & Enterprise considerations, monitoring, and abuse handling.
---

import { Aside } from '@astrojs/starlight/components';

A **public artifact** is a page anyone on the web can open — no sign-in, no invite.
This page is the full policy and how the flows work: who may publish publicly, what
you're responsible for, what ShareOut checks before and after a page goes live, how
this differs for Teams & Enterprise, and how monitoring and abuse handling work.

For the developer-facing API details (visibility field, `moderation_status`,
anonymous opt-ins, quotas) see [Publishing artifacts](/guides/publishing/). For the
basics of sharing see [Share it](/everyone/share-it/).

## Visibility levels

Every artifact has one visibility. You choose it; you can change it later.

| Visibility | Who can open it |
| --- | --- |
| `private` | You, and people you explicitly share with (email/Google/password). |
| `workspace` | Any member of the artifact's workspace. |
| `public` | Anyone with the link; discoverable and search-indexable. |

`public` is the only **open** visibility. Everything on this page applies to it.
`private` and `workspace` are **closed** and never reachable by the anonymous
internet.

<Aside type="caution">
Open means open. A public artifact's page **and its readable data** are
available to anyone. Never put secrets, credentials, or personal data you wouldn't
hand to a stranger into a public artifact.
</Aside>

## Who can publish publicly

Publishing an open artifact requires more than a closed one, by design — it's what
keeps free, anonymous hosting from becoming an abuse magnet.

- **A verified email.** Accounts with no verified email (anonymous, token-only
  accounts) can publish **privately** but not publicly. Sign in with Google or a
  one-time email code first. (Anonymous accounts publishing public would be the
  cheapest way to mass-produce abuse, so it's blocked.)
- **A signup that passed a bot check.** New accounts pass a Cloudflare Turnstile
  challenge, so signups can't be scripted at scale.
- **A paid plan (or paid workspace).** Public visibility is a
  paid feature. Free personal accounts can publish `private` and `workspace` only.
  You get open visibility when **any** of these is true: your account is on **Pro**
  or higher, the artifact lives in a **Teams/Enterprise** workspace with an active
  subscription, or the workspace is a public showcase. Trying to go open without
  entitlement keeps the artifact at its current closed visibility and shows an
  upgrade notice — ShareOut no longer silently downgrades.

## What you're responsible for (owner)

When you make an artifact public, you are the publisher of that content. You agree:

- The page and its readable data are world-visible. You put nothing there you can't
  expose publicly.
- You own the rights to what you publish, and it doesn't break the law or the
  acceptable-use terms (no phishing, malware, fraud, illegal content, or content
  that targets or harms others).
- ShareOut may review, withhold, block, or take down public content that violates
  these terms, and may suspend repeat offenders.

## How ShareOut authorizes and checks a public artifact

Public artifacts pass through layered checks — before they go live, while they're
served, and on an ongoing basis. No single check is the whole defense.

### 1. At publish — automated safety review
The first time you publish or switch an artifact to open visibility, ShareOut runs
an automated safety review on the page:

- an **AI content classifier** judges it for phishing, malware, scams, and illegal
  content, and
- a **URL-reputation check** (Cloudflare URL Scanner) looks at the outbound links and
  embedded resources.

The outcome sets the artifact's moderation state:

| State | What happens |
| --- | --- |
| **Approved** | Goes live publicly immediately. |
| **Pending** | Held **private** until cleared — anything the classifier can't confidently approve, or any check error, lands here rather than going live. ShareOut **re-checks hourly** and auto-restores public visibility when the hold clears; owners see Home badges and get email when resolved. Visitors opening the URL see an under-review page. |
| **Blocked** | Not served; the page returns an "unavailable" notice and is not indexed. |

Re-publishing unchanged content is not re-reviewed; changing the page triggers a
fresh review.

### 2. At serve time — read-only by default
A public page can be opened by anyone, but **anonymous visitors are read-only by
default.** They cannot write data, send email, use the in-artifact AI chat, or join
realtime collaboration unless you explicitly opt in, per capability:

| Opt-in | Lets anonymous visitors… |
| --- | --- |
| `allow_anon_write` | Write to json / tables / blobs / datasets |
| `allow_anon_email` | Send contact-form email |
| `allow_anon_agent` | Use the in-artifact AI chat |
| `allow_anon_collab` | Join realtime collaboration |

All default off. Your signed-in collaborators keep their normal roles regardless.
See [Publishing artifacts](/guides/publishing/) for how to set these.

### 3. Limits that contain abuse and cost
- **Bot check** on signup (Turnstile).
- **Per-account caps** on number of public artifacts, stored bytes, and (estimated)
  daily bandwidth. Free accounts have lower caps; exceeding storage blocks the
  publish, exceeding bandwidth can pause serving.
- **Rate limits** on publishing, anonymous writes, contact-form email, and AI chat
  — including a per-visitor and a per-owner ceiling so one page can't drain an
  account's AI budget.

### 4. Ongoing — after a page is live
- A **daily re-scan** re-checks live public pages against URL reputation; a page
  whose outbound host later turns malicious is auto-blocked.
- **Content-domain monitoring** watches the shared content domain's reputation, so a
  problem is caught before it can affect other pages.

## Reporting and takedown

Every free public page carries a **Report** link (in the "Made with ShareOut"
badge). Anyone can flag a page.

- A report categorized as child-sexual-abuse material **immediately pauses and blocks**
  the page and alerts ShareOut — no waiting for review.
- Enough independent reports auto-block a page pending review.
- ShareOut can take down a page (block + pause) and suspend an account at any time.

If your page was held or taken down and you believe it's a mistake, you can request
a re-review.

## Teams & Enterprise

The safety review above applies to **every** public artifact, on every plan — it's a
platform protection, not a per-workspace setting. Teams and Enterprise add:

- **No "Made with ShareOut" badge** on public pages (free pages always show it).
- **Higher caps** for public artifacts, storage, and bandwidth.
- **Custom subdomain** (`yourteam.shareout.site`) for your workspace.
- **Workspace roles.** Owners and admins manage team-wide schedules, automations,
  metric alerts, feature flags, and member tokens — see [Workspace admin](/teams/admin/).
- **Per-workspace publish governance.** Workspace owners/admins can require internal
  approval before members take an artifact to `public` visibility.

### Workspace publish policy

Each workspace has a `public_publish_policy` (default `allow`):

| Policy | Behaviour |
| --- | --- |
| `allow` | Members publish to open visibility freely (subject to platform safety review). |
| `prohibit` | Members cannot go open — the artifact stays at `workspace` visibility with a notice. |
| `require_approval` | Held at `workspace` visibility until **N** nominated workspace members approve; then it flips to the requested visibility and the platform safety review still runs. |

Owners and admins set the policy in the app under **Workspace admin →
Publishing** (or via the REST API). When a member tries to take an artifact open
and the workspace requires approval, the app opens an approver picker: the member
nominates exactly **N** teammates, and the page stays workspace-visible until they
all approve. Nominated approvers (and the requester) see pending requests under
**Approvals** in the workspace sidebar, where they approve or reject; the sidebar
shows a badge when a request needs the current user. See
[Publishing artifacts → Workspace publish governance](/guides/publishing/#workspace-publish-governance).

Approval is tied to the page's content hash — re-publishing unchanged content
after approval does not require a new round. ShareOut's central safety review and
abuse queues still apply on top of any workspace policy.

## Monitoring & stats

- **Account Analytics** — in Home, open **Analytics** from the sidebar for a
  roll-up across your artifacts: views, unique visitors, active artifacts, load time
  (p75 LCP once 20+ samples exist), a trend chart, top artifacts (click through
  for per-artifact detail), top countries, and referrers. Filter by 7 / 30 / 90
  days via `GET /v1/home/analytics?range=`.
- **Live viewers** — per-artifact analytics drill-down shows **N viewers now**
  (owners/collaborators only; polls every ~15s). This is separate from comment-panel
  "others here" presence.
- **Per-artifact stats** — each public artifact also has views, unique visitors,
  and real-user performance once enough visits accrue. Owners and collaborators see a
  **per-viewer breakdown** — name, email, and last seen for every invited or
  authenticated viewer (collaborators, workspace members, external sharees). Anonymous
  public views stay count-only. Shown in Home Studio **Details**, the share overlay
  **Stats** panel, and the per-artifact `/admin` page.
- **Platform-side**, ShareOut monitors the moderation queue, abuse reports, content-
  domain reputation, and per-account usage to keep public hosting safe; these
  operational views are managed by ShareOut, not exposed per workspace.

## Availability & how it can be paused

Public publishing is enabled in waves rather than all at once, and ShareOut keeps a
kill switch: if abuse spikes, new public publishing can be paused instantly (existing
private/closed artifacts are unaffected). This is normal for a hosting platform and
lets us open access safely.

## Related

- [Publishing artifacts](/guides/publishing/) — the API: visibility, `moderation_status`, anonymous opt-ins, quotas.
- [Share it](/everyone/share-it/) — the simple version of sharing and visibility.
- [Who sees what](/everyone/who-sees-what/) — per-viewer row-level data visibility.
- [Workspace admin](/teams/admin/) — Teams/Enterprise admin controls.
