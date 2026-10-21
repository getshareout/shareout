---
title: Files & deliverables
description: Store images, video, and any file in one place, reuse them across pages, and send a client a clean download link.
---

:::caution[Assets has been retired]
Everything you upload now becomes an artifact (documents, images, video), with the
original kept inside it. The **Assets** tab is no longer in Home; links to existing
files keep working. The rest of this page describes the retired tab.
:::

The **Assets** tab in your Home is a place to keep files — images, video, PDFs, spreadsheets, decks, zips, anything — store them once, reuse them across your pages, and hand a client a clean download link.

Open it from the left rail in your Home: **Assets**.

## Add files

Click **Upload files** and pick one or many. There's no "what type?" — drop in a video, a `.xlsx`, a `.pptx`, a `.zip`. Each file becomes a **deliverable** you can reuse and share. Each file can be up to 500&nbsp;MB; your instance admin may set a lower cap.

### Without opening Assets

Files can land in your library from three other places — each records **where it came from** so the workspace assistant can find it later:

| Channel | How | Who |
| --- | --- | --- |
| **Workspace file inbox** | Email attachments to `{workspace-slug}@inbox.YOUR_DOMAIN` | Workspace members only — the sender must be signed up with that email |
| **Chat attach** | Paperclip in the Home **Ask your workspace…** composer | You (uploads to your scope's asset bucket) |
| **Share from phone** | Install ShareOut as a PWA, then **Share → ShareOut** from any app | You — opens Home with the file ready to attach in chat |

The workspace inbox address is in **Admin → Settings → File inbox** (copy with one click). Admins get a bell notification and optional Telegram ping when a member emails files in. Spreadsheets (`.xlsx`, `.csv`), decks (`.pptx`), PDFs, and images are the typical payloads.

:::note[Not the same as a page inbox]
A **page inbox** (`your-page@inbox.YOUR_DOMAIN`) captures mail *into one artifact* for automations — see [Receive email](/everyone/inbox/). The **workspace file inbox** feeds the shared **Assets** library and the AI assistant instead.
:::

## Organize in folders

Use the **folder bar** at the top of Assets to group files — client deliverables, brand assets, raw footage, whatever makes sense. **New folder** creates a folder in the same shared folder tree your pages use; click a file and choose **Move** to put it inside a folder.

Sharing a **folder** with a client (Admin → Sharing) also shares the **files** inside it — folders are one tree for pages and files.

## Visibility

Every workspace file has one of three settings, shown as a badge on its tile:

- **Team only** (default for new uploads) — signed-in members of the workspace can open it; nobody else.
- **Only you** — hidden from other members until you share it with someone.
- **Anyone with the link** — no sign-in needed. Pick this to show the file inside an artifact or to send it outside the team.

When you upload, ShareOut asks who can see the files (Team only is preselected). To change it later, click the file and pick a new option under **Who can see it**. Files uploaded before this default existed keep the setting they had.

:::caution[Anyone with the link is not membership-gated]
The link's id is an unguessable random token, but opening it does **not** check that you're signed in or a workspace member — anyone who gets the URL (a leaked link, a screenshot, a shared page's source) can open the file. That's different from a page set to `workspace` visibility, which does check membership. Don't upload anything you'd need real access control on — use **private** plus an explicit grant instead.
:::

- **Anyone with the link** files can be embedded in any page via a stable file URL (`/v1/files/dlv_…/content`). **Team only** and **Only you** files need a signed-in viewer, so they won't load inside a published artifact.
- **Only you** files are hidden from other members and from anonymous delivery links — share them deliberately via [external sharing](/teams/external-sharing/) or **Share with a person** (below).

## Versions

Re-sending the third cut of a video? Click the file, choose **Upload new version**, and pick the new file — it becomes **v2**, **v3**, and so on. The tile always shows the latest version with a small `v3` badge; **Version history** lists every version, so you can grab an older one anytime.

## Comment on a file

Click a file and choose **Comments** to leave a thread on that file.

- Same storage and notifications as page comments, but **scoped only to that file**.
- Workspace members can comment on **Team only** and **Anyone with the link** files (and always on files they own).
- **Only you** files: only the owner (and people you shared with) see the thread.
- External sharees need a **comment** grant to post; a **view** grant is enough to read.
- Threads also appear on the recipient's **`/shared`** portal for files shared with them.

For the API shape (`contextId: "file:…"`) see [SDK: Comments](/sdk/comments/#file-comment-examples).

## Share with one person (Teams)

On a file tile, **Share with a person** sends a single file to one outside email — no client org required. Pick **View** or **Comment**; they get an invite (if new) and the file appears on their **`/shared`** portal. Returns `409` if that email is already an internal workspace member — use a normal collaborator invite instead.

On a **folder**, use **Share folder** in the folder bar — same flow, grants view or comment on the whole folder (pages and files inside). The share modal lists **People you've shared with** for that file or folder; revoke any grant from there.

External sharees with **comment** access can leave threads on shared files directly in the **`/shared`** portal — see [External sharing](/teams/external-sharing/).

## Reuse a file across pages

Every asset has a permanent link. Click **Copy link** on any tile and paste it into a page (an `<img>`, a button, a download link) — one source, used in as many artifacts as you like. Change nothing on the pages when you swap the file; they point at the same asset.

In artifact HTML, prefer **`sdk.files.getUrl('dlv_…')`** for workspace files — it resolves to the latest version and enforces visibility (private files 403 for unauthorized viewers). See [SDK: Files](/sdk/files/).

Editing a page? The visual editor's toolbar has an **Insert asset** button — open it, pick a file from your library, and it drops straight onto the page. No copying links by hand.

## Send a delivery to a client

This is the WeTransfer-style flow:

1. Click **Bundle files to send →**.
2. Tick the files for this delivery.
3. **Create delivery** → name it (e.g. *"Final files for Acme"*). Optionally set an **expiry date** and **protect the link** — with a password, or by limiting it to certain email domains (e.g. only `@acme.com`).
4. You get a **link** to a clean, branded download page that lists every file with a Download button.
5. **Copy** the link to paste anywhere, or type a client's email and **Send** — they get a tidy email with the download link.

Protected links gate the **download page and the file bytes** — a recipient must clear the password or domain check before any file streams. For a protected delivery, share the `/d/<token>` link, not the per-file **Copy link** from the library (that stable URL is for embedding an asset across your pages).

Because it's a link (not an attachment), file size doesn't matter — send a folder of 4K renders the same way you send a logo.

## Manage sent deliveries

Click **Sent deliveries** at the top of Assets to see every link you've minted — collection name, file count, gate type, expiry, open count, and live status (active, expired, or revoked). From there you can **copy** a link again or **revoke** it; a revoked link 404s for both the page and the downloads.

## Open notifications

The first time someone opens a delivery (past any gate and with the files actually shown), you get an email — for example *"Acme opened your delivery."* Repeat opens of the same link stay quiet so a refresh never spams you. For a domain-gated link, the viewer's email is included in the notification.

:::tip[Team vs. personal]
In a Team Space, the Assets library is shared — any member can upload and send. On your personal Home it's just yours.
:::
