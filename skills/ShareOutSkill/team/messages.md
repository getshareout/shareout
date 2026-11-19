# Direct Messages

People in the same workspace write to each other inside ShareOut: **one-to-one direct messages** between internal members. There are no channels and no groups. A message can point at a page.

Every way in uses the same rules:

| Where | How |
| --- | --- |
| Home | **Messages** menu (conversations + composer, "New message" picks a person) and the bell (unread conversations) |
| ShareOut assistant (Home chat, Telegram) | `send_message` (shows a confirm card; sent only after the person taps confirm) and `read_messages` |
| MCP (Claude, ChatGPT…) | `send_message` (two steps: a stored draft, then a single-use `confirm_token` valid 10 minutes) and `read_messages` — see [../integrations/mcp-connector.md](../integrations/mcp-connector.md) |
| REST API | `/v1/workspaces/{workspaceId}/messages…` (below) |

## Rules

- Both people are **internal, active members** of the workspace. External members (client portal guests), service accounts (workspace agent tokens) and disabled users can neither send nor receive. Nobody can message themselves.
- Conversations belong to one workspace; the same two people in two workspaces have two separate conversations.
- `artifact_id` is accepted only for a page in that workspace that the **sender** can open.
- At most 4000 characters per message; 120 messages per sender per hour across every surface (429 `RATE_LIMITED`).
- A message written anywhere but Home's composer carries `sentVia` (`api`, `mcp`, `assistant`) and shows as **written through their assistant**.
- The recipient sees it on Home and gets a ping on their linked Telegram with a link that opens the conversation (`/home#l/messages/{senderUserId}` on the workspace's host).
- Replying marks what came before as read.

## REST endpoints

Session or personal token (`so_…`). Workspace agent tokens (`sot_…`) are refused: a message is from a person.

```http
GET  /v1/workspaces/{workspaceId}/messages                  # your conversations (?unread=1, ?limit) + unread total
POST /v1/workspaces/{workspaceId}/messages                  # send {to, text, artifact_id?}
GET  /v1/workspaces/{workspaceId}/messages/unread           # { unread }
GET  /v1/workspaces/{workspaceId}/messages/people           # who you can write to
GET  /v1/workspaces/{workspaceId}/messages/with/{userId}    # one conversation, newest first (?before=<ISO>, ?limit)
POST /v1/workspaces/{workspaceId}/messages/with/{userId}/read
```

### Send

```bash
curl -X POST "$SHAREOUT/v1/workspaces/$WS/messages" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"to": "Martín", "text": "The October numbers are in", "artifact_id": "art_…"}'
```

`to` takes a user id, an email, or a name (accents and case ignored; first-name or "first last" prefixes work). Answers:

| Status | Code | Meaning |
| --- | --- | --- |
| 201 | — | `{ message, thread_id, recipient }` |
| 409 | `RECIPIENT_AMBIGUOUS` | Several people match; `candidates` lists them — ask which one |
| 404 | `RECIPIENT_NOT_FOUND` | Nobody in this workspace matches (or they are external / a service account) |
| 400 | `RECIPIENT_IS_SELF`, `MESSAGE_EMPTY`, `MESSAGE_TOO_LONG` | |
| 404 | `ARTIFACT_NOT_FOUND` | The page is not in this workspace or the sender cannot open it |
| 403 | `FORBIDDEN` | The caller is not an internal member of the workspace |
| 429 | `RATE_LIMITED` | Over 120 messages in the last hour |

### Shapes

```jsonc
// MessageView
{ "id": "dm_…", "body": "…", "sentByMe": true, "senderId": "usr_…",
  "sentVia": "web" /* api | mcp | assistant */, "artifact": { "id": "art_…", "name": "…", "slug": "…" } | null,
  "createdAt": "2026-11-19T22:05:18.374Z" }
// ThreadSummary (GET /messages)
{ "id": "dmt_…", "with": { "id": "usr_…", "name": "…", "email": "…", "picture": null },
  "last": { "body": "…", "sentByMe": false, "sentVia": "web", "at": "…" }, "unread": 2, "lastMessageAt": "…" }
```

Reading a conversation does not mark it read; `POST …/with/{userId}/read` does (Home does it when the conversation opens; `read_messages` does it for the assistant and MCP).
