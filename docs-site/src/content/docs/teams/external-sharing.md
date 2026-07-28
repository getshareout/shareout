---
title: External sharing (Clients & Partners)
description: Share folders and artifacts with clients, suppliers, and partners outside your team — branded, scoped, and tracked.
---

import { Aside } from '@astrojs/starlight/components';

Share work **outside your team** — with a client, supplier, partner, or investor — without adding them as workspace members. They see only what you share, on a branded page, and you can see when they open it.

<Aside type="note">External sharing is a **Teams or Enterprise** feature. External people are **free and unlimited** — they never count toward your seats.</Aside>

## How it works

1. **Create a client.** Home → **Admin** → **Sharing** → **Add client or partner** — an inline form on the page (company name + relationship). No modal; the empty state walks through the steps and the same form appears under the header once you have clients.
2. **Invite their people.** Add emails — they get an invite and log in like any ShareOut user. They stay external (never on your member list, never billed).
3. **Share a folder or file.** Pick a folder and a level — **View**, **Comment**, **Can create**, or **Can edit**. A folder shares everything inside it — **pages and files**. From Assets you can also **Share with a person** on a single file (email + view/comment, no client org required).
4. **They open `/shared`.** Each external person has a "shared with you" page showing only what you gave them — pages and downloadable files — branded by their client org when grouped under a client. First-time visitors see a short orientation card. Shared **files** with **comment** access include an inline comments thread on the portal card; shared pages open in the normal viewer.

## Access levels

| Level | They can… |
| --- | --- |
| View | Open and read the shared artifacts. |
| Comment | View + leave comments. |
| Can create | Author new pages **inside** the shared folder (kept private to that folder). |
| Can edit | Edit the shared artifacts. |

A higher level includes the ones below it. You can share a whole folder with a client, a single artifact, or a single **file** from Assets.

### Share with one person (no client org)

`POST /v1/workspaces/{id}/share-person` invites one outside email and grants **view** or **comment** on a **file** or **folder**. Teams/Enterprise + admin required. The person appears on `/shared` without creating a client org. Returns `409 ALREADY_MEMBER` if the email is already an internal workspace member.

## Read receipts

Every time a client opens something you shared, it's logged. In the client's view you'll see recent activity — *"someone at Acme opened the Q3 deck."* A clear signal for renewals and follow-ups.

## API access for clients

If a client needs to pull their data programmatically, mint them an **API token** from their member row. The token only reaches what you granted them — never the rest of your workspace — and it's read-oriented (it can't publish). Copy it once; it's not shown again.

## Notes about a client (your assistant remembers)

Each client has a **Notes** section — private to your team, never shared with the client. Jot down what you know: how they like to work, what they've asked for, what's next.

Your workspace assistant **reads these notes automatically** when it's helping with that client, and can **update them itself** as it learns more — so the account memory stays current without you maintaining it by hand. Admins edit by hand; everyone on the team can read.

Find it in **Admin → Sharing → [client] → Notes about this client**.

## Billing

External people are **$0 and uncapped**. Your bill counts only internal members; the billing page shows external members on a separate "included" line. If your plan lapses, clients keep reading what you already shared — only creating new shares pauses until you're back on Teams.

<Aside type="tip">Just need to send one page to a few outside emails? The free [collaborators](/everyone/collaborators/) flow still works. Clients add grouping, a portal, branding, scoped API access, and receipts on top.</Aside>
