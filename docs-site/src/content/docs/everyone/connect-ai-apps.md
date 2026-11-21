---
title: Connect Claude or ChatGPT
description: Add ShareOut to Claude or ChatGPT with one link, sign in, and ask for a page. You get a link back to share.
---

You can use ShareOut **right from Claude or ChatGPT**. Ask for a page — a report, a one-pager, a list for your team — and the AI publishes it on ShareOut and gives you the link.

You add ShareOut once, with **one link**, and sign in with your ShareOut account. No codes or keys to copy.

## The link

Your ShareOut address followed by `/mcp`. For example:

```
https://shareout.site/mcp
```

If your company runs its own ShareOut, use its address instead (for example `https://shareout.yourcompany.com/mcp`). In ShareOut, **Home → Connect** shows the exact link to copy.

## Claude (claude.ai or the Claude app)

1. Open **Settings → Connectors**.
2. Click **Add custom connector**.
3. Name it **ShareOut** and paste the link.
4. Click **Connect**. A ShareOut page opens: sign in if asked, then click **Allow**.

On a Team or Enterprise plan, an owner may need to add the connector for the organization first.

### Or install the ShareOut plugin

The plugin adds the same connection plus a guide that teaches Claude how to make a good page. In **Customize → Plugins**, add the marketplace `getshareout/shareout` and install **ShareOut**. In Claude Code:

```
/plugin marketplace add getshareout/shareout
/plugin install shareout@getshareout
```

The plugin connects to `https://shareout.site`. If your company runs its own ShareOut, use the link above instead.

## ChatGPT

1. Open **Settings → Apps & Connectors → Advanced settings** and turn on **Developer mode**.
2. Back in **Apps & Connectors**, click **Create**.
3. Name it **ShareOut**, paste the link, and choose **OAuth** for authentication.
4. Click **Create**. A ShareOut page opens: sign in if asked, then click **Allow**.

## Then just ask

- "Make a one-page summary of this and publish it on ShareOut."
- "Turn this table into a page my team can open."
- "Update the launch checklist page: mark the first three done."
- "Invite ana@company.com and leo@company.com to my workspace." (owners and admins)
- "Make a small site for the event: a home page, the schedule and how to get there."
- "Keep this table up to date: Ana emails me the Excel every Monday." (it gives you the address to send it to)
- "Show my stock spreadsheet from Google Drive on a page that updates every morning."

The AI tells you the link and who can see the page. Pages go to your workspace by default, so your team can open them. Ask for **private** or **public** if you want something else.

## If something goes wrong

Tell the AI. It can send a report to the ShareOut team for you, and we follow up by email.

## Ideas and feedback

Wish ShareOut did something, or want to tell us what worked? Say it to the AI: "Send ShareOut the idea: export a page to PDF." It goes straight to the ShareOut team, and the AI tells you it was sent. The AI may also send us a note on its own when ShareOut got in its way, without your personal or company data.

## Disconnect

Remove the ShareOut connector in Claude or ChatGPT settings. It stops working within an hour.
