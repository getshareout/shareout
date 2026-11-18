# Inbound Email Inbox

Give an artifact its own email address. Mail sent (or forwarded) to it is parsed,
stored, and fires an `email.received` trigger — so inbound mail becomes an action.

**Use case:** forward an invoice ("expensas") to `expensas.k7m4p2@inbox.shareout.site` →
extract the amount → store a row + send a reminder. The sender keeps using Gmail/
Outlook normally; the inbox is ShareOut-owned, so there's no OAuth and no mailbox
access required.

## How it works

```
sender / a Gmail forward rule
        │  → expensas.k7m4p2@inbox.shareout.site
        ▼
Cloudflare Email Routing  →  Worker email() handler
        │  parse + store in the artifact's inbox + fire email.received
        ▼
event-triggered jobs run (webhook, telegram, slack, email, crew, …)
```

- **Address:** short, so it is easy to type or dictate: the first word of the artifact slug, a
  dot and six random letters/digits (no 0/o/1/l/i look-alikes) — `expensas.k7m4p2@inbox.shareout.site`.
  It is minted once and never changes, and never goes to another artifact (not even after this one
  is deleted). The long slug address an artifact had before (`expensas-de-octubre@inbox…`) keeps
  working, with the same sender rules; it is just no longer shown. The inbox domain is
  instance-specific: `inbox.` + the instance hostname, or the operator's `EMAIL_INBOX_DOMAIN`
  override. Don't guess it — read `address` from the status (`sdk.inbox.enable()`,
  `GET /v1/artifacts/{id}/email-sync`). Plus-addressing works:
  `expensas.k7m4p2+enero@inbox.shareout.site` delivers to the same inbox with `tag = "enero"`.
- **Opt-in:** receiving is OFF until something turns it on:
  - `PUT /v1/artifacts/{id}/email-sync/senders` (Update by email) — turns it on and sets who may send;
  - creating an `email.received` job — turns it on;
  - `sdk.inbox.enable()` / `POST /v1/data/{id}/inbox/enable` — turns it on.

  Deleting the last `email.received` job turns it off, but **keeps the sender list** for next
  time. While a page updates by email (`email_sheet_sync`), `POST /v1/data/{id}/inbox/disable`
  is refused (`409 EMAIL_SYNC_ACTIVE`): remove the email sync instead.

## Enable & read (SDK)

```js
const so = await ShareOut.create();

// Turn the inbox on (owner/editor). Optionally restrict who can send.
const status = await so.inbox.enable({ allowlist: ['@edificio.com'] });
console.log(status.address); // "expensas.k7m4p2@inbox.shareout.site"

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
Automate → **Update by email** (Spanish: **Actualizar por email**). Over MCP, `set_email_sync`
does steps 2–4 in one call (it picks the dataset the page reads) and `check_email_sync` does step 6
([mcp-connector.md](mcp-connector.md)).

Guide the person, one question at a time, in their words. Never show them config, ids, dataset
names, "job", "DMARC" or "allowlist":

1. **Ask who sends the file** ("Who will send the Excel? Their email address."). Suggest the
   person's own address (`you` in the status). Exact addresses only; a whole `@gmail.com` is refused.
2. `PUT /v1/artifacts/{id}/email-sync/senders { "senders": [...] }` (one address may be a plain
   string) → it answers with `address`.
3. **Pick the dataset the page reads.** `GET /v1/artifacts/{id}/email-sync` → `suggestedDataset`:
   the one the live page reads (`reads`) when it reads exactly one — use it without asking. `null`
   means the page reads several: ask in plain words which table the file fills. Writing a dataset
   the page does not read leaves the page empty with no error, so never guess.
4. `POST /v1/jobs` with `action: "email_sheet_sync"`, `trigger_type: "event"`,
   `event_type: "email.received"`, `config: { "dataset": <suggestedDataset> }` — first tab and
   any `.xlsx`/`.csv` attachment by default. The `201` carries `address`, `senders` and, when the
   page does not read that dataset, a `warning` to fix before going on. A second job for the same
   page and dataset is `409 DUPLICATE_JOB` with the existing `job_id`.
5. **Give them the address ready to copy** and say what happens, in three steps: open your mail;
   write a new email to `ventas.k7m4p2@inbox.shareout.site` from ana@acme.com; attach the Excel and
   send. Subject and text do not matter; the first tab's first row is the column titles; **the
   file replaces the data** the page shows. If the file reaches them by email anyway, an Outlook
   rule can forward it (add the original sender to the list); Gmail's automatic forwarding needs a
   confirmation the page's address cannot answer yet. Give them the page link at the end.
6. **Confirm it worked** once they say they sent it: `GET /v1/artifacts/{id}/email-sync` →
   `state` and `message` (one line, their language). `ok` + `lastUpdate.rowCount` ("Got it: 365
   rows updated at 10:32"); `failed` + `job.lastError` — one plain sentence with what to do, read
   it to them as is; `waiting_first_email` + `lastRejected` — the mail was bounced (below).

`POST /v1/jobs/{id}/run` does not apply: the job runs when mail arrives, so it answers
`409 NOT_RUNNABLE` with the address and changes nothing.

### A table of an Excel file, from scratch

When the person has a spreadsheet and no page yet ("make me a table of this Excel that stays up
to date"):

- **In ShareOut, no assistant:** **New → Table from an Excel file** (Spanish: **Nuevo → Tabla desde
  un Excel**). They pick the `.xlsx`/`.csv`; ShareOut makes a private page with a phone-friendly
  table (first row = column titles, "Updated today at 10:32", an empty state), opens it, and offers
  the three ways to keep it up to date — **by email** first, already pointed at the table's data, so
  the only question is who sends the file. API: `POST /v1/home/new { "template": "table", "lang":
  "es", "file": { "name": "ventas.xlsx", "content": "<base64>" } }` → `{ artifactId, slug, name,
  rowCount }`, or `400/413/422 { code, error }` (`NOT_A_SHEET` · `TOO_LARGE` · `TOO_MANY_ROWS` ·
  `NO_ROWS` · `UNREADABLE`) where `error` is one sentence saying what to do, in their language.
- **Over MCP:** `publish_artifact` a page that reads one dataset (below) and shows a table with an
  empty state, then `set_email_sync` (one question: who sends the file) and ask them to email the
  Excel once to the address it returns — the table fills from that first email. Or point them to
  **New → Table from an Excel file**, which does it in one step.

### In the page

The page reads the data with the SDK. `get()` returns `[]` until the first file arrives, so the
page shows an empty state instead of breaking:

```html
<script src="/sdk/shareout.js"></script>
<script>(async () => { const sdk = await ShareOut.create();
  const rows = await sdk.dataset('ventas').get();   // [] until the first file arrives
  /* draw rows */ })();</script>
