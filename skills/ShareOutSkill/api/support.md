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
| **In-app Help** | Floating **Help & support** button (bottom-left) on the workspace shell — file a ticket, open your tickets, read replies and answer them |
| **In-app assistant** | The Home chat agent calls its `report_problem` tool when you are stuck — tagged `client: "chat_agent"` |
| **This API** | `POST /v1/support/tickets` with a Bearer token — tagged `channel: "skill"` |
| **Telegram** | `/support <what went wrong>` or `/bug <what went wrong>` on the linked account bot |
| **Slack** | `/shareout support <what went wrong>` in a linked DM |
| **Email** | Mail `support@<inbox-domain>` (same domain as artifact inboxes, e.g. `support@inbox.example.com`) — threads onto the sender's most recent open ticket or opens a new one |

On creation every channel queues AI triage (priority and a draft reply for staff; it fills
`category` only when the reporter left it empty). Every ticket lands in the instance
admins' queue at `/admin?view=support` — there is no push alert; admins and their agents
read the queue. Resolved tickets auto-close after 7 idle days; resolving sends a
satisfaction follow-up email.

## Create a ticket

```
POST /v1/support/tickets
```

```json
{
  "subject": "Publish button does nothing",
  "body": "Clicking Publish on my dashboard shows a spinner forever. Tried twice, same result.",
  "workspaceId": "wsp_abc",
  "category": "bug",
  "severity": "high",
  "client": "claude",
  "requestId": "req_…",
  "artifactId": "art_…",
  "pageUrl": "https://…/a/my-dashboard/",
  "idempotencyKey": "<any string you reuse on retry>",
  "locale": "en"
}
```

Only `subject` and `body` are required.

| Field | Values |
| --- | --- |
| `workspaceId` | A workspace you are a member of (else `403`). Omit for a personal ticket. |
| `category` | `bug` · `question` · `access` · `billing` · `other` |
| `severity` | `low` · `normal` · `high` · `blocker` (you cannot work at all) |
| `client` | `ui` · `claude` · `chatgpt` · `mcp` · `api` · `slack` · `telegram` · `email` · `chat_agent` — defaults to `api` for token callers |
| `requestId` | The `request_id` from the error response that brought you here |
| `artifactId`, `pageUrl` | The page involved |
| `userAgent` | Defaults to the request's `User-Agent` |
| `idempotencyKey` | Retry-safe: the same key from the same account returns the original ticket (`200`, `"deduped": true`) instead of opening a second one |
| `locale` | `en` · `es` — the language reply emails are written in |

Returns `201`:

```json
{
  "success": true,
  "deduped": false,
  "ticket": { "id": "tkt_…", "status": "open", "channel": "skill", "subject": "…" },
  "message": "Your report is in the support queue as tkt_…. The team replies on the ticket thread (Help & support in the app) and by email — nothing else to do now.",
  "check_replies": { "method": "GET", "path": "/v1/support/tickets/tkt_…", "hint": "…" }
}
```

To see whether anyone answered, `GET` the `check_replies.path`: staff messages appear in
`thread` with `author: "staff"`, and `status` turns `pending`. AI triage runs after the
response and never blocks it.

## List tickets

```
GET /v1/support/tickets?scope=mine            # your own tickets (default)
GET /v1/support/tickets?scope=workspace&workspace=wsp_abc   # workspace admins/owners
GET /v1/support/tickets?scope=all             # instance admins only
```

Optional `&status=open|pending|resolved|closed`. `scope=all` also takes `workspace=<id>`
(or `none` for tickets with no workspace), `category=…`, `since=<ISO timestamp>` (activity
after it) and `limit` (default 200, max 500). Returns `{ "success": true, "tickets": [...] }`.

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
(email, Slack or Telegram). In-app (`ui`) and API (`skill`) requesters get the reply by
email, written in the ticket's `locale`. Every requester with an account also gets a bell
notification. The response says what happened:
`{ "delivery": { "delivered": true, "via": "ui" } }`.

## Triage as super-admin (agents)

Instance admins (`INSTANCE_ADMIN_EMAILS`, `SETUP_ADMIN_EMAIL`) work the whole queue —
including tickets with no workspace (Telegram, Slack, email, personal, API) — from
`/admin?view=support` or over REST. An agent doing it holds a **personal** API token
(`so_…`) created by an instance admin; workspace agent tokens (`sot_…`) are refused here.

```bash
# What came in or changed since the last pass
curl -sS "$ORIGIN/v1/support/tickets?scope=all&status=open&since=2026-10-09T00:00:00Z" \
  -H "Authorization: Bearer $SHAREOUT_ADMIN_TOKEN"

# Read one: context fields (category, severity, client, request_id, page_url,
# artifact_id, user_agent) plus the AI draft (ai_draft) and the full thread
curl -sS "$ORIGIN/v1/support/tickets/tkt_…" -H "Authorization: Bearer $SHAREOUT_ADMIN_TOKEN"

# Answer — delivered on the ticket's channel, by email for in-app/API tickets, and to the bell
curl -sS -X POST "$ORIGIN/v1/support/tickets/tkt_…/reply" \
  -H "Authorization: Bearer $SHAREOUT_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"body":"Fixed — publishing works again. Try once more and tell us if it still spins."}'

# Close the loop
curl -sS -X POST "$ORIGIN/v1/support/tickets/tkt_…/status" \
  -H "Authorization: Bearer $SHAREOUT_ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"status":"resolved"}'
```

Keep the newest `last_msg_at` you saw and pass it as `since` on the next pass. A reply
moves the ticket to `pending`; the requester answering moves it back to `open`.

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
- `/admin?view=support` — the instance-wide queue for instance admins
