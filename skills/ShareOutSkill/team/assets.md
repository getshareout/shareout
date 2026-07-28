# Assets & Deliverables

A per-scope **asset library**: store any file once, reuse it across artifacts by a stable URL, organize in folders, and deliver bundles to clients via a public download link. Surfaced in Home → **Assets**. One hidden bucket per workspace (shared) and one personal bucket (`workspace_id` NULL).

## Why it matters for artifacts

Every asset has a **permanent public URL** — embed it in any number of artifacts (`<img src>`, a download link, an iframe). One source, reused everywhere; swap the file and every page that references it updates. Non-media files (xlsx/pptx/zip/…) serve as downloads (`attachment` + `nosniff`); media (image/video/pdf) inline.

In artifact HTML, prefer **`sdk.files.getUrl('dlv_…')`** for workspace files — it resolves to the latest version and enforces visibility (private files 403 for unauthorized viewers). See [../sdk/files.md](../sdk/files.md).

**Insert from the visual editor:** the editor toolbar has an **Insert asset** button — it opens the library and drops the picked asset (image / video / download link) into the canvas at the selection, using its stable public URL.

## Add files without opening Assets

Files can land in the library from three other channels — each records **provenance** (`blob_origins`) so the workspace assistant can find them later:

| Channel | How | Who |
| --- | --- | --- |
| **Workspace file inbox** | Email attachments to `{workspace-slug}@inbox.example.com` | Workspace members only — sender must be signed up with that email |
| **Chat attach** | Paperclip in the Home **Ask your workspace…** composer | You (uploads to your scope's asset bucket) |
| **Share from phone** | Install ShareOut as a PWA, then **Share → ShareOut** from any app | You — opens Home with the file ready to attach in chat |

The workspace inbox address is in **Admin → Settings → File inbox** (copy with one click). Admins get a bell notification and optional Telegram ping when a member emails files in. Spreadsheets (`.xlsx`, `.csv`), decks (`.pptx`), PDFs, and images are typical payloads.

> **Not the same as a page inbox:** a **page inbox** (`your-page@inbox.example.com`) captures mail *into one artifact* for automations — see [../integrations/inbound-email.md](../integrations/inbound-email.md). The **workspace file inbox** feeds the shared **Assets** library and the AI assistant instead.

## Organize in folders

Use the **folder bar** at the top of Assets to group files — client deliverables, brand assets, raw footage, etc. **New folder** creates a folder in the same shared folder tree your pages use; **Move** on a file tile puts it inside a folder.

Sharing a **folder** with a client (Admin → Sharing) also shares the **files** inside it — folders are one tree for pages and files.

## Visibility

Each file is either **workspace-visible** (default — any member can see and embed it) or **private** (only you, until you share it). Toggle visibility on a file tile. Private files show a small badge.

- **Workspace-visible** files embed in any page via `/v1/files/dlv_…/content`.
- **Private** files are hidden from other members and anonymous delivery links — share deliberately via [external-sharing.md](external-sharing.md) or **Share with a person** (below).

## Versions

Re-upload on a deliverable's **＋** control — each upload becomes **v2**, **v3**, etc. The tile always shows the latest version with a `v3` badge; the history control shows the full version list.

## Comment on a file

Open a file's **comments** control to leave a thread — same comment system as pages, scoped to the file. Workspace members can comment on workspace-visible files; sharees with a **comment** grant can comment on files you shared with them.

## Share with one person (Teams)

On a file tile, **Share with a person** sends a single file to one outside email — no client org required. Pick **View** or **Comment**; they get an invite (if new) and the file appears on their **`/shared`** portal with a comment thread when granted **Comment**. The dialog shows **Shared with** (existing grants) and **Revoke** per person. Returns `409` if that email is already an internal workspace member — use a normal collaborator invite instead.

Folder-level **Share with a person** is available in the Assets lens (folder tile) and via the API (`resource_type: "folder"`). The share dialog lists **who already has access** with per-grant **Revoke** — same for files.

## REST API

All endpoints are membership-authorized; any workspace member may use them. Personal scope drops the `/workspaces/{ws}` prefix.

```
GET    /v1/workspaces/{ws}/assets                      → { deliverables[], loose[], bucketId, usedBytes }
POST   /v1/workspaces/{ws}/assets/upload               { filename, mimeType, size } → { data:{ uploadUrl, tokenId } }
PUT    {uploadUrl}                                     (raw bytes) → { data:{ id: blobId } }
POST   /v1/workspaces/{ws}/assets/deliverables         { blobId, name } → { id }        # new deliverable (v1)
POST   .../assets/deliverables/{id}/version            { blobId } → { versionNo }        # add a version
GET    .../assets/deliverables/{id}/versions           → { versions[] }
DELETE .../assets/deliverables/{id}                                                       # deletes all versions
POST   .../assets/collections                          { name, deliverableIds[] } → { id }
POST   .../assets/collections/{id}/share               { expiresAt?, gate?, password?, domains? } → { url }   # /d/<token>
POST   .../assets/collections/{id}/send                { to, expiresAt?, gate?, password?, domains? } → { url, sent }
GET    /v1/files/{deliverableId}/content               # latest version bytes — session/token; enforces visibility
```

**Gate** (optional): `gate:'password'` + `password`, or `gate:'domain'` + `domains:[...]`. The `/d/<token>` page prompts before revealing files, and the bytes stream through a gated route (`/d/<token>/file/<blobId>`) — a protected delivery's files can't be fetched until the gate is cleared. `gate:'none'` (default) is open. Expiry via `expiresAt` (ISO).

**Manage:** `GET .../assets/links` → every link from the scope (gate, expiry, `viewCount`, revoked/expired). `POST .../assets/links/{linkId}/revoke` kills a link (page + bytes 404).

**Open notify:** the first time a delivery link is opened, the sender gets an email ("…opened your delivery"); deduped on the 0→1 view transition. For a domain-gated link the viewer's email is included.

- **Upload** is two steps: request → `PUT` the bytes to the returned `uploadUrl`. The blob persists on `PUT` (no confirm step).
- A **deliverable** is a named, versioned file. The library lists each deliverable at its latest version (`latestVersion`, `versionCount`).
- A **collection** bundles deliverables; a **share link** (`dlk_*`) renders a public WeTransfer-style page at `/d/<token>` listing each deliverable's latest version. Open link, optional `expiresAt`.

## Limits

Per file 500 MB · per bucket 10 GB · 10 000 files. Any MIME except executable/script file extensions (`.js/.html/.exe/.php/…`), which stay blocked.

## Notes

- The bucket artifact is hidden: it's `public` (so its blobs serve from stable public URLs) but carries no deployment and is excluded from Home and workspace listings, so the bucket "page" is never served — never address it as a page.
- Delivery downloads are gated through `/d/<token>/file/<blobId>`. For embedding across artifacts, use **`sdk.files.getUrl('dlv_…')`** or the per-file **Copy link** (`/v1/files/…/content`); for a *protected* delivery, share the `/d/<token>` link, not the raw content URL.
- Phase-2 (not yet built): runtime `so.assets` list SDK, Slack/Telegram delivery, download-all zip.
