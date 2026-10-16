---
title: Client portals
description: Turn a shared folder into a branded portal for a client — expiring access, a portal link, and a log of who opened what.
---

import { Aside } from '@astrojs/starlight/components';

A **client portal** is a Team Space folder shared with people outside your workspace.
They get one link that shows only that folder's artifacts and files, under their own
branding. You decide how long access lasts and see what they opened.

<Aside type="note">Portals build on [External sharing](/teams/external-sharing/). External people are free and never count toward your seats.</Aside>

## Set one up

1. Create a folder in the Team Space (for example *Acme — Q3 review*) and file the
   artifacts and files you want the client to see. Subfolders are included.
2. Open the folder and click its **access pill** to open **Who has access**.
3. Under **People outside the workspace**, add an email (say `alice@example.com`),
   pick **View** or **Comment**, and choose when **Access ends**.
4. Click **Copy client portal link** and send it, or let the invite email do it.

The invite email links straight to the portal. A new person signs in (or creates their
account) and lands on it; someone who already has access gets an "added" email with the
same link.

## The portal page

The portal lives at `/shared?folder=<folderId>`. It lists only that folder's subtree, with
the folder's name as the title and the person's client branding (logo and color) from
the [client org](/teams/external-sharing/#how-it-works) they belong to in your workspace.
**← Shared with you** goes back to everything shared with them.

If the folder doesn't exist or wasn't shared with them, the link opens their full
**Shared with you** page instead, without saying why.

## Expiring access

When you share with a person, **Access ends** can be:

| Option | Access ends |
| --- | --- |
| **Never** | When you remove it |
| **In 7 days** / **In 30 days** / **In 90 days** | That many days from now |
| **On a date…** | At the end of the day you pick (UTC) |

The panel shows "expires in N days" (or "expires today") next to each person. Access is
cut off as soon as it lapses. Sharing again with the same person replaces the old end
date, so you can extend, shorten or revive access.

## Who opened what

Folder managers see **Who opened what** in the same panel: each time someone outside
the workspace **opened**, **commented on** or **downloaded** something anywhere in the
folder, with the artifact and when. Repeated opens of the same thing by the same person
within an hour count once. Views by your own members aren't listed.

## Who can manage a portal

Workspace admins and owners can manage any folder. The person who **created** the folder
can manage it too, while **Members can create folders** is on (Admin → Settings). Everyone
else sees **Who has access** read-only. See [Team Space folders](/teams/folders/#links-and-access).

## API

Sharing with a person (with an optional expiry) and the folder activity log are
available over the REST API. See the [API reference](/api/) for the sharing and folder
endpoints.
