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

`email.received` payload fields available to the job: `from` (envelope sender), `sender`
(header From — who wrote it), `senderVerified` (Cloudflare vouches for `sender`'s domain), `to`,
`prefix`, `tag`, `subject`, `textPreview`, `hasHtml`, `attachments[]`, `auth` (spf/dkim/dmarc),
`receivedAt`, `messageId`, `rfcMessageId`.

## Update a page's data by email

The person emails (or auto-forwards) an Excel or CSV file to the page's address, and the page's
numbers update by themselves: no sign-in, nothing to install. It is the `email_sheet_sync` job
([config](../api/jobs.md#emailsheetsyncconfig)); the Inspector has the same thing under
Automate → **Update by email** (Spanish: **Actualizar por email**).

Guide the person, one question at a time, in their words. Never show them config, ids, dataset
names, "job", "DMARC" or "allowlist":

1. **Ask who sends the file** ("Who will send the Excel? Their email address."). Default to the
   person themselves. Exact addresses only; a whole `@gmail.com` is refused.
2. `PUT /v1/artifacts/{id}/email-sync/senders { "senders": [...] }` → it answers with `address`.
3. `POST /v1/jobs` with `action: "email_sheet_sync"`, `trigger_type: "event"`,
   `event_type: "email.received"`, `config: { "dataset": <the page's dataset> }` — first tab and
   any `.xlsx`/`.csv` attachment by default. `GET /v1/artifacts/{id}/email-sync` → `datasets`
   lists the page's datasets, most recently written first; use the one the page reads.
4. **Give them the address ready to copy** and say what happens: "Send the Excel to
   `ventas-x1@inbox.shareout.site` from ana@acme.com. The page updates a few seconds later."
   Mention they can set up an automatic forward in Gmail or Outlook if the file arrives by email anyway.
5. **Confirm it worked** once they say they sent it: `GET /v1/artifacts/{id}/email-sync` →
   `lastUpdate.rowCount` ("Got it: 365 rows updated at 10:32"), or `job.lastError` — one plain
   sentence with what to do, in the owner's language. Read it to them as is.

Mail from anyone not on the list is bounced back to the sender ("Sender not permitted"), and so
is mail whose sender can't be verified (sent through another account or an unusual forwarder):
then ask them to send it straight from the allowed mailbox, or add the address that actually sends it.
A file that can't be used (no attachment, wrong type, tab not found, too big) keeps the page's
previous data and emails the owner why.

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
  Senders failing both DMARC and DKIM are bounced unless allowlisted. With a list, the header
  From must be on it and verified: Cloudflare's own `Authentication-Results` (authserv-id
  `mx.cloudflare.net`) shows DMARC pass, or a DKIM pass signed by that sender's domain.
- **Size:** messages over 25 MB are rejected; attachments are stored in R2.
- **Rate:** 200 received messages/artifact/day.
- **Dedupe:** duplicate deliveries (same Message-ID) are stored once and fire the
  trigger once.
- Deleting the artifact deletes its inbox and all stored messages/attachments.

> Inbound (`inbox.<instance-host>`) is separate from outbound sending
> (`<prefix>@$ORIGIN_HOST`, see [overview.md](overview.md) and the email SDK). The
> two share the artifact's prefix but are independent systems on different domains.
