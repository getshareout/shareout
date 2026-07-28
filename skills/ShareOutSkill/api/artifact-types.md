# Artifact Types

ShareOut supports multiple artifact types beyond HTML. Each type auto-detects from MIME/extension and renders with a specialized viewer.

## Supported Types

| Type | Status | SDK Support | Editing |
|------|--------|-------------|---------|
| `html` | Stable | Full SDK, manifest, bindings | Visual studio at `/a/{slug}/edit` |
| `csv` | Stable | View-only | Source editor at `/a/{slug}/edit` |
| `markdown` | Stable | View-only | Source editor at `/a/{slug}/edit` |
| `json` | Stable | View-only | Source editor at `/a/{slug}/edit` |
| `txt` | Stable | View-only | Source editor at `/a/{slug}/edit` |
| `pdf` | Planned | - | - |
| `image` | Planned | - | - |
| `video` | Planned | - | - |

## Type Detection

Priority: explicit `artifact_type` param > MIME type > file extension

### MIME → Type Mapping

```
text/html              → html
text/csv               → csv
text/markdown          → markdown
text/x-markdown        → markdown
application/json       → json
text/plain             → txt
```

### Extension → Type Mapping

```
.html, .htm            → html
.csv                   → csv
.md, .markdown         → markdown
.json                  → json
.txt                   → txt
```

## Publishing Non-HTML Artifacts

### CSV Example

```bash
TOKEN=$(python3 -c "import json,os; print(json.load(open(os.path.expanduser('~/.shareout/credentials')))['token'])")

python3 -c '
import json
print(json.dumps({
  "name": "sales-data",
  "files": [{
    "path": "data.csv",
    "content": "Product,Q1,Q2,Q3,Q4\nWidget A,100,150,200,180\nWidget B,80,90,120,140",
    "mime": "text/csv"
  }]
}))
' | curl -sS -X POST '$ORIGIN/v1/publish' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @-
```

**Response includes artifact type:**
```json
{
  "artifact": { "id": "art_xxx", "type": "csv" },
  "version": { "id": "ver_xxx", "version_no": 1 },
  "deployment": { "url": "$ORIGIN/a/sales-data/" }
}
```

### Markdown Example

```bash
python3 -c '
import json
print(json.dumps({
  "name": "project-docs",
  "files": [{
    "path": "readme.md",
    "content": "# Project Documentation\n\n## Getting Started\n\nInstall dependencies:\n\n```bash\nnpm install\n```\n\n## API Reference\n\nSee `/api` endpoint.",
    "mime": "text/markdown"
  }]
}))
' | curl -sS -X POST '$ORIGIN/v1/publish' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @-
```

### JSON Example

```bash
python3 -c '
import json
print(json.dumps({
  "name": "api-response",
  "files": [{
    "path": "response.json",
    "content": "{\"users\": [{\"id\": 1, \"name\": \"Alice\"}, {\"id\": 2, \"name\": \"Bob\"}], \"meta\": {\"total\": 2}}",
    "mime": "application/json"
  }]
}))
' | curl -sS -X POST '$ORIGIN/v1/publish' \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  --data-binary @-
```

### Explicit Type Override

Force a specific type regardless of MIME/extension:

```json
{
  "name": "my-artifact",
  "artifact_type": "markdown",
  "files": [{
    "path": "content.txt",
    "content": "# Actually Markdown\n\nEven though extension is .txt",
    "mime": "text/plain"
  }]
}
```

## Type-Specific Viewers

### CSV Viewer
- Responsive data grid with sticky headers
- Click column headers to sort (asc/desc)
- Filter rows via search input
- Column type indicators (number, date, boolean, string)
- First 1,000 rows displayed (download for full data)

### Markdown Viewer
- Server-rendered HTML from Markdown
- Table of contents sidebar (generated from headings)
- GFM support: tables, task lists, strikethrough
- Syntax highlighting for code blocks
- Responsive layout

### JSON Viewer
- Collapsible/expandable tree structure
- Expand all / Collapse all controls
- Path display on hover
- Copy path button for each key
- Syntax highlighting

### TXT Viewer
- Line numbers column
- Monospace font
- Character and line count stats
- Clean read-only display

## Type Metadata

Auto-generated during publish, stored in `type_metadata` column.

### CSV Metadata
```json
{
  "hasHeaders": true,
  "delimiter": ",",
  "columns": [
    { "name": "Product", "type": "string" },
    { "name": "Q1", "type": "number" }
  ],
  "rowCount": 100
}
```

### Markdown Metadata
```json
{
  "toc": [
    { "level": 1, "text": "Project Documentation", "anchor": "project-documentation" },
    { "level": 2, "text": "Getting Started", "anchor": "getting-started" }
  ],
  "hasCodeBlocks": true,
  "frontmatter": { "title": "Docs" }
}
```

### JSON Metadata
```json
{
  "schema": "object",
  "rootKeys": ["users", "meta"],
  "isFormatted": true,
  "itemCount": 2
}
```

### TXT Metadata
```json
{
  "lineCount": 50,
  "encoding": "utf-8",
  "charCount": 1234
}
```

## API Response Changes

The `/v1/artifacts/:id` endpoint now returns `artifact_type`:

```json
{
  "id": "art_xxx",
  "name": "sales-data",
  "slug": "sales-data",
  "artifact_type": "csv",
  "visibility": "public",
  ...
}
```

The `/v1/artifacts` list also includes `artifact_type` for each artifact.

## Source Editor (Markdown, JSON, CSV, TXT)

Non-HTML artifacts open a **source editor** at the same URL as the visual studio: `/a/{slug}/edit`. Requires owner or editor role (session required).

| Feature | Behavior |
|---------|----------|
| Types | `markdown`, `txt`, `json`, `csv` |
| Load | `GET /a/{slug}/edit` serves a Monaco-based editor with the current file content |
| Publish | `POST /a/{slug}/edit/source/publish` with `{ "content": "..." }` |
| Versioning | Each publish creates a new version (same as `POST /v1/publish`) |
| Response | `{ "success": true, "versionNo": 2, "url": "$ORIGIN/a/{slug}/" }` |

Agents normally publish via `POST /v1/publish`. The source editor is for human owners editing text artifacts in the browser. Full details: [core/source-editor.md](../core/source-editor.md).

## Backward Compatibility

- Default type is `html` for all existing artifacts
- Existing HTML artifacts work unchanged
- No migration required—type column defaults to `html`
