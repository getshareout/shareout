---
title: Email
description: Send and receive mail from your instance, or run without it.
---

ShareOut runs without email on purpose — **password sign-in is the default path and needs
no mail provider at all**. Email is what you add when you want invites, digests and
one-time codes to reach an inbox instead of a log.

## What is off without it

| Feature | Without the `EMAIL` binding |
|---------|-----------------------------|
| One-time sign-in codes | Written to the Worker log. Usable for a solo operator, not for a team |
| Workspace invites | Not mailed — hit **Copy link** and send the join URL yourself ([below](#inviting-people-without-email)) |
| Weekly digest, notifications | Not delivered |
| Artifact email, crew email delivery | Not delivered |
| **Password sign-in** | **Unaffected.** This is why an instance is usable with no email at all |

## Sending

The binding ships commented out in `wrangler.toml`. Uncomment it:

```toml
[[send_email]]
name = "EMAIL"
```

Set the sender and redeploy:

```toml
[vars]
EMAIL_DEFAULT_FROM = "shareout@yourcompany.com"
```

```bash
npm run deploy
```

Bindings and vars are deploy-time — unlike secrets, they do not take effect until the
redeploy lands.

:::caution
Cloudflare will not let a Worker send to arbitrary addresses. The recipient has to be a
**destination address verified on your Cloudflare account**, or within what the binding
is configured to allow. This is the single most common reason a correctly-configured
instance still sends nothing — check the Email section of your Cloudflare dashboard
before debugging ShareOut. See Cloudflare's Email Routing docs for the current rules.
:::

Verify by reading the config back:

```bash
curl -sS "$ORIGIN/v1/admin/instance" -H "Authorization: Bearer $SHAREOUT_TOKEN" | jq '.email'
```

`binding: true` and a `default_from` means sending is live. Then actually send one —
invite yourself to a workspace and watch it arrive.

## Receiving

Artifacts and workspaces can accept inbound mail: a file inbox per workspace, and
per-artifact addresses.

1. Enable **Email Routing** on your domain in Cloudflare.
2. Route a catch-all to this Worker. The Worker exports an `email()` handler; Cloudflare
   delivers to it.
3. Set the domain those addresses live on:

   ```toml
   [vars]
   EMAIL_INBOX_DOMAIN = "inbox.yourcompany.com"
   ```

   Unset, it defaults to `inbox.<your instance host>`.

The inbox subdomain is deliberately separate from your apex so a catch-all never swallows
real mailboxes like `hello@yourcompany.com`.

Once it is live, **Admin → Settings** shows the workspace's inbox address. If that section
is missing, the instance has no email binding — the address is hidden rather than shown as
something that cannot receive.

## Deliverability

Whatever you send, you own the reputation of the sending domain:

- SPF, DKIM and DMARC on the sending domain — Cloudflare's dashboard walks these
- a real, monitored `From` address, not `noreply@`
- ShareOut keeps a suppression list and honours unsubscribes per category; a bounce or a
  complaint stops future sends to that address on its own

## Inviting people without email

Invite as normal — **Admin → Members**, enter the address. The invite is created whether or
not mail can go out. It then appears under **Pending invites** with two buttons:

- **Copy link** — mints a join URL and copies it. Send it however you like: Slack, chat,
  out loud. Nothing is emailed.
- **Resend** — mails the invite again. Does nothing useful without the `EMAIL` binding.

The link looks like `{origin}/invite/{code}`. It is single-use, expires in 7 days, and only
works for the address it was issued to.

Copying a link never invalidates one you sent earlier — each press mints an additional
claim, and every unclaimed one stays redeemable until it expires. Use **Revoke** (×) to
kill all of them at once.

```bash
# Same thing over the API — notify:false mints a link without sending mail
curl -sS -X POST "$ORIGIN/v1/workspaces/$WORKSPACE_ID/invites/$INVITE_ID/resend" \
  -H "Authorization: Bearer $SHAREOUT_TOKEN" -H 'Content-Type: application/json' \
  -d '{"notify":false}' | jq -r '.inviteUrl'
```

:::note
The code is stored hashed, so it can only be read at the moment it is minted. There is no
endpoint that reads back an existing invite's link — pressing **Copy link** again mints a
fresh one, which is why it works even for invites created before you read this page.
:::

## Running deliberately without email

A private instance for a small team is a legitimate no-email configuration:

- people sign in with **email and password** (`/setup` for the first admin)
- invites work through **Copy link**, above — no mail provider needed
- one-time codes still work if you can read the Worker log
- `/v1/admin/instance` lists the `EMAIL binding` gap so it stays a visible decision rather
  than a thing you forgot
