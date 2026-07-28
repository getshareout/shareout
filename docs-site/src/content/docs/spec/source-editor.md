---
title: Source editor
description: Browser-based editor for Markdown, TXT, JSON, and CSV artifacts — publish endpoint, supported types, and agent workflow.
---

Non-HTML artifacts have a browser-based **source editor** at `/a/{slug}/edit`. It shares the same URL pattern and access rules as the [visual studio](/spec/editor/) but opens instead of it when the artifact type is `markdown`, `txt`, `json`, or `csv`.

## URLs

| URL | Purpose | Access |
|-----|---------|--------|
| `/a/{slug}/edit` | Source editor | Owner and editor collaborators (session required) |
| `/a/{slug}/` | Live viewer | Based on artifact visibility |

Unauthenticated requests redirect to Google login with `redirect=/a/{slug}/edit`.

## Supported types

| Type | Default entry point | MIME |
|------|---------------------|------|
| `markdown` | `index.md` | `text/markdown` |
| `txt` | `index.txt` | `text/plain` |
| `json` | `index.json` | `application/json` |
| `csv` | `index.csv` | `text/csv` |

HTML artifacts route to the visual studio instead. Sending an HTML artifact's slug to `/edit` opens the visual studio, not this editor.

## Publish from the editor

```http
POST /a/{slug}/edit/source/publish
Content-Type: application/json
Cookie: shareout_session=…

{ "content": "# Updated doc\n\nNew content here." }
```

**Response (200):**

```json
{
  "success": true,
  "versionNo": 3,
  "url": "https://shareout.site/a/my-doc/"
}
```

Each publish creates a new artifact version, updates type metadata (row counts, table of contents, etc.), and invalidates deployment caches.

**Errors:**

| Code | Status | Cause |
|------|--------|-------|
| `INVALID_REQUEST` | 400 | Missing `content` field |
| `UNSUPPORTED` | 400 | Artifact type is not source-editable (e.g. `html`) |
| `ARTIFACT_NOT_FOUND` | 404 | Slug does not resolve |

## Agent workflow

Agents should use `POST /v1/publish` to create or update text artifacts programmatically — not the source editor endpoint. The source editor is for human owners editing in the browser.

To update an existing text artifact via the API, re-publish with the same `slug` in the same workspace. Dedup matches on `display_slug` and versions in place.

## Related

- [Visual editor](/spec/editor/) — HTML artifact studio
- [Access policy](/spec/access-policy/) — per-viewer row filtering
