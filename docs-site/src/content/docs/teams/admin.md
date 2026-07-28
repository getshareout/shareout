---
title: Workspace admin
description: Admin tools for schedules, automations, metric alerts, features, and member tokens.
---

import { Aside } from '@astrojs/starlight/components';

Workspace `admin` and `owner` roles get visibility and control over team-wide
jobs, automations, metric alerts, feature flags, and member tokens.

On Home, open the **Admin** lens in the left rail. It is a ten-tab workspace
control panel — no separate admin app:

| Tab | What you manage |
| --- | --- |
| **Overview** | Plan badge, seat bar, storage/views/visitors tiles, actionable alerts (pending invites, failing runs, paused pages) with deep links into other tabs |
| **Artifacts** | Sortable governance table — name, owner, dates, views, visitors, visibility, status; filter by visibility; pause/unpause, change visibility, **reassign owner** |
| **Members** | Seat utilisation bar, invite/remove, role changes, pending invites, **access-request queue** (approve/deny), per-member activity metrics |
| **Sharing** | External sharing — create client orgs via a guided add flow, invite their people, share folders at a capability, read receipts, mint scoped API tokens, **notes about each client** (private intel the assistant remembers) |
| **Automation** | Schedules and crew triggers as sortable tables with run-now, enable/disable, and run history |
| **AI** | Spend/balance/requests/tokens, per-model usage, BYO LLM key management (OpenAI / Vercel Gateway) |
| **Security** | Membership domain allowlist editor (preserves explicit emails on save), append-only **audit log** feed |
| **Support** | Support tickets from your workspace across every channel — list, thread, edit the AI-drafted reply, **Approve & send**, resolve |
| **Settings** | Publishing policy, workspace logo (branding), **file inbox** address (`{slug}@inbox.shareout.site`), read-only feature flags |

Quick links from Overview jump into the tab that needs attention. Schedules,
Alerts, and Crew AI also have their own Home lenses for day-to-day work.

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

The **Support** tab is the team workbench for customer tickets. A ticket can arrive
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

The Members tab surfaces both queues. Approving an access request grants the
requester workspace membership per your [membership policy](/teams/workspaces/#membership-policy).

### Run Inspector

Unified run history across crew triggers, scheduled jobs, and metric alerts.
Admins list and drill into any run with a step-by-step ledger (fetch, transform,
deliver phases):

```http
GET /v1/workspaces/{id}/runs?surface=job&status=failed&limit=50
GET /v1/workspaces/{id}/runs/{surface}/{runId}
```

`surface` is `crew`, `job`, or `alert`. The Home **Runs** widget and Automation
tab link into the same data. Job runs record per-query fetch steps; crew runs
use the existing `crew_run_events` ledger.

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
| `PATCH` | `/v1/workspaces/{id}/automations/{triggerId}` | Enable or disable. |
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
view them; only ShareOut super-admins can change them.

Notable flags:

| Key | Default | Effect |
| --- | --- | --- |
| `ai.web_agent` | off | [Workspace assistant](/teams/workspace-assistant/) on the home page |

```http
GET /v1/workspaces/{workspaceId}/features
Authorization: Bearer {token}
```

Response includes `readonly: true` to indicate that workspace members cannot
toggle flags.

## Member tokens

Admins and owners can create or revoke API tokens for workspace members:

```http
POST   /v1/workspaces/{workspaceId}/members/{userId}/tokens
DELETE /v1/workspaces/{workspaceId}/members/{userId}/tokens
```

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

See [Your workspace (Home)](/everyone/your-workspace/#brief--needs-you-and-pulse).

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
**Guidance** branch — not a separate Admin tab. Admins create, edit (≤ 64 KB, lowercase
`.md`), set the entry point, or delete files there. Members can read.

REST routes for context files are documented in
[Workspaces](/teams/workspaces/#workspace-context-files) and
[Workspace Knowledge](/teams/knowledge/#guidance-house-rules).

<Aside type="tip">
The Admin lens in Home surfaces most of the above as native tabs. The REST routes
let you script the same operations.
</Aside>
