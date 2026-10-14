# REST API: Blobs

File storage endpoints.

## Endpoints

Uploads are a 3-call flow — there is no single `POST .../blobs` endpoint. Prefer
`sdk.blobs` over raw REST (see [sdk/blobs.md](../sdk/blobs.md)); this reference is for
agents writing HTTP directly (server/CLI callers).

```http
POST   /v1/data/{artifactId}/blobs/upload            # 1. Request an upload token + upload URL
PUT    {uploadUrl}                                    # 2. PUT the raw file bytes (see below)
POST   /v1/data/{artifactId}/blobs/{tokenId}/confirm  # 3. Confirm — persists blob metadata
GET    /v1/data/{artifactId}/blobs                    # List blobs
GET    /v1/data/{artifactId}/blobs/{id}               # Get metadata
GET    /v1/data/{artifactId}/blobs/{id}/download-url  # Get a download URL
DELETE /v1/data/{artifactId}/blobs/{id}               # Delete blob
GET    /v1/data/{artifactId}/blobs/storage            # Storage info
```

## POST /blobs/upload (1. Request upload)

**Request:** `application/json` — `{ "filename": "image.png", "mimeType": "image/png", "size": 12345 }`

**Response (non-browser callers — direct-to-R2):**
```json
{
  "success": true,
  "data": {
    "uploadUrl": "https://<r2-presigned-url>",
    "confirmUrl": "/v1/data/art_xxx/blobs/upl_abc123/confirm",
    "tokenId": "upl_abc123",
    "direct": true,
    "expiresAt": "2026-09-19T12:15:00Z",
    "maxSize": 12345
  }
}
```

Browser callers (request carries an `Origin` header) get `direct: false` and an
`uploadUrl` that proxies through the Worker instead
(`/v1/data/{artifactId}/blobs/_upload/{tokenId}`) — R2 doesn't accept CORS PUTs from
a sandboxed artifact's opaque origin. Server callers also get `direct: false` when the
instance has no R2 S3 credentials / `R2_BUCKET` configured. Always branch on `direct`,
never on whether you sent an `Origin`.

## PUT {uploadUrl} (2. Upload bytes)

`PUT` the raw file body (no multipart wrapper) to the `uploadUrl` from step 1. The
token expires in 15 minutes.

- `direct: true` — the PUT goes straight to R2 and returns R2's empty `200`. Call
  `confirm` (step 3) to create the blob.
- `direct: false` — the PUT goes to the Worker, which stores the bytes **and** finalizes
  the blob in one step: it returns `201` with the blob (`id`, `filename`, `mimeType`,
  `sizeBytes`, `createdAt`). `confirm` is not needed (calling it is harmless — see below).

## POST /blobs/{tokenId}/confirm (3. Confirm)

No body. Persists the blob row from the token + the real uploaded size. Returns
`UPLOAD_INCOMPLETE` (400) if nothing was PUT to `uploadUrl` yet. Idempotent: confirming a
token that is already finalized (repeat confirm, or a `direct: false` upload) returns
`200` with the existing blob instead of an error. Status is `201` when this call created it.

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "blob_abc123",
    "filename": "image.png",
    "mimeType": "image/png",
    "sizeBytes": 12345,
    "createdAt": "2026-09-19T12:00:00Z"
  }
}
```

Bytes are always readable at `GET /v1/data/{artifactId}/blobs/{id}/content`.

## GET /blobs (List)

**Query Parameters:**
- `limit` (optional): Max results (default: 100, max 1000)
- `offset` (optional): Pagination offset

**Response:**
```json
{
  "success": true,
  "data": {
    "blobs": [{ "id": "blob_abc123", "filename": "image.png", "mimeType": "image/png", "sizeBytes": 12345, "createdAt": "2026-09-19T12:00:00Z" }],
    "total": 42,
    "limit": 100,
    "offset": 0
  }
}
```

## GET /blobs/{id} (Metadata)

**Response:** same shape as the confirm response above plus `contentUrl`
(`/v1/data/{artifactId}/blobs/{id}/content`).

## GET /blobs/{id}/download-url

**Response:**
```json
{
  "success": true,
  "data": {
    "url": "https://<r2-presigned-url-or-worker-content-url>",
    "direct": true,
    "expiresIn": 300
  }
}
```

`direct: true` is a 5-minute presigned R2 URL; `direct: false` (no R2 S3 credentials on
the instance) returns the Worker `.../content` URL with `expiresIn: null`.

## GET /blobs/storage

**Response:**
```json
{
  "success": true,
  "data": {
    "usedBytes": 5000000,
    "blobCount": 15,
    "maxBytes": 500000000,
    "maxBlobs": 1000,
    "availableBytes": 495000000
  }
}
```

## Limits

| Constraint | Value |
|------------|-------|
| Per artifact | 500MB |
| Per file | 50MB |
| Max blobs | 1000 |

## Allowed MIME Types

- Media: any `image/*`, `video/*` or `audio/*` type
- Documents: `application/pdf`, `application/json`, `text/plain`, `text/csv`, `text/markdown`
- Office / OpenDocument: xlsx, docx, pptx, xls, doc, ppt, ods, odt, odp
- Archives: `application/zip`, `application/x-zip-compressed`, `application/gzip`, `application/x-tar`

Script and executable extensions (`.js`, `.html`, `.py`, `.sh`, `.exe`, …) are always rejected.

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `FILE_TOO_LARGE` | 413 | Exceeds 50MB per file (500MB/file for asset-library buckets) |
| `STORAGE_LIMIT_EXCEEDED` | 413 | Artifact storage full (500MB/artifact, 10GB/bucket for asset libraries) |
| `STORAGE_QUOTA_EXCEEDED` | 507 | Instance-wide storage cap reached — operator setting (`STORAGE_QUOTA_BYTES`), unset by default (unlimited) |
| `BLOB_LIMIT_EXCEEDED` | 400 | Max 1000 blobs per artifact (10,000 for asset-library buckets) |
| `INVALID_TYPE` | 400 | MIME type not allowed |
| `BLOB_NOT_FOUND` | 404 | Blob doesn't exist |
| `UPLOAD_TOKEN_INVALID` / `UPLOAD_TOKEN_EXPIRED` | 400 | The upload token from step 1 is unknown, or its 15-minute window passed — request a new one (an already-finalized token confirms idempotently) |
| `UPLOAD_INCOMPLETE` | 400 | `confirm` was called before the file was PUT to `uploadUrl` |

Blob uploads are bounded by **three** caps, all enforced on upload/confirm: per-file (50MB),
per-artifact (500MB), and the **instance-wide storage quota** shared with datasets and
assets (`STORAGE_QUOTA_BYTES`, unset = unlimited). The tightest one wins.

## Related

- [SDK: Blobs](../sdk/blobs.md) - SDK methods
- [Patterns: Uploads](../patterns/uploads.md) - Upload patterns