```

`(await sdk.dataset('ventas').metadata()).updatedAt` is when the rows last changed — show it
("Updated today 10:32"). `verify_artifact` treats a page that is only waiting for its first file
as a note, not a failure.

### Limits

| | |
|---|---|
| File | 8 MB, up to 100,000 rows; `.xlsx` or `.csv` |
| Email | 25 MB |
| Emails per page | 200 a day |

The same numbers are in the status (`limits`).

### When a file does not arrive

Mail from anyone not on the list is bounced back to the sender, and so is mail whose sender can't
be verified (sent through another account or an unusual forwarder) — both with the same sentence:
"This address only accepts files from people the owner of the page has approved. Ask them to add
your address, then send it again." Also bounced: mail over 25 MB, mail past the daily limit and
mail to a switched-off address. The last one bounced is kept: `lastRejected` (`from`, `reason`: `not_allowed` · `unverified` · `too_large` ·
`rate_limited` · `inbox_off`, `at`, and a `message` saying what to do). Then ask them to send it
straight from the allowed mailbox, or add the address that actually sends it.
A file that can't be used (no attachment, wrong type, tab not found, headers but no rows, too big)
keeps the page's previous data and emails the owner why (`state: failed`).

`state: inbox_off` means the sync exists but the address is off: `PUT …/email-sync/senders`
with the same list turns it back on.

Stopping (`DELETE /v1/jobs/{id}`) turns the address off and keeps the page's data and the sender
list (`senders_kept` in the answer).

## Management API

| Method | Path | Notes |
|--------|------|-------|
| GET | `/v1/data/{id}/inbox/status` | `{ enabled, address, allowlist, receivedToday }` |
| POST | `/v1/data/{id}/inbox/enable` | owner/editor; body `{ allowlist?: string[] }` |
| POST | `/v1/data/{id}/inbox/disable` | owner/editor; `409 EMAIL_SYNC_ACTIVE` while the page updates by email |
| GET | `/v1/artifacts/{id}/email-sync` | Update by email status: `address`, `senders`, `reads`, `suggestedDataset`, `state`, `message`, `job`, `lastEmail`, `lastUpdate`, `lastRejected`, `limits` |
| GET / PUT | `/v1/artifacts/{id}/email-sync/senders` | `{ address, senders }`; PUT `{ senders: string[] \| string }` turns the address on |
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
