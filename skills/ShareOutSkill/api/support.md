# Support Tickets API

Raise and track customer-support tickets (bugs, questions, billing, requests) from an
agent or app. Tickets flow into a shared workbench where staff review an AI-drafted reply
and respond on the channel the ticket came from. AI **triages and drafts only** — replies
are never sent automatically.

Base URL: `$ORIGIN`. All endpoints require auth (see [overview](overview.md)),
except the platform-internal email-gateway ingest (see below).

## How customers open tickets

| Channel | How |
| --- | --- |
| **In-app Help** | Floating **Help & support** button (bottom-left) on the workspace shell — file a ticket and see your own open tickets |
| **This API** | `POST /v1/support/tickets` with a Bearer token — tagged `channel: "skill"` |
| **Telegram** | `/support <what went wrong>` or `/bug <what went wrong>` on the linked account bot |
| **Slack** | `/shareout support <what went wrong>` in a linked DM |
| **Email** | Mail `support@<inbox-domain>` (same domain as artifact inboxes, e.g. `support@inbox.example.com`) — threads onto the sender's most recent open ticket or opens a new one |

On creation every channel queues AI triage (category, priority, draft reply for staff) and
alerts super-admins. Resolved tickets auto-close after 7 idle days; resolving sends a
satisfaction follow-up email.

## Create a ticket

```
POST /v1/support/tickets
```

```json
{
  "subject": "Publish button does nothing",
  "body": "Clicking Publish on my dashboard shows a spinner forever.",
  "workspaceId": "wsp_abc"
}
```

`workspaceId` is optional — omit (or `null`) for a personal-scope ticket. Returns `201`:

```json
{ "success": true, "ticket": { "id": "tkt_…", "status": "open", "channel": "skill", "subject": "…" } }
```

On creation the ticket is queued for AI triage (category + priority + a draft reply, stored
on the ticket for staff) and a super-admin alert is sent. Neither blocks the response.

## List tickets

```
GET /v1/support/tickets?scope=mine            # your own tickets (default)
GET /v1/support/tickets?scope=workspace&workspace=wsp_abc   # workspace admins/owners
GET /v1/support/tickets?scope=all             # super-admins only
```

Optional `&status=open|pending|resolved|closed`. Returns `{ "success": true, "tickets": [...] }`.

## Get a ticket + thread

```
GET /v1/support/tickets/{id}
```

```json
{ "success": true, "ticket": { … }, "thread": [ { "author": "customer", "body": "…", "created_at": 0 } ] }
```

Visible to the requester, the workspace's owners/admins, and super-admins.

## Add a message (requester)

```
POST /v1/support/tickets/{id}/message
{ "body": "Still happening on Firefox." }
```

A requester message reopens the ticket (`status: open`).

## Staff actions

Workspace owners/admins (for their workspace's tickets) and super-admins:

```
POST /v1/support/tickets/{id}/reply    { "body": "…" }   # send on the origin channel → pending
POST /v1/support/tickets/{id}/status   { "status": "resolved" }
POST /v1/support/tickets/{id}/assign   { "assigneeUserId": "usr_…" }   # null to unassign
POST /v1/support/tickets/{id}/triage                                   # re-run AI triage
```

`reply` records the message in the thread and delivers it on the ticket's origin channel
(in-app, email, Slack, or Telegram).

## Platform email-gateway ingest (internal)

Trusted mail gateways (e.g. AgentsEmail) can mirror inbound support mail without a user
session:

```
POST /v1/support/ingest/email
X-Support-Ingest-Key: {SUPPORT_INGEST_KEY}
{ "from": "user@example.com", "subject": "…", "body": "…" }
```

Returns `{ "success": true, "ticketId": "tkt_…", "threaded": true|false }`. Not for
agent or customer use — document only so integrators know the threading rules match
`support@<inbox-domain>`.

## Related

- [../agents/telegram.md](../agents/telegram.md) — `/support` and `/bug`
- [../agents/slack.md](../agents/slack.md) — `/shareout support`
- [../team/admin-portal.md](../team/admin-portal.md) — Admin → **Support** tab (staff workbench)
