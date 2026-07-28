---
title: Receive email
description: Give your page its own email address — forward mail to it and your page reacts. Save the message, get notified, or kick off an automation.
---

Your page can have its **own email address**. Anything sent there shows up in your page — and can kick off an automation. No inbox to connect, no account to link: the address is yours, and it works no matter what email anyone sends from.

> *Forward the building's expensas to your page → it logs the amount and reminds you 3 days before it's due.*

## Turn it on

Open your page in the **editor** and click the **Inbox** button (the envelope in the toolbar). Hit **Enable inbox** and you'll get an address like:

```
your-page@inbox.YOUR_DOMAIN
```

Copy it with one click. You can also enable it from the **Home** dashboard — open a page's details and find the **Inbox** section there.

## Get mail into it

Two easy ways:

- **Give the address out.** Put it on a form, hand it to a supplier, use it as your "send receipts here" address.
- **Forward from your existing inbox.** In Gmail (or Outlook), add one filter — *"from billing@… → forward to your-page@inbox.YOUR_DOMAIN"* — and you never think about it again.

:::tip[Add a tag with “+”]
`your-page+receipts@inbox.YOUR_DOMAIN` lands in the **same** inbox, tagged `receipts`. Use tags to tell different kinds of mail apart so an automation can treat them differently.
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

## A real example

1. Make an **"Expenses"** page and enable its inbox → `expenses@inbox.YOUR_DOMAIN`.
2. In Gmail, forward the building's invoices to that address (one filter).
3. Add an automation: *when an email arrives, save the amount and remind me on Telegram 3 days before it's due.*

Now every invoice flows in and gets handled — you do nothing.

## You stay in control

- **Allowed senders** — leave it open to anyone, or restrict it to certain people or domains (e.g. only `@yourcompany.com`). Spoofed senders are turned away automatically.
- **Turn it off** any time. New mail is declined; everything you already received stays.
- It's **per page and opt-in** — nothing receives mail unless you switch it on.

## What's next

- [**Put it on autopilot**](/everyone/automations/) — make inbound mail trigger an action.
- [**Lists & data**](/everyone/your-data/) — store what arrives as rows you can sort and filter.
