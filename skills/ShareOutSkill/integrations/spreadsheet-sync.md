# Keep a page's data in sync with a spreadsheet

The person keeps a Google Sheet (or an Excel file in Google Drive) up to date, and wants a
page to show what is in it — every day, without uploading anything. ShareOut copies one tab
into one of the page's **datasets** on a schedule; the page reads it with
`sdk.dataset(name).get()` ([sdk/datasets.md](../sdk/datasets.md)). The Inspector does the same
thing under **Automate → Sync data**.

Two ways in, one question decides:

| The file… | Way | Job action | Who clicks what |
|---|---|---|---|
| may be seen by anyone who has its link | **Shared link** | `public_sheet_sync` | The person sets the file to "Anyone with the link" in Google and gives you the link. No Google sign-in. |
| is private (personal, confidential, internal) | **Private file** | `drive_file_sync` | The person opens a link you give them and **picks the file in Google**, once. ShareOut can then read only that file. |

Both need owner or editor access to the page, and the page must be inside a workspace.
Each run writes the tab as JSON rows keyed by the header row; when nothing changed, the run
skips the write.

The file is not in Google at all — it arrives by email, or lives on someone's computer? A third
way needs no Google: they email the Excel/CSV to the page's own address and the page updates
(`email_sheet_sync`, MCP `set_email_sync`). See
[inbound-email.md](inbound-email.md#update-a-pages-data-by-email).

## Guide the person, don't configure at them

They are usually not technical. Run it as a short conversation:

1. **Ask one thing:** "Can anyone with the link see this spreadsheet, or is it private?"
   (Spanish: "¿Esa planilla la puede ver cualquiera con el enlace, o es privada?"). If they are
   not sure, or it has names, emails, salaries or anything internal → **private file**.
2. **Do the step for them** and hand over only what they must click or paste — the link
   ready to click, the three clicks in Google named exactly.
3. **Say what they will see** before they see it, in one line.
4. **Pick the defaults** — the first tab with data, every day at 08:00 in their time zone, a
   dataset named after the file. Ask about the tab or the hour only if they brought it up.
5. **Confirm it worked** with what happened: "Listo: la página ya tiene 365 filas de *Ventas
   2026* y se actualiza todos los días a las 8." Never show schedule codes, ids, dataset names,
   "job", "cron", "OAuth" or "scope".
6. **Errors:** one sentence on what went wrong, then exactly what to do (the clicks, or the
   link again).

## With the ShareOut connector (MCP tools)

| Tool | Does |
|---|---|
| `inspect_sheet_link` | Checks a shared link: public or not, title, tabs, rows and columns of the first tab. Saves nothing. |
| `pick_drive_spreadsheet` | Returns the link the person opens to pick a private file in Google, and the last file they picked in this workspace. |
| `set_sheet_sync` | Creates the sync (from `link` or a picked `file_id`) with the defaults, loads it once right away and reports the row count; with `job_id` it changes one. A new sync whose first load fails is removed again. It never writes over data the page already has: a default name that is taken becomes `name_2`; a `dataset` you name that exists is refused unless `replace_existing: true` (confirm with the person first); a name another schedule fills is always refused. |
| `remove_sheet_sync` | Stops a sync. The data already loaded stays on the page. |
| `list_jobs` | Lists the page's syncs (with `artifact_id`), to find the `job_id`. |

### Shared link

1. Get the link from the person. `inspect_sheet_link { link }`.
2. Tell them plainly: **anyone who has this link can open the file — only for data that can be
   public, never personal or confidential data.** If that is not OK, switch to the private way.
3. `set_sheet_sync { artifact_id, link }` (add `timezone`, e.g. `America/Argentina/Buenos_Aires`,
   so 08:00 is their 08:00). Confirm with the row count it reports.

If the link is not shared yet (`NOT_PUBLIC`), give them the three clicks, in the language of
*their* Google:

- English: **Share → General access → "Anyone with the link" → Viewer**
- Spanish: **Compartir → Acceso general → "Cualquier persona que tenga el vínculo" → Lector**

The link stays the same; check it again once they say done.

### Private file

1. `pick_drive_spreadsheet {}` (pass `link` if they have the file's link: the picker then shows
   only that file). If the result says their role cannot connect Google Drive, say who can
   (a workspace admin) — stop there.
2. Give them `pick_url` ready to click, and one line on what they will see, e.g.
   "Abrí este enlace: Google te pide elegir tu cuenta y permitir que ShareOut vea solo el
   archivo que elijas; después elegís la planilla y tocás *Seleccionar*. Cuando termines,
   avisame."
3. When they say done, call `pick_drive_spreadsheet` again: `picked` names the file they chose
   (check the name with them if it is not the one they meant).
4. `set_sheet_sync { artifact_id, file_id: picked.id }`. Confirm with the row count.

The click in Google is theirs and cannot be skipped: ShareOut's access is Google's
`drive.file`, granted only for files the person picks. You can schedule only a file they
already picked; any other `file_id` fails on its first load (and `set_sheet_sync` then removes
the sync and returns the pick link again). The link works in their own browser: signed out,
ShareOut asks them to sign in first and comes back to it. The last page is in English or
Spanish and tells them to come back to the conversation; if nothing was picked it offers
"Pick the spreadsheet again".

## Over REST

```http
POST /v1/workspaces/{ws}/sheet-links/inspect        { "link": "…" }      → { kind, fileName, sheets, sheet, rowCount, columns }
GET  /v1/workspaces/{ws}/file-imports/sheet-sync                          → { available, connected, accountEmail, picked }
GET  /v1/workspaces/{ws}/file-imports/sheet-sync/pick?return=assistant[&file=<id>]   (the person's browser)
POST /v1/jobs        { artifact_id, action, schedule, config, title }      → 201 { job }
POST /v1/jobs/{id}/run                                                     → { execution: { status, error } }
PATCH /v1/jobs/{id}  { config?, schedule? }  ·  DELETE /v1/jobs/{id}
```

Config shapes: [api/jobs.md#publicsheetsyncconfig](../api/jobs.md#publicsheetsyncconfig) and
[api/jobs.md#drivefilesyncconfig](../api/jobs.md#drivefilesyncconfig). Schedules are cron in
**UTC**, one-hour granularity ([api/jobs.md](../api/jobs.md)).

What an API token may do (same as the person it belongs to):

- `public_sheet_sync`: check links, create, run, change and delete syncs on pages it may edit.
  A viewer of the page gets `403`; another workspace cannot check links (`403`).
- `drive_file_sync`: read the status, get the pick link, and create a sync for a file id —
  the run reads only files the job's creator picked in Google, so an unpicked id fails on its
  first run ("has not chosen this spreadsheet…"). Only the creator can point it at another file.
  Picking needs the person in Google's own consent screen; there is no API for it.

### Errors from the link check

| Code | Means | Tell the person |
|---|---|---|
| `NOT_PUBLIC` | Not shared with "Anyone with the link" | The three clicks above, then check again |
| `NOT_FOUND` | Deleted, or the link is incomplete | Copy it again in Google: Share → Copy link |
| `BAD_LINK` | Not a Google spreadsheet link (a folder, a document, a "Publish to the web" link, another site) | Paste the spreadsheet's own share link |
| `NOT_SPREADSHEET`, `TOO_LARGE`, `SHEET_*` | Not readable as a spreadsheet, or too big | The message says what; a smaller file or the right one |
| `RATE_LIMITED` | 60 checks per person per hour | Wait a bit |

## In the page

```js
const sdk = await ShareOut.create();
const ds = sdk.dataset('sales_2026');
const rows = await ds.get();                          // [{ Region: 'North', Sales: 120 }, …]
const { updatedAt } = await ds.metadata();            // when the rows last changed
```

Show it on the page ("Última actualización: hoy 10:32") so the person can see the sync works.
A run that finds nothing changed does not write, so `updatedAt` is the last real change.
