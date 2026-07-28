---
title: Visual editor (Live Studio)
description: The chat-first WYSIWYG studio for HTML artifacts — layout, modes, draft lifecycle, and what the editor can and cannot infer from your HTML.
---

Every HTML artifact gets a **chat-first WYSIWYG studio** at `/a/{slug}/edit`. It is separate from the live viewer at `/a/{slug}/`. Non-HTML artifacts (Markdown, TXT, JSON, CSV) open the [source editor](/spec/source-editor/) at the same URL instead.

For a plain-English walkthrough aimed at non-technical users, see [The editor](/everyone/the-editor/).

## URLs

| URL | Purpose | Access |
|-----|---------|--------|
| `/a/{slug}/edit` | Visual studio — Agent, Inspect, Data rail | Owner, **named editor** collaborator, or workspace **owner/admin** (session required) |
| `/a/{slug}/` | Live viewer — canonical share URL | Based on artifact visibility |
| `/p/{slug}/` | Live viewer alias (same serve path as `/a/`) | Based on artifact visibility |

Unauthenticated requests to `/a/{slug}/edit` redirect to Google login with `redirect=/a/{slug}/edit`.

## Workspace availability

Live Studio is gated by the **`module.visual_editor`** feature flag per workspace
(default on). When disabled, `/a/{slug}/edit` returns a friendly unavailable page and
edit controls in the home UI are greyed out.

