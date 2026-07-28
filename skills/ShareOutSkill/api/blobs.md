# REST API: Blobs

File storage endpoints.

## Endpoints

```http
POST   /v1/data/{artifactId}/blobs           # Upload file
GET    /v1/data/{artifactId}/blobs           # List blobs
GET    /v1/data/{artifactId}/blobs/{id}      # Get metadata
GET    /v1/data/{artifactId}/blobs/{id}/url  # Get download URL
DELETE /v1/data/{artifactId}/blobs/{id}      # Delete blob
GET    /v1/data/{artifactId}/blobs/_storage  # Storage info
```

## POST /blobs (Upload)

**Request:** `multipart/form-data`

| Field | Type | Description |
|-------|------|-------------|
| `file` | File | File to upload |
| `filename` | string | Optional filename override |

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "blob_abc123",
    "filename": "image.png",
    "mimeType": "image/png",
    "size": 12345,
    "url": "$ORIGIN/cdn/art_xxx/blob_abc123/image.png",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

## GET /blobs (List)

**Query Parameters:**
- `limit` (optional): Max results (default: 50)
- `offset` (optional): Pagination offset

**Response:**
```json
{
  "success": true,
  "data": {
    "blobs": [...],
    "total": 42,
    "hasMore": true
  }
}
```

## GET /blobs/{id} (Metadata)

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "blob_abc123",
    "filename": "image.png",
    "mimeType": "image/png",
    "size": 12345,
    "url": "$ORIGIN/cdn/...",
    "createdAt": "2024-01-01T00:00:00Z"
  }
}
```

## GET /blobs/_storage

**Response:**
```json
{
  "success": true,
  "data": {
    "used": 5000000,
    "limit": 524288000,
    "blobCount": 15,
    "blobLimit": 1000
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

- Images: `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/svg+xml`
- Video: `video/mp4`, `video/webm`
- Audio: `audio/mpeg`, `audio/wav`, `audio/ogg`
- Documents: `application/pdf`, `text/plain`, `text/csv`, `text/markdown`

## Error Codes

| Code | Status | Description |
|------|--------|-------------|
| `FILE_TOO_LARGE` | 413 | Exceeds 50MB per file, or the plan's per-file cap (Free 25MB) |
| `STORAGE_LIMIT` | 413 | Artifact storage full (500MB/artifact) |
| `STORAGE_QUOTA_EXCEEDED` | 507 | Workspace storage limit reached (Free 50MB · Pro 5GB · Teams 10GB/seat) |
| `BLOB_LIMIT` | 413 | Max 1000 blobs |
| `INVALID_TYPE` | 400 | MIME type not allowed |
| `BLOB_NOT_FOUND` | 404 | Blob doesn't exist |

Blob uploads are bounded by **three** caps, all enforced on upload/confirm: per-file (50MB,
or the plan's per-file cap), per-artifact (500MB), and the **per-workspace storage quota**
shared with datasets and assets. The tightest one wins.

## Related

- [SDK: Blobs](../sdk/blobs.md) - SDK methods
- [Patterns: Uploads](../patterns/uploads.md) - Upload patterns
