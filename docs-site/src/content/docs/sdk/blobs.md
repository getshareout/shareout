---
title: Blobs (files)
description: Upload and serve files, direct from R2.
---

import { Aside } from '@astrojs/starlight/components';

Upload and serve files. Access via `sdk.blobs`.

## Methods

```typescript
upload(file, { filename?, mimeType? }): Promise<BlobInfo>
get(id): Promise<BlobInfo | null>
getDownloadUrl(id): Promise<string>   // short-lived, direct from R2 — preferred
getUrl(id): string                     // Worker-proxied, long-lived
delete(id): Promise<boolean>
list({ limit?, offset? }): Promise<BlobListResult>
storage(): Promise<StorageInfo>
```

## Examples

```javascript
const file = document.querySelector('input[type=file]').files[0];
const blob = await sdk.blobs.upload(file);

// Large media — get a fresh signed URL each time you need it
imgEl.src = await sdk.blobs.getDownloadUrl(blob.id);

const { used, limit } = await sdk.blobs.storage();
```

<Aside type="tip" title="Upload path vs download path">
**Browser uploads** (inside a published artifact or the visual editor) go through the
Worker's `_upload` proxy — sandboxed iframes send `Origin: null`, which R2 CORS cannot
serve, so direct presigned PUT fails from the browser. The Worker authenticates and
streams bytes to R2.

**Downloads** still prefer direct R2: call `getDownloadUrl()` for a short-lived signed
URL (~5 min). `<img>` and similar tags do not need CORS, so this path stays fast.

**Server/CLI callers** (no `Origin` header) keep the direct-to-R2 presigned upload path.
Blobs are private to the artifact.
</Aside>

## Limits & types

| Constraint | Value |
| --- | --- |
| Per file | 50 MB |
| Per artifact | 500 MB |
| Max blobs | 1000 |
| Instance total storage | `STORAGE_QUOTA_BYTES` (0 / unset = unlimited) |

Uploads are bounded by all of these — the tightest wins. Instance total storage is shared
with datasets and assets; exceeding it returns `STORAGE_QUOTA_EXCEEDED` (507), an over-cap
file returns `FILE_TOO_LARGE` (413).

Allowed: images (PNG/JPEG/GIF/WebP/SVG), video (MP4/WebM), audio (MP3/WAV/OGG),
PDF, TXT, CSV, Markdown.

## Manifest

```html
<script type="shareout/manifest">
{ "version": "2.0", "sources": { "blobs": ["logo.png", "document.pdf"] } }
</script>
```

REST equivalents: [Blobs API](/api/operations/uploadblob/).