**Who can edit:** the artifact owner (including [linked accounts](/start/authentication/#linked-accounts)),
a collaborator with the **editor** or **owner** role, or a workspace **owner** / **admin**
on the artifact's workspace. Plain workspace **members** still need an explicit editor
collaborator invite — membership alone does not grant edit access.

## Studio layout

The editor renders the artifact HTML in a sandboxed canvas iframe beside a glass **studio rail**:

| Mode / panel | What it does |
|-------------|--------------|
| **Agent** | AI chat that sees the manifest and data model, keeps conversation history, streams prose, and proposes HTML patches (apply / reject) |
| **Inspect** | Select a canvas element; edit style and ShareOut behavior inline — bindings, conditionals, actions, form fields, links/transitions, charts, templates |
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

Canvas edits write real `data-shareout-*` attributes. Changes flow through **undo/redo → autosave draft → collab broadcast**.

The studio chrome is a floating rail beside the canvas with a compact validity pill for
spec warnings. The rail **collapses** to a peek tab; selecting a canvas element auto-switches
to **Inspect** (disabled until something is selected). A persistent agent input strip stays
available across modes.

## Edit-Lite (workspace Home) vs Live Studio

| | **Edit-Lite** (Home tab) | **Live Studio** (`/a/{slug}/edit`) |
| --- | --- | --- |
| **Best for** | Quick text, images, links, blocks | Bindings, data model, collab, full Inspect |
| **Surface** | View/Edit toggle on an artifact tab in [Home](/everyone/your-workspace/) | Dedicated editor URL |
| **Collab** | Single-player draft | Yjs multi-editor |
| **AI** | Rewrite selection in property panel | Full agent with HTML patches |

Same draft/publish API under `/v1/artifacts/{id}/editor/*`; Edit-Lite opens **full editor ↗**
when you need studio tools.

## Editor preview (offline)

The visual editor resolves **all SDK reads from manifest `default` values** — json, tables,
and live connectors (`sources.connections.<name>.default`). There is no live network
fetch or warehouse query in the studio. An artifact that gates its UI behind
`await sdk.table(...).exec()` or `sdk.connection(...).query()` still renders and stays
editable when defaults are declared; a source with no `default` previews empty.

## Why HTML spec compliance matters

The studio reads the artifact's HTML spec — it cannot infer structure. Without compliance, owners see empty Data and Outline panels and no binding autocomplete, even though the published page works fine in the viewer.

| Studio feature | Required declaration |
|----------------|---------------------|
| Data tab sources | `<script type="shareout/manifest">` |
| Binding autocomplete | Manifest `sources` entries |
| Outline navigation | `data-shareout-page`, `data-shareout-section`, tabs |
| Inspect behavior editors | `data-shareout-binding`, `data-shareout-action`, `data-shareout-if`, etc. |
| Template add/remove | `data-shareout-template` |

Verify compliance before publishing: [HTML spec overview](/spec/html-spec/).

## Autosave and draft lifecycle

The studio autosaves edits as a **personal draft** (`artifact_drafts` is keyed by `artifact_id` + `user_id`). Drafts are separate from published versions — the live viewer keeps serving the last published state until someone explicitly publishes from the studio.

What that means in practice:

| Event | What happens |
|-------|----------------|
| You edit and wait ~2s | Your draft autosaves |
| You reload | You load **your** draft (or published HTML if you have none) |
| Collaborator reloads | They load **their** draft — not yours |
| You publish | The HTML on **your** canvas goes live; **your** draft row is cleared; other editors keep their own drafts |
| Two of your tabs save | Optimistic concurrency: `POST /editor/draft` with `baseUpdatedAt` returns **409 `DRAFT_CONFLICT`** if another of your sessions saved first |

Draft concurrency is per-user (your tabs / devices / agent acting as you), not a single shared draft row.

## Collaboration

Multiple editor collaborators can work simultaneously. **Live** edits are broadcast via a Yjs WebSocket (`/editor/ws`) while both sessions are open. That is separate from the personal draft row: after a full page reload, each person sees their own draft again (or published HTML).

When a remote publish or large HTML update arrives while you are dirty, the studio offers keep-mine vs load-theirs — it does not silently overwrite.

Owners bypass the [access policy](/spec/access-policy/) and see all data during authoring. Viewer-role collaborators are subject to the policy.

## Agent (AI)

Agent chat needs an AI key on the Worker (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, or `VERCEL_AI_GATEWAY`). When none is set, Live Studio still opens: Inspect, Data, draft, publish, and collab work; the Agent pane shows a clear “not configured” state instead of failing mid-stream.

Studio canvas preview always uses **manifest `default` values** only — never live warehouse queries (see [Editor preview](#editor-preview-offline)).

## Editor REST API

Agents normally create or update artifacts via `POST /v1/publish`. The studio also exposes authenticated routes under `/v1/artifacts/{id}/editor/*`:

| Route | Purpose |
|-------|---------|
| `GET /editor` | Load editor state (`html`, `draftUpdatedAt`, collaborators, assets, …) |
| `GET /editor/draft` | Fetch current draft |
| `POST /editor/draft` | Save draft (accepts `baseUpdatedAt` for optimistic concurrency) |
| `DELETE /editor/draft` | Discard draft |
| `POST /editor/publish` | Publish from studio |
| `GET /editor/history` | Version history list |
| `POST /editor/rollback` | Roll back to a previous version |
| `POST /editor/upload` | Asset upload |
| `POST /editor/chat/{mode}` | Agent chat (SSE stream) |
| `GET/POST /editor/sdk/{type}/{action}` | SDK config editors (sheets, github, realtime, slides, …) |
| WebSocket `/editor/ws` | Yjs collaboration channel |

## Styling vs. structure

- **`.so-` classes + `shareout.css`** — visual styling, preserved through every save.
- **`data-shareout-*` attributes** — what the studio reads and edits.

These two layers are independent: changing visual styles in Inspect does not alter behavior attributes, and re-publishing updated data does not touch styling.

## Slides and dashboards

The visual studio described here covers **general HTML artifacts**. Slides and dashboards modules use their own editor/published artifact pair (`/a/` editor + `/p/` published viewer). See the [slides](/slides/) and [dashboards](/dashboards/) sections.

## Related

- [The editor](/everyone/the-editor/) — non-technical walkthrough
- [Source editor](/spec/source-editor/) — Markdown, CSV, JSON, TXT
- [Access policy](/spec/access-policy/) — per-viewer row filtering
