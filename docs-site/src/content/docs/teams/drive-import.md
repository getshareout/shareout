---
title: Bring your files from Drive / SharePoint
description: Import whole folders from Google Drive, OneDrive or SharePoint into workspace files, keep them in sync, and turn documents into pages.
---

import { Aside } from '@astrojs/starlight/components';

Move a team's files into ShareOut without downloading and re-uploading them. Pick a
folder in **Google Drive**, **OneDrive** or a **SharePoint** document library, choose
where it goes, and ShareOut copies it with its subfolders. Run it again whenever you
like: only new or changed files come over.

## Who can import

Workspace **owners** and **admins**, and **members** while the workspace lets members
create folders (*Settings → members can create folders*). External members can't.

## Import a folder

1. In the workspace, open **New → Import from Drive / OneDrive / SharePoint**.
2. **Connect** the drive. A window asks Google or Microsoft for **read-only** access
   to your files. This is separate from how you sign in to ShareOut, and only you
   can use your connection.
3. **Pick a folder.** Google: *My Drive*, *Shared with me* or a shared drive.
   Microsoft: *My files (OneDrive)*, a site you follow, or search for a SharePoint
   site → library → folder.
4. **Choose where it goes** — the top level of Files, or inside a Team Space folder.
   The picked folder becomes a ShareOut folder there, with the same subfolders.
5. Every Word, Excel, PDF, Markdown, CSV, image and video file becomes an artifact (and
   slide decks, when the instance has the slides converter). The original is kept
   inside it for download.
6. **Start import** and watch the progress: found, imported, pages, unchanged,
   skipped and failed, plus the files that need a look and why.

## What happens to each file

| In the drive | In ShareOut |
|---|---|
| Google Docs / Sheets / Slides | Exported as `.docx` / `.xlsx` / `.pptx` |
| Google Drawings, Jamboards | Exported as PDF |
| Google Forms, Sites, My Maps, Apps Script, shortcuts | Skipped — they have no document form |
| OneNote notebooks | Skipped — export them from OneNote first |
| Scripts, web pages, programs (`.js`, `.html`, `.exe`…) | Skipped, like any upload |
| Everything else | Copied as-is |

- Files take the **visibility of the target folder**: a private folder's files stay
  private, a public folder's files get a shareable link, otherwise they are visible
  to the team. Pages created from documents are never public.
- With [Knowledge](/teams/knowledge/) on, each artifact is learned like any page.
- File names with accents or symbols are stored with a safe file name; the display
  name keeps the original.

## Sync again, or every day

**Sync again** re-reads the folder and fetches only what changed (Drive's modified
time, Microsoft's content tag). A changed file becomes a **new version** of the same
file, and its page a new version of the same page. Files moved between subfolders
move here too. Files deleted in the drive are **kept** here.

Tick **Sync daily** to do it once a day (up to 10 folders per workspace).

## Limits

- One import reads at most **10,000 files**, **2,000 folders**, **20 levels** deep; past
  that the run finishes with a note — import the rest as smaller folders.
- The workspace **storage limit** and **per-file limit** apply. When storage is full the
  import stops cleanly, says so, and keeps what it already copied; free space and sync
  again to continue.
- Google exports documents up to 10 MB; larger Docs are reported so you can download
  them from Drive yourself.
- At most 300 documents per run become pages; the rest still import as files.
- If the drive rate-limits the import, ShareOut waits and retries on its own.

## Disconnect

**Disconnect** in the same window removes your connection (and revokes it at Google).
Every folder syncing through it stops, including a run in progress and daily sync.
Files already imported stay. To keep syncing, connect again and import the folder again.

<Aside type="note">
**Self-hosting:** the feature appears once the instance sets `GOOGLE_DRIVE_CLIENT_ID` /
`GOOGLE_DRIVE_CLIENT_SECRET` and/or `MICROSOFT_FILES_CLIENT_ID` /
`MICROSOFT_FILES_CLIENT_SECRET` (plus `CREDENTIALS_KEY`). Redirect URIs:
`$SHAREOUT_BASE_URL/v1/file-imports/oauth/google_drive/callback` and
`…/microsoft/callback`. Bind the `FILE_IMPORT` Workflow for large folders.
See [Secrets](/self-host/secrets/).
</Aside>
