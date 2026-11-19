---
title: Workspace admin
description: Admin tools for members, billing, schedules, automations, metric alerts, features, and member tokens.
---

import { Aside } from '@astrojs/starlight/components';

Workspace `admin` and `owner` roles get visibility and control over team-wide
jobs, automations, metric alerts, feature flags, billing, and member tokens.

On Home, open the **Admin** lens in the left rail. It is the workspace control
panel — no separate admin app. A sidebar groups its pages by topic, and Admin opens
on **Members**:

| Group | Page | What you manage |
| --- | --- | --- |
| Reports | **Summary** | How the workspace was used, month by month. Only the owner and the admins they choose see this page — see [Summary](#summary) |
| People | **Members** | Seat bar, **Invite people**, remove, role changes, pending invites (resend, copy link, revoke), per-member activity |
| People | **Sharing** | External sharing — create client orgs via a guided add flow, invite their people, share folders at a capability, read receipts, mint scoped API tokens, **notes about each client** (private intel the assistant remembers) |
| People | **Support** | Support tickets from your workspace across every channel — list, thread, edit the AI-drafted reply, **Approve & send**, resolve |
| Content | **Artifacts** | Sortable governance table — name, owner, dates, views, visitors, visibility, status; filter by visibility; pause/unpause, change visibility, **reassign owner** |
| Content | **Automations** | Scheduled jobs, AI task automations and the data connectors they use, as sortable tables with run-now, enable/disable, and run history |
| AI & billing | **Billing** | What the workspace spends, the monthly AI budget, the AI report, invoices and billing details — see [Billing](#billing) |
| AI & billing | **AI & models** | The AI model the workspace uses, your own provider key (OpenAI / Vercel Gateway), spend, requests and tokens per model |
| Security | **Access** | **Access requests** (approve/deny), the membership domain allowlist (preserves explicit emails on save), session length |
| Security | **Publishing** | Publish approvals waiting for you, and the publishing policy |
| Security | **Agent tokens** | Workspace agent tokens (`sot_`) — create and revoke |
| Security | **Activity log** | The append-only **audit log** feed |
| Workspace | **General** | Language, whether members can create Team Space folders, the **file inbox** address (`{slug}@<inbox domain>`), read-only feature flags |
| Workspace | **Branding** | Workspace logo, accent color, hide the footer on shared pages |
| Workspace | **Custom domain** | Serve your pages from your own domain — see [Custom domain](/teams/custom-domain/) |

A badge on a sidebar entry counts what waits for you there: pending invites
(Members), access requests (Access), publish approvals (Publishing), failing
automations (Automations), unpaid invoices and a monthly AI budget that is near or
reached (Billing). Schedules, Alerts, and Crew AI also have their own Home lenses for
day-to-day work.

Deep-link a page with `#l/admin/<page>` (for example `#l/admin/billing`) or
`/home?view=admin&tab=<page>`. Page keys: `summary`, `members`, `clients` (Sharing),
`support`, `artifacts`, `automation`, `billing`, `ai`, `access`, `publishing`, `tokens`,
`audit`, `general`, `branding`, `domains`. Old tab names still resolve: `overview` and
`people` open Members, `usage` opens Billing, `security` opens Access, `settings` opens
General.

### Artifact governance API

```http
GET  /v1/workspaces/{id}/admin/artifacts
POST /v1/workspaces/{id}/admin/artifacts/{artifactId}/pause       ← { "paused": true }
POST /v1/workspaces/{id}/admin/artifacts/{artifactId}/visibility ← { "visibility": "workspace" }
POST /v1/workspaces/{id}/admin/artifacts/{artifactId}/transfer   ← { "new_owner_id": "usr_…" }
```

`GET` returns up to 200 workspace artifacts with owner, views, visitors, size,
and last-updated metadata. All `POST` routes require `admin` or `owner`.

### Support tickets

The **Support** page is the team workbench for customer tickets. A ticket can arrive
from any channel — the in-app Help button, the REST API, the Slack or Telegram bot,
or email — and lands as one thread. When it opens, an AI assistant **triages** it
(category + priority) and **drafts a reply**. Nothing is ever sent automatically: an
`admin` or `owner` reviews the draft, edits it, and hits **Approve & send**, which
delivers the reply on the channel the ticket came from and marks it pending. A
customer reply re-opens the ticket; **Resolve** closes it out (and emails the
customer when reachable). Resolved tickets auto-close after 7 idle days.

```http
GET  /v1/support/tickets?scope=workspace&workspace={id}    ← admins/owners; &status= optional
GET  /v1/support/tickets/{ticketId}                        ← ticket + full thread
POST /v1/support/tickets/{ticketId}/reply    ← { "body": "…" }  approve & send
POST /v1/support/tickets/{ticketId}/status   ← { "status": "resolved" }
POST /v1/support/tickets/{ticketId}/assign   ← { "assigneeUserId": "usr_…" }
```

End users see and follow **their own** tickets from the **Help** button on Home —
no admin access needed.

### Pending invites & access requests

```http
GET  /v1/workspaces/{id}/invites
DELETE /v1/workspaces/{id}/invites/{inviteId}
GET  /v1/access-requests/incoming
POST /v1/access-requests/{requestId}   ← { "action": "approve" | "deny" }
```

Pending invites are on the **Members** page; access requests are on **Access**.
Approving an access request grants the requester workspace membership per your
[membership policy](/teams/workspaces/#membership-policy).

### Run Inspector

Unified run history across crew triggers, scheduled jobs, and metric alerts.
Admins list and drill into any run with a step-by-step ledger (fetch, transform,
deliver phases):

```http
GET /v1/workspaces/{id}/runs?surface=job&status=failed&limit=50
GET /v1/workspaces/{id}/runs/{surface}/{runId}
```

`surface` is `crew`, `job`, or `alert`. The Home **Runs** widget and the Automations
page link into the same data. Job runs record per-query fetch steps; crew runs
use the existing `crew_run_events` ledger.

## Summary

**Admin → Summary** is a month-by-month report of how the workspace was used. Pick a
month to see:

- **Active people**, **Page views**, **Publishes** and **Questions to AI**, each compared
  with the month before
- **Reading** — views by signed-in people, day by day (an author opening their own page
  doesn't count), the total with anonymous views, and the most read pages
- **Pages & knowledge** — what the workspace holds at the end of the month, and what changed
- **AI & automations** — questions to the AI, members using it, AI spend, scheduled job
  and AI task runs, emails sent
- **By member** — what each member did that month
- **Readers outside the team** — people who aren't members and opened a page shared with them

**Who can see it.** The workspace owner always can. The owner picks which admins can too,
under **Who can see this** (up to 50); other admins don't see the page in their sidebar,
and members never do. The instance's own operators can open it too.

```http
GET /v1/workspaces/{id}/summary?month=YYYY-MM   ← the report (default: this month)
GET /v1/workspaces/{id}/summary/access          ← { can_view, can_manage }
GET /v1/workspaces/{id}/summary/viewers         ← owner: the admins, each with can_view
PUT /v1/workspaces/{id}/summary/viewers         ← owner: { "user_ids": ["usr_…"] } replaces the list
```

A malformed month is `400 INVALID_MONTH`; anyone without access gets `403`. Agent tokens
are refused.

## Billing

**Admin → Billing** is one page for owners and admins. Every amount on it is what the
workspace pays. From top to bottom:

1. **Spend** — this month (or **Last month**): what the workspace spent so far, the
   **Projected month-end** and the **Previous month**, then **By category** (Storage,
   Serving, Automations, AI, Email, Browser) and **By day**. **Download CSV** exports the
   month. AI is up to date; the other categories update nightly, so today's use shows up
   tomorrow.
2. **Monthly AI budget** — a ceiling on every AI call the workspace makes (questions,
   automations, Knowledge, summaries). Type an amount in **Monthly budget (USD)** and
   **Save**; **Remove budget** takes it away. At 80% it reads **Near the limit** and the
   Billing entry in the sidebar gets a badge. Once it is reached, new AI work is paused
   until the first day of next month (UTC). Search, embeddings, audio transcription and
   publish safety checks are never paused. Beside it, **AI by type** shows where this
   month's AI went, and **Today** shows the tokens each member and the workspace's
   automations used today on the agent inside artifacts, against their daily cap (reset
   at midnight UTC).
3. **AI report** — one month of AI, by use, by model (tokens in and out), by automation,
   by page, by person, every kind of AI call, and by day, with **Download CSV**. Its total
   is the same as the budget's and the invoice's.
4. **Invoices** — invoices issued to the workspace, each with its status (**Unpaid**,
   **Paid**, **Void**), due date, the invoice document to download and **How to pay**.
   To pay one:
   1. Pay by bank transfer with the details on the invoice.
   2. On the invoice, click **Attach transfer proof** and pick the receipt (PDF, PNG, JPG
      or WEBP, up to 10 MB) — or reply to the invoice email with the receipt attached.
   3. The invoice is marked **Paid**, and whoever issued it is told.

   If the upload is refused, check the file type and size. An emailed receipt only counts
   when the reply comes from the billing email or an owner or admin, with the receipt as an
   attachment.
5. **Billing details** — who invoices are made out to: country, legal name, tax ID (in
   Argentina the CUIT, IVA condition and fiscal address), city, province, postal code,
   phone and an optional billing email. Invoice emails go to the billing email, or to the
   owners and admins when there is none.

```http
GET /v1/workspaces/{id}/spend?month=YYYY-MM[&format=csv]       ← admin+
GET /v1/workspaces/{id}/ai-limits                               ← budget, spend by kind, today's caps
PUT /v1/workspaces/{id}/llm/budget        ← { "monthlyBudgetUsd": 100 } (above 0, up to 100000) or null
GET /v1/workspaces/{id}/ai-report?month=YYYY-MM[&format=csv]   ← admin+
GET /v1/workspaces/{id}/invoices                                ← admin+
PUT /v1/workspaces/{id}/invoices/{invoiceId}/proof              ← raw file body: marks it paid
GET /v1/workspaces/{id}/billing-profile                         ← admin+
PUT /v1/workspaces/{id}/billing-profile   ← the whole profile; 400 lists each refused field
```

A malformed `month` is `400 INVALID_MONTH`. Agent tokens are refused on every billing route.
A call refused because the budget is reached carries the code `workspace_budget`.

## Schedules

Manage all scheduled jobs across artifacts in the workspace:

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/schedules` | List all workspace schedules. |
| `GET` | `/v1/workspaces/{id}/schedules/{jobId}/logs` | Recent schedule logs. |
| `POST` | `/v1/workspaces/{id}/schedules/{jobId}/run` | Run immediately. |
| `PATCH` | `/v1/workspaces/{id}/schedules/{jobId}` | Enable or disable. |
| `DELETE` | `/v1/workspaces/{id}/schedules/{jobId}` | Delete schedule. |

Job payloads (email, webhook, materialize) are documented in the
[Jobs guide](/guides/jobs/).

## Automations

Manage crew trigger automations across artifacts:

| Method | Endpoint | Description |
| --- | --- | --- |
| `GET` | `/v1/workspaces/{id}/automations` | List all crew triggers. |
| `GET` | `/v1/workspaces/{id}/automations/{triggerId}/runs` | Run history. |
| `POST` | `/v1/workspaces/{id}/automations/{triggerId}/run` | Dispatch now. |
| `PATCH` | `/v1/workspaces/{id}/automations/{triggerId}` | Change the trigger (`enabled`, `cron`) or the task it runs (`name`, `instructions`, `model`, `maxIterations`, `runBudgetMicroUsd`). Send only the fields to change. |
| `DELETE` | `/v1/workspaces/{id}/automations/{triggerId}` | Delete trigger. |

## Metric alerts

Metric alert endpoints stay under `/v1/metric-alerts`. Teams changes who can
do what:

| Role | Capability |
| --- | --- |
| Artifact `owner`/`editor` or workspace `owner`/`admin` | Define metrics, create alerts to any destination, manage every alert on the artifact. |
| Workspace `member` or artifact `viewer` | Self-subscribe to personal destinations only. |

Full reference: [Metric alerts](/guides/metric-alerts/).

## Features

Read the enabled/disabled feature flags for the workspace. Any member can
view them (admins see them, read-only, under **Admin → General → Features**); only
ShareOut super-admins can change them.

Notable flags:

| Key | Default | Effect |
| --- | --- | --- |
| `ai.web_agent` | off | [Workspace assistant](/teams/workspace-assistant/) on the home page |
| `ai.version_summaries` | on | **Version change notes** — a one-line AI "what changed" note for versions published without a message, shown in History and Details. See [Version history](/everyone/version-history/#change-notes) |

```http
GET /v1/workspaces/{workspaceId}/features
Authorization: Bearer {token}
```

Response includes `readonly: true` to indicate that workspace members cannot
toggle flags.

## Member tokens

Admins and owners can create API tokens for service-account members and revoke
a member's personal tokens (and connected apps):

```http
POST   /v1/workspaces/{workspaceId}/members/{userId}/tokens
DELETE /v1/workspaces/{workspaceId}/members/{userId}/tokens
```

People create their own tokens; an admin cannot mint one for a person. Revoking
is refused for the workspace owner and for members with a higher role than yours.
Useful for onboarding automation or revoking access for departed members.

## Publishing policy

Control whether workspace members may take an artifact to public visibility
(`public`). Platform safety review still runs on top — this is an
internal governance layer.

```http
GET  /v1/workspaces/{id}/publish-policy
PATCH /v1/workspaces/{id}/publish-policy        ← { "policy": "require_approval", "approvals_required": 2 }
```

| Policy | Effect |
| --- | --- |
| `allow` | Default. Members publish to open visibility freely. |
| `prohibit` | Members cannot go open; artifacts stay `workspace`-visible. |
| `require_approval` | Held at `workspace` until N nominated members approve (1–10). |

`GET` requires workspace membership; `PATCH` requires `admin` or `owner`.

When policy is `require_approval`, members whose publish is held receive
`approval_required` in the publish response and must nominate approvers via
`POST /v1/artifacts/{id}/publish-approval`. Approvers act via
`POST …/publish-approval/{requestId}/decision`. List the queue with
`GET /v1/workspaces/{id}/publish-approvals?status=pending`.

Full flow: [Publishing artifacts](/guides/publishing/#workspace-publish-governance)
and [Public artifacts policy](/public-artifacts/overview/).

## Activity visibility

Workspace owners and admins control **who sees each activity kind** in the Home
Activity feed (Needs You + Pulse). Defaults are privacy-first — for example, views
and favorites are `self` only; access requests are `admins` only.

```http
GET /v1/home/event-visibility?workspace={workspaceId}
PUT /v1/home/event-visibility?workspace={workspaceId}
Authorization: Bearer {token}
Content-Type: application/json

{ "kind": "view", "audience": "members" }
```

| Audience | Who sees the kind |
| --- | --- |
| `self` | Only the actor (and artifact owners for their pages) |
| `members` | All workspace members |
| `admins` | Workspace owners and admins only |
| `off` | Suppressed in this workspace |

`GET` returns every kind with its label, tier (`actionable` → Needs You row,
`ambient` → Pulse count), default, and effective audience. `PUT` requires
`admin` or `owner`. Failed job/crew runs surface in **Needs You** even when
the `run` kind is ambient in Pulse.

See [Your workspace (Home)](/everyone/your-workspace/#home--needs-you-for-you-recent).

## Session length policy

Set how long a member's sign-in session stays valid in this workspace. Useful
for security/compliance requirements that mandate shorter sessions.

```http
GET /v1/workspaces/{id}/session-policy
PUT /v1/workspaces/{id}/session-policy        ← { "session_max_days": 7 }
```

| Field | Meaning |
| --- | --- |
| `session_max_days` | `1`–`30`, or `null` to inherit the 30-day platform default. |
| `platform_default_days` | Always `30`. |
| `eligible` | Whether the workspace's plan allows setting a policy. |

Rules:

- `GET` requires workspace membership; `PUT` requires `admin` or `owner`.
- Teams plan required — a Personal workspace gets `402 TIER_REQUIRED`.
- A session is per-user and spans every subdomain, so the lifetime applied at
  login is the **strictest** policy across all the workspaces a user belongs
  to (and never longer than 30 days). You can tighten, never extend.

## Audit log

Every governance action in the workspace is recorded to an append-only audit
trail. Admins and owners can read it:

```http
GET /v1/workspaces/{id}/audit?limit=100
Authorization: Bearer {token}
```

```json
{
  "entries": [
    {
      "ts": "2026-06-18T15:04:00Z",
      "actor_email": "admin@acme.co",
      "action": "member.remove",
      "target_type": "user",
      "target_id": "usr_123",
      "detail": { "removed_role": "member" }
    }
  ]
}
```

Recorded actions include member add/remove, bulk invite, ownership transfer,
subdomain enable/disable, membership-policy changes, connection create/delete,
and session-policy changes. Entries are retained for one year.

## Context files (Guidance in Knowledge)

Workspace context files (agent house style) now live in the **Knowledge** lens under the
**Guidance** branch — not a separate Admin page. Admins create, edit (≤ 64 KB, lowercase
`.md`), set the entry point, or delete files there. Members can read.

REST routes for context files are documented in
[Workspaces](/teams/workspaces/#workspace-context-files) and
[Workspace Knowledge](/teams/knowledge/#guidance-house-rules).

<Aside type="tip">
The Admin lens in Home surfaces most of the above as pages in its sidebar. The REST
routes let you script the same operations.
</Aside>
