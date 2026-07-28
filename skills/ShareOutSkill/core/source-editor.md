# Source Editor (Markdown, JSON, CSV, TXT)

Non-HTML artifacts have a browser-based **source editor** at `/a/{slug}/edit`. It is separate from the visual HTML studio but shares the same URL pattern and access rules.

> **HTML artifacts** route to the visual studio (Agent / Inspect / Data rail). See [editor.md](editor.md).

## URLs

| URL | Purpose | Access |
|-----|---------|--------|
| `/a/{slug}/edit` | Source editor for `markdown`, `txt`, `json`, `csv` | Owner / editor collaborators (session required) |
| `/a/{slug}/` | Live viewer | Based on visibility |

Unauthenticated requests redirect to Google login with `redirect=/a/{slug}/edit`.

## Supported types

| Type | Default entrypoint | MIME |
|------|-------------------|------|
| `markdown` | `index.md` | `text/markdown` |
| `txt` | `index.txt` | `text/plain` |
| `json` | `index.json` | `application/json` |
| `csv` | `index.csv` | `text/csv` |

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
  "url": "$ORIGIN/a/my-doc/"
}
```

Each publish creates a new artifact version, updates type metadata (row counts, TOC, etc.), and invalidates deployment caches.

**Errors:**

| Code | Status | Cause |
|------|--------|-------|
| `INVALID_REQUEST` | 400 | Missing `content` field |
| `UNSUPPORTED` | 400 | Artifact type is not source-editable (e.g. `html`) |
| `ARTIFACT_NOT_FOUND` | 404 | Slug does not resolve |

## Agent workflow

Agents should continue using `POST /v1/publish` to create or update text artifacts programmatically. The source editor is for human owners editing in the browser.

To update an existing text artifact via API, re-publish with the same `slug` in the same workspace — dedup matches on `display_slug` and versions in place. See [../api/artifacts.md](../api/artifacts.md#slugs-human-vs-routing).

## Related

- [../api/artifact-types.md](../api/artifact-types.md) — type detection, viewers, publish examples
- [editor.md](editor.md) — visual HTML studio
- [../api/artifacts.md](../api/artifacts.md) — publish + serve routes
