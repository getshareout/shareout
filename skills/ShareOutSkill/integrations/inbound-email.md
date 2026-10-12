# Inbound Email Inbox

Give an artifact its own email address. Mail sent (or forwarded) to it is parsed,
stored, and fires an `email.received` trigger — so inbound mail becomes an action.

**Use case:** forward an invoice ("expensas") to `expensas@inbox.shareout.site` →
extract the amount → store a row + send a reminder. The sender keeps using Gmail/
Outlook normally; the inbox is ShareOut-owned, so there's no OAuth and no mailbox
access required.

## How it works

```
sender / a Gmail forward rule
        │  → expensas@inbox.shareout.site
        ▼
Cloudflare Email Routing  →  Worker email() handler
        │  parse + store in the artifact's inbox + fire email.received
        ▼
event-triggered jobs run (webhook, telegram, slack, email, crew, …)
```

- **Address:** `<prefix>@inbox.<instance-host>`, where `<prefix>` is auto-generated
  from the artifact slug. The inbox domain is instance-specific: `inbox.` + the
  instance hostname (on shareout.site: `expensas@inbox.shareout.site`), or the
  operator's `EMAIL_INBOX_DOMAIN` override. Don't guess it — read `status.address`
  from `sdk.inbox.enable()`. Plus-addressing works: `expensas+enero@inbox.shareout.site`
  delivers to the same inbox with `tag = "enero"`.
- **Opt-in:** receiving is OFF until enabled. It turns on automatically when you
  create the first `email.received` trigger, or explicitly via `sdk.inbox.enable()`.
  It turns off when the last `email.received` trigger is removed.

## Enable & read (SDK)

```js
const so = await ShareOut.create();

// Turn the inbox on (owner/editor). Optionally restrict who can send.
const status = await so.inbox.enable({ allowlist: ['@edificio.com'] });
console.log(status.address); // "expensas@inbox.shareout.site"

// List / read received mail
const messages = await so.inbox.list({ limit: 20 });
const full = await so.inbox.get(messages[0].id); // includes text/html bodies
const pdfUrl = so.inbox.attachmentUrl(full.id, 0); // download an attachment

// React in real time (polls; the inbox has no socket)
const stop = so.inbox.onMessage((m) => console.log('new mail from', m.from));
```

## Trigger on inbound mail (jobs API)

Create an event-triggered job with `event_type: "email.received"`. The inbound
message is passed to the destination so templates can interpolate it:

```json
POST /v1/jobs
{
  "artifact_id": "{artifactId}",
  "action": "telegram",
  "trigger_type": "event",
  "event_type": "email.received",
  "config": { "customMessage": "New expensa received" }
}
```

`email.received` payload fields available to the job: `from`, `to`, `prefix`,
`tag`, `subject`, `textPreview`, `hasHtml`, `attachments[]`, `auth` (spf/dkim/dmarc),
`receivedAt`, `messageId`, `rfcMessageId`.

## Management API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/data/{id}/inbox/status` | `{ enabled, address, allowlist, receivedToday }` |
| POST | `/v1/data/{id}/inbox/enable` | owner/editor; body `{ allowlist?: string[] }` |
| POST | `/v1/data/{id}/inbox/disable` | owner/editor |
| PUT | `/v1/data/{id}/inbox/allowlist` | owner/editor; `{ allowlist: string[] \| null }` |
| GET | `/v1/data/{id}/inbox/messages` | newest first; `?limit=&before=` |
| GET | `/v1/data/{id}/inbox/messages/{msgId}` | full bodies + attachment metadata |
| GET | `/v1/data/{id}/inbox/messages/{msgId}/attachments/{index}` | download |

## Limits & safety

- **Allowlist:** addresses or `@domain` entries. Unset = any authenticated sender.
  Senders failing both DMARC and DKIM are bounced unless allowlisted.
- **Size:** messages over 25 MB are rejected; attachments are stored in R2.
- **Rate:** 200 received messages/artifact/day.
- **Dedupe:** duplicate deliveries (same Message-ID) are stored once and fire the
  trigger once.
- Deleting the artifact deletes its inbox and all stored messages/attachments.

> Inbound (`inbox.<instance-host>`) is separate from outbound sending
> (`<prefix>@$ORIGIN_HOST`, see [overview.md](overview.md) and the email SDK). The
> two share the artifact's prefix but are independent systems on different domains.
