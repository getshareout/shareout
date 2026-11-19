---
title: Put it on autopilot
description: Your page can do things on its own — email a weekly report, post to Slack when someone signs up, refresh your data every morning.
---

Your page can do things **on its own** — no one sitting there pressing buttons. Set it up once, and it just runs.

## From the page itself

When you're viewing a page you're allowed to manage, the toolbar has a **schedule** button.
Pick email, Slack, or Telegram, choose how often, and ShareOut creates the job for you —
no API calls needed. Owners and editors can schedule delivery to other people; viewers
can subscribe to get the page sent to their own inbox on a recurring schedule.

The **Automate** tab in the Inspector on Home (on a phone: **Options → Automate**) starts with
**Update the data** — from Google Drive, a shared link, or by emailing the Excel — and lists only
the schedules for the artifact you're looking at. Owners and editors see the shared schedules and their own personal
deliveries; someone else's personal subscription (an email or DM to themselves) stays
private to them.

## Two ways it kicks off

**On a schedule** — every morning, every Monday, the first of the month:

> *"Every Monday at 9am, email me the week's new sign-ups."*
>
> *"Every morning, refresh my product list from the spreadsheet."*

**When something happens** — a reply comes in, your page is updated, someone leaves a comment:

> *"When someone submits the RSVP form, post their name to our Slack channel."*
>
> *"When I update the page, email my subscribers the new version."*

## What it can do

| It can… | For example |
| --- | --- |
| **Email** people | A weekly report, a digest, a heads-up |
| **Post to Slack** | A summary, a snapshot, or a PDF to your channel |
| **Post to Discord** | Ping your community server |
| **Refresh your data** | Pull the latest from your spreadsheet or store — see [Keep a page up to date from a spreadsheet](/everyone/google-sheets/#keep-a-page-up-to-date-from-a-spreadsheet) |
| **Notify another app** | Send a signal to a tool you use |

## Real examples

- **A shop owner:** every Monday, email me last week's orders.
- **An event host:** when someone RSVPs, post it to our team chat so we can track headcount.
- **A small team:** every morning, refresh the dashboard from the sheet and post the numbers to Slack.
- **A creator:** when I publish an update, email it to my subscriber list.

## You stay in control

- **Pause it** any time, or run it **right now** to test it.
- **Check what happened** — there's a simple log of each run, so you can see it worked (or why it didn't).

### Open one to see and change everything

Every automation has its own page:

1. In the left sidebar, tap **Automations**.
2. Tap the automation you want. Its page shows **What it does**, **When it runs** and its
   **Run history**.
3. To change it, tap **Edit** — you can change its name, when it runs, who it goes to and
   more — then **Save changes**. **Run now** tries it right away; **Delete** removes it.

If a run in **Run history** says **Failed**, fix what it points to (often an email address
or a disconnected Slack or spreadsheet) and tap **Run now** to check it works again.

Workspace admins also see **AI tasks** in the sidebar. Each AI task opens the same kind of
page, where you can also change its **Instructions**, the **Model**, and its **Max steps**
and **Budget per run (US$)**.

:::tip[Start small]
Pick one thing you do by hand every week — sending a report, copying numbers, pinging the team — and let your page do it instead.
:::

## What's next

- [**Connect your tools**](/everyone/connect/) — automations get more powerful once your data and Slack are connected.
- [**Work together**](/everyone/collaborators/) — bring in teammates to help run things.
