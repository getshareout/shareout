# Visual Editor (Live Studio)

The shipped visual editor is a **chat-first WYSIWYG studio** at `/a/{slug}/edit`. It is separate from the live viewer at `/a/{slug}/`.

> **Non-HTML artifacts** (`markdown`, `txt`, `json`, `csv`) open the **source editor** at the same `/a/{slug}/edit` URL instead. See [source-editor.md](source-editor.md).

> **Not the slides/dashboards dual-artifact model.** Slides and dashboards modules use their own editor/published artifact pair (`/a/` + `/p/`). This page covers **Live Studio**, the editor every HTML artifact gets.

## URLs

| URL | Purpose | Access |
|-----|---------|--------|
| `/a/{slug}/edit` | Live Studio — Agent, Inspect, Data rail | Owner (incl. [linked accounts](../auth.md#linked-accounts)), **named editor** collaborator, or workspace **owner/admin** (session required) |
| `/a/{slug}/` | Live viewer — canonical share URL returned by `POST /v1/publish` | Based on visibility |
| `/p/{slug}/` | Live viewer alias (same serve path as `/a/`) | Based on visibility |

Unauthenticated requests to `/a/{slug}/edit` redirect to Google login with `redirect=/a/{slug}/edit`.

## Access & feature gating

**Editor role is explicit.** Opening Live Studio requires artifact **owner** (including [linked accounts](../auth.md#linked-accounts)), **editor** collaborator status, or workspace **owner/admin** on the artifact's workspace. Plain workspace **members** still need an explicit editor invite — membership alone does **not** grant edit access, even when `visibility: "workspace"` lets every member **view** the live page. Add editors with `POST /v1/artifacts/{id}/collaborators` or `sdk.collaborators.add(…, 'editor')`. Use `sdk.me().canEdit` inside the artifact to gate UI controls.

**Live Studio can be turned off per workspace** via feature flag `module.visual_editor` (see [api/features.md](../api/features.md)). When disabled, `/a/{slug}/edit` returns a friendly 403 for HTML artifacts; the **source editor** for `markdown` / `txt` / `json` / `csv` is unaffected. Check `GET /v1/features?workspace_id=…` before assuming Live Studio is available.

## Live Studio layout

The editor renders the artifact HTML in a sandboxed canvas iframe beside a glass **studio rail**:

| Mode / panel | What it does |
|-------------|--------------|
| **Agent** | AI chat that sees the manifest + data model, keeps conversation history, streams prose, and proposes HTML patches (apply/reject) |
| **Inspect** | Select a canvas element; edit style and ShareOut behavior inline (bindings, conditionals, actions, form fields, links/transitions, charts, templates) |
| **Data** | Manifest data model (sources / tables / json), live row counts, inline JSON CRUD |

**Footer panels** (open from the toolbar; share one glass surface with the rail):

| Panel | What it does |
| --- | --- |
| **Outline** | Document structure (pages, sections, tabs) |
| **Details** | Rename, visibility, collaborators, delete |
| **Validation** | HTML spec compliance check (same rules as publish-time `editor_readiness`) |
| **Version history** | Browse and roll back to previous publishes |
| **Share** | Copy link, embed code |
| **Connect** | Workspace data connectors; add REST connections from the UI |
| **Metrics & alerts** | Followable metrics and threshold rules for this artifact |
| **Inbox** | Inbound email captured by this artifact |

The studio chrome is a **floating rail** beside the canvas with a compact **validity pill** for spec warnings. The rail **collapses** to a peek tab; selecting a canvas element auto-switches to **Inspect** (disabled until something is selected). A persistent agent input strip stays available across modes.

**Toolbar — Insert asset:** the studio toolbar has an **Insert asset** button that opens the workspace/personal asset library picker. Pick a file to drop an image, video, or download link into the canvas at the selection, using the asset's stable public URL. See [../team/assets.md](../team/assets.md).

Canvas edits write real `data-shareout-*` attributes. Changes flow through **undo/redo → autosave draft → collab broadcast**.

## Edit-Lite (workspace Home) vs Live Studio

| | **Edit-Lite** (Home tab) | **Live Studio** (`/a/{slug}/edit`) |
| --- | --- | --- |
| **Best for** | Quick text, images, links, blocks | Bindings, data model, collab, full Inspect |
| **Surface** | View/Edit toggle on an artifact tab in [workspace Home](workspace-home.md) | Dedicated editor URL |
| **Collab** | Single-player draft | Yjs multi-editor |
| **AI** | Rewrite selection in property panel | Full agent with HTML patches |

Same draft/publish API under `/v1/artifacts/{id}/editor/*`; Edit-Lite opens **full editor ↗** when you need studio tools.

## Editor preview (offline)

The visual editor resolves **all SDK reads from manifest `default` values** — json, tables, and live connectors (`sources.connections.<name>.default`). There is no live network fetch or warehouse query in Live Studio. An artifact that gates its UI behind `await sdk.table(...).exec()` or `sdk.connection(...).query()` still renders and stays editable when defaults are declared; a source with no `default` previews empty. See [html-spec/manifest.md](html-spec/manifest.md#connection-sources).

## Why HTML spec compliance matters

Live Studio reads the HTML spec — it cannot infer structure. Without compliance, owners see empty Data/Outline panels and no binding autocomplete even though the published page works.

**Before publishing, verify:** [html-spec/overview.md](html-spec/overview.md) compliance checklist.

| Studio feature | Required declaration |
|----------------|---------------------|
| Data tab sources | `<script type="shareout/manifest">` |
| Binding autocomplete | Manifest `sources` |
| Outline navigation | `data-shareout-page`, `data-shareout-section`, tabs |
| Inspect behavior editors | `data-shareout-binding`, `data-shareout-action`, `data-shareout-if`, etc. |
| Template add/remove | `data-shareout-template` |

Full attribute reference: [html-spec/overview.md](html-spec/overview.md#attribute-quick-reference).

## Editor REST API (optional)

### Insert asset

The toolbar **Insert asset** picker lists files from the signed-in scope's asset library (`GET /v1/assets` or `GET /v1/workspaces/{ws}/assets`). Agents building HTML can reference the same stable URLs from the list response — there is no `so.assets` SDK for anonymous viewers yet. See [../team/assets.md](../team/assets.md).

Agents normally publish via `POST /v1/publish`. Live Studio also exposes authenticated routes under `/v1/artifacts/{id}/editor/*`:

| Route | Purpose |
|-------|---------|
| `GET /editor` | Load editor state (`html`, `draftUpdatedAt`, collaborators, assets, …) |
| `GET/POST/DELETE /editor/draft` | Autosaved draft |
| `POST /editor/publish` | Publish from Live Studio |
| `GET /editor/history`, `POST /editor/rollback` | Version history |
| `POST /editor/upload` | Asset upload |
| `POST /editor/chat/{mode}` | Agent chat (SSE) |
| `GET/POST /editor/sdk/{type}/{action}` | SDK config editors (sheets, github, realtime, slides, …) |
| WebSocket `/editor/ws` | Yjs collaboration |

### Draft optimistic concurrency

`POST /editor/draft` accepts `baseUpdatedAt` from the last load. A stale value returns **409 `DRAFT_CONFLICT`** instead of overwriting a save made in another tab or by a collaborator.

## Styling vs structure

- **`.so-` classes + `shareout.css`** → visual styling (preserved through every save)
- **`data-shareout-*` attributes** → what Live Studio reads and edits

See [modules/ui/overview.md](../modules/ui/overview.md#works-with-the-live-editor).

## Related

- [workspace-home.md](workspace-home.md) — Home layout, Inspector, Edit-Lite quick edit
- [modules/_shared/publishing.md](../modules/_shared/publishing.md) — share URLs, visibility, link previews
- [core/html-spec/overview.md](html-spec/overview.md) — mandatory artifact spec
- [api/artifacts.md](../api/artifacts.md) — publish + serve routes
