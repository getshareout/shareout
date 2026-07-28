# SDK: Blobs (File Storage)

File uploads and CDN serving. Access via `sdk.blobs`.

## Methods

```typescript
// Upload file
upload(file: File | Blob, options?: { filename?: string; mimeType?: string }): Promise<BlobInfo>

// Get metadata
get(id: string): Promise<BlobInfo | null>

// Worker-proxied content URL (synchronous; streams through the Worker)
getUrl(id: string): string

// Short-lived URL that downloads DIRECTLY from R2 (bytes bypass the Worker) — preferred
getDownloadUrl(id: string): Promise<string>

// Delete blob
delete(id: string): Promise<boolean>

// List blobs
list(options?: { limit?: number; offset?: number }): Promise<BlobListResult>

// Check storage usage
storage(): Promise<StorageInfo>
```

## Egress: downloads prefer direct R2; browser uploads go through the Worker

Blobs are **private to the artifact**: auth is enforced before any URL is signed, and
signed URLs expire (~5 min download / ~15 min upload).

**Uploads from the browser** (artifact iframe, `Origin` header present) route through a
**Worker-proxied** upload URL so CORS works in the sandbox (`Origin: null` cannot
presign-PUT to R2). The SDK sends `Authorization: Bearer …` on that proxied PUT. Server/
CLI callers without an `Origin` header still use presigned PUT straight to R2 when configured.

- `upload()` picks the right path automatically — just `await sdk.blobs.upload(file)`.
- For downloads, prefer `getDownloadUrl(id)` (direct from R2 when available). Because it is presigned
  and short-lived, call it when you need the URL rather than caching it:

```javascript
// Large media / files — direct from R2
const url = await sdk.blobs.getDownloadUrl(blob.id);
imgEl.src = url;             // or: const res = await fetch(url)

// getUrl() still works (Worker-proxied) for simple, long-lived <img src> cases
```

`getDownloadUrl()` and `getUrl()` fall back to the Worker-proxied path automatically when
direct R2 serving isn't configured, so your code works in every environment.

## Types

```typescript
interface BlobInfo {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: string;
}

interface StorageInfo {
  used: number;      // bytes
  limit: number;     // bytes
  blobCount: number;
  blobLimit: number;
}
```

## Limits

| Constraint | Value |
|------------|-------|
| Per artifact | 500MB |
| Per file | 50MB |
| Max blobs | 1000 |

## Allowed Types

Images, video, audio, PDF, TXT, CSV, Markdown.

## Examples

```javascript
// Upload file
const input = document.querySelector('input[type="file"]');
const file = input.files[0];
const blob = await sdk.blobs.upload(file);
console.log(blob.url); // CDN URL

// List uploads
const { blobs, total } = await sdk.blobs.list({ limit: 20 });

// Get storage
const { usedBytes, limit } = await sdk.blobs.getStorageUsage();
console.log(`${usedBytes / 1e6} MB of ${limit / 1e6} MB used`);

// Delete
await sdk.blobs.delete(blob.id);
```

## Manifest Declaration

Declare each blob name in your manifest (see [overview.md](overview.md#manifest-declaration)):

```json
"blobs": ["logo.png", "document.pdf"]
```

## Files: reference a workspace file across artifacts

Blobs are scoped to one artifact. **Files** (workspace-level deliverables, id `dlv_…`,
uploaded in Home → Files) can be referenced from *any* artifact by their stable id:

```js
// Embed a workspace file (logo, dataset, PDF) that lives outside this artifact:
img.src = so.files.getUrl('dlv_abc123');   // → /v1/files/dlv_abc123/content (latest version)
```

- The URL is deliverable-keyed and always resolves to the **latest version** — re-uploading
  a new version updates every artifact that embeds it (no re-publish).
- **Visibility is enforced**: a *workspace* file is embeddable for any viewer; a *private*
  file serves only to an authorized viewer (owner or someone it was shared with) and 403s
  otherwise — so private files are not suitable for embedding in a shared artifact.

### File intelligence, metadata, and usage (work/042 P4)

- **AI enrichment**: every uploaded File is auto-summarized in the background — a one-line
  summary + tags are extracted (from xlsx/pptx/csv/txt/md/json; binaries/PDF/images are
  marked `unsupported`). Surfaced in the Files lens and returned by the metadata endpoint.
- **Metadata endpoint**: `GET /v1/files/{dlv}` → `{ name, filename, mimeType, sizeBytes,
  visibility, version, versionCount, contentUrl, enrichment, usedIn }`. Same access rule as
  content (a private file's metadata is owner/grantee-only).
- **Usage graph**: `enrichment.usedIn` / the metadata `usedIn` array lists the artifacts that
  reference this File (populated at publish time by scanning for `so.files.getUrl('dlv_…')` /
  `/v1/files/dlv_…/content`). The lens shows "Used in A, B, C".
- **Crew tools**: a crew can call `file_list` (browse the workspace library with summaries)
  and `file_read` (read a file's extracted text + AI summary by id).
- **Scheduled delivery**: a scheduled job with action `asset_delivery`
  (`{ collectionId, recipients[], expiresDays? }`) emails a file-collection download link on
  a schedule.

## Related

- [files.md](files.md) — workspace files (`sdk.files`, `dlv_*`) across artifacts
- [Patterns: Uploads](../patterns/uploads.md) - Upload UI patterns
- [REST API: Blobs](../api/blobs.md) - REST endpoints
