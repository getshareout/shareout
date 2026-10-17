# Import folders from Google Drive / OneDrive / SharePoint

Copy a whole remote folder (with subfolders) into workspace files, keep it in sync, and turn documents into pages. Human guide: docs-site **Teams → Bring your files from Drive / SharePoint**.

## Who and what

- Workspace `owner` / `admin`, and internal `member` while `members_can_create_folders` is on. External members get `403 IMPORT_NOT_ALLOWED` / `FORBIDDEN`.
- The drive consent is **per member and workspace**, read-only, and separate from login. It can only be given in a browser (OAuth popup) — an agent cannot connect a drive for someone. Tokens never come back in any response.
- Only providers the instance configured appear in `GET …/file-imports` → `providers`. Empty list = feature off.

## API (session or token auth; `{ws}` = workspace id)

| Do | Call |
|---|---|
| Overview: providers, my connections, imported folders + last run | `GET /v1/workspaces/{ws}/file-imports` |
| Browse folders (needs my connection) | `GET /v1/workspaces/{ws}/file-imports/browse/{google_drive\|microsoft}?ref=root[&q=site search]` |
| Import a folder (starts a run) | `POST /v1/workspaces/{ws}/file-imports/sources` `{ provider, ref, name, targetFolderId?, convert?, dailySync? }` |
| Sync again (only changed files) | `POST /v1/workspaces/{ws}/file-imports/sources/{id}/sync` → `202 { run }`, `409 RUN_IN_PROGRESS` |
| Daily sync on/off, conversion on/off | `PATCH /v1/workspaces/{ws}/file-imports/sources/{id}` `{ dailySync?, convert? }` (max 10 daily per workspace) |
| Progress + per-file problems | `GET /v1/workspaces/{ws}/file-imports/runs/{runId}` |
| Stop syncing (files stay) | `DELETE /v1/workspaces/{ws}/file-imports/sources/{id}` |
| Disconnect my drive (stops every sync through it) | `DELETE /v1/workspaces/{ws}/file-imports/connections/{provider}` |

`ref` is opaque: take it from a browse entry with `selectable: true`.

## Run results

`run.status`: `queued` → `walking` → `importing` → `done` | `stopped` | `failed`. `run.counts`: `found`, `imported`, `converted` (pages), `unchanged`, `skipped`, `failed`. `run.errors[]`: `{ path, status, code, message }`.

| `stopCode` | Meaning / what to tell the person |
|---|---|
| `STORAGE_QUOTA_EXCEEDED` | Storage full; stopped cleanly. Free space, then sync again. |
| `CONNECTION_REVOKED` | Drive disconnected or consent expired. Reconnect in the UI. |
| `RATE_LIMITED` | Drive kept throttling; sync again in a few minutes. |
| `WALK_LIMIT` (on a `done` run) | Over 10,000 files / 2,000 folders / 20 levels; import the rest as smaller folders. |
| `NOT_ALLOWED` | The person who connected lost import rights. |

Per-file `code`: `NOT_EXPORTABLE` (Forms, Sites, OneNote…), `BLOCKED_TYPE` (scripts/HTML/programs), `FILE_TOO_LARGE`, `EXPORT_TOO_LARGE` (Google Docs over 10 MB), `DOWNLOAD_RESTRICTED`, plus conversion warnings on imported files.

## Behaviour to rely on

- Google Docs/Sheets/Slides → `.docx`/`.xlsx`/`.pptx`; Drawings → PDF.
- Files take the target folder's visibility (private → `private`, public → `workspace` link, else `team`). Pages are `private` or `workspace`, never public.
- A changed file becomes a new version of the same file (and page). Deleted remote files are kept.
- With Knowledge on, imported files are learned like uploads.
