---
title: Receive email
description: Give your page its own email address — forward mail to it and your page reacts. Save the message, get notified, or kick off an automation.
---

Your page can have its **own email address**. Anything sent there shows up in your page — and can kick off an automation. No inbox to connect, no account to link: the address is yours, and it works no matter what email anyone sends from.

> *Forward the building's expensas to your page → it logs the amount and reminds you 3 days before it's due.*

## Turn it on

Open your page in the **editor** and click the **Inbox** button (the envelope in the toolbar). Hit **Enable inbox** and you'll get an address like:

```
expenses.k7m4p2@inbox.YOUR_DOMAIN
```

It's short on purpose, so it's easy to type or read out over the phone: the first word of the page's
name, a dot, and six letters and numbers. Copy it with one click. (An address a page was given
before keeps working.) You can also enable it from the **Home** dashboard — open a page's details and find the **Inbox** section there.

## Get mail into it

Two easy ways:

- **Give the address out.** Put it on a form, hand it to a supplier, use it as your "send receipts here" address.
- **Forward from your existing inbox.** In Gmail (or Outlook), add one filter — *"from billing@… → forward to expenses.k7m4p2@inbox.YOUR_DOMAIN"* — and you never think about it again.

:::tip[Add a tag with “+”]
`expenses.k7m4p2+receipts@inbox.YOUR_DOMAIN` lands in the **same** inbox, tagged `receipts`. Use tags to tell different kinds of mail apart so an automation can treat them differently.
:::

## See what arrives

Every message shows up right in your page — in the editor's **Inbox** panel and in the Home details drawer. Click one to read the full text and **download any attachments** (the PDF invoice, the photo, whatever came in).

## Make it *do* something

On its own, the inbox just collects mail. Pair it with an [**automation**](/everyone/automations/) and each new email can:

| When a mail arrives… | …your page can |
| --- | --- |
| A receipt comes in | Save the amount to a list |
| A supplier emails | Ping you on Telegram or Slack |
| A form reply lands | Notify your team |
| Anything arrives | Send a signal to another app |

Set up a "when an email arrives" automation once, and it runs every time — turning your inbox into action.

## Start from an Excel file

No page yet? In **New → Table from an Excel file**, pick an Excel (.xlsx) or CSV file from your
computer. ShareOut makes a page with a clean table of it — the first row is the column titles —
that reads well on a phone and says when it was last updated. Then it asks how to keep it up to
date: **by emailing the Excel** is one tap (just say who sends it), or from Google Drive, or from a
link. A file it can't use (too big, empty, not a spreadsheet) gets one sentence saying what to do.

## Update your page's numbers by emailing the Excel

Does someone send you the same spreadsheet every week? Your page can update itself from it.
Open the page from Home and choose **Update by email**. Say who sends the file (just their
email address), press **Turn on**, and you get the page's address. Then, each time:

1. Open your mail.
2. Write a new email to the page's address.
3. Attach the Excel and send it. The subject and the text don't matter.

A few seconds later the page shows the new numbers. Good to know:

- The **first row** of the first sheet is the column titles.
- Each file **replaces** the data the page shows.
- Only the people you listed can update it; mail from anyone else is sent back. Use the exact
  address (like `ana@gmail.com`), not a whole `@gmail.com`.
- If a file can't be used, the page keeps its previous numbers and you get an email saying why.
- Limits: 8 MB and 100,000 rows per file, 25 MB per email, 200 emails a day.

### Let the report arrive by itself

Does the report already reach you by email? Your mail can forward it to the page by itself. The
steps are also in the page's **Update by email** window, under **Let the report arrive by itself**.

**Gmail**

1. In Gmail: **Settings → See all settings → Forwarding and POP/IMAP → Add a forwarding address**.
   Paste the page's address.
2. Gmail sends the page a confirmation. In a few seconds it shows up at the top of the **Update by
   email** window: *"Gmail wants to confirm forwarding from ana@…"*. Tap **Confirm** — a Google page
   opens; press **Confirm** there too. Then say whose report it is (the address it comes from), and
   tap **Allow**.
3. Open one of the reports in Gmail → **⋮ → Filter messages like these → Create filter** → tick
   **Forward it to** and choose the page's address.

Only the report is forwarded: don't turn on "Forward a copy of incoming mail", the filter is enough.
Don't recognise the address in the confirmation? Tap **It's not mine** and nothing is confirmed.

**Outlook or Microsoft 365**

1. In Outlook: **Settings → Mail → Rules → Add new rule**.
2. Condition: **From** → whoever sends you the report. Action: **Forward to** → the page's address. Save.
3. The forward comes from your own address, so it has to be in **Who can send it** (it already is
   if you set this up with it).

Outlook asks for no confirmation. If nothing arrives, your company may not allow forwarding
outside it — and Outlook doesn't tell you. Ask your IT person to allow automatic forwarding for
your mailbox.

**A forwarded report was sent back?** A Gmail filter keeps the report's original sender, and only
the people you listed can update the page. The window then says *"A file from reports@… forwarded
from your mail was bounced"* with one button, **Allow reports@…**. Tap it, and the next report
updates the page (forward the last one again so you don't wait). The page also keeps the last few
emails it sent back, so one stray email doesn't hide the one you're looking for.

## A real example

1. Make an **"Expenses"** page and enable its inbox → `expenses.k7m4p2@inbox.YOUR_DOMAIN`.
2. In Gmail, forward the building's invoices to that address (one filter).
3. Add an automation: *when an email arrives, save the amount and remind me on Telegram 3 days before it's due.*

Now every invoice flows in and gets handled — you do nothing.

## You stay in control

- **Allowed senders** — leave it open to anyone, or restrict it to certain people or domains (e.g. only `@yourcompany.com`). Spoofed senders are turned away automatically.
- **Turn it off** any time. New mail is declined; everything you already received stays. (A page that updates by email turns its address off when you stop **Update by email**.)
- It's **per page and opt-in** — nothing receives mail unless you switch it on.

## What's next

- [**Put it on autopilot**](/everyone/automations/) — make inbound mail trigger an action.
- [**Lists & data**](/everyone/your-data/) — store what arrives as rows you can sort and filter.
