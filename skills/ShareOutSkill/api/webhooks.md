# REST API: Webhooks

Webhook payloads for artifact events.

## Webhook Delivery

Webhooks are delivered via HTTP POST with JSON body. Configure via [Jobs API](jobs.md) or artifact settings.

## Event Types

| Event | Trigger |
|-------|---------|
| `artifact.published` | Artifact version published |
| `artifact.updated` | Artifact metadata updated |
| `artifact.deleted` | Artifact deleted |
| `data.changed` | JSON/table data changed |
| `job.executed` | Scheduled job ran |
| `job.failed` | Scheduled job failed |

## Payload Format

```typescript
interface WebhookPayload {
  event: string;
  artifact_id: string;
  timestamp: string;
  data: EventData;
}
```

## Event Payloads

### artifact.published

```json
{
  "event": "artifact.published",
  "artifact_id": "art_abc123",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "version_id": "ver_xyz789",
    "version_no": 5,
    "slug": "my-app",
    "url": "$ORIGIN/a/my-app/"
  }
}
```

### data.changed

```json
{
  "event": "data.changed",
  "artifact_id": "art_abc123",
  "timestamp": "2024-01-01T00:00:00Z",
  "data": {
    "type": "table",
    "name": "tasks",
    "operation": "insert",
    "count": 1
  }
}
```

### job.executed

```json
{
  "event": "job.executed",
  "artifact_id": "art_abc123",
  "timestamp": "2024-01-01T09:00:00Z",
  "data": {
    "job_id": "job_xyz789",
    "action": "email",
    "status": "success",
    "duration_ms": 1234
  }
}
```

### job.failed

```json
{
  "event": "job.failed",
  "artifact_id": "art_abc123",
  "timestamp": "2024-01-01T09:00:00Z",
  "data": {
    "job_id": "job_xyz789",
    "action": "email",
    "error": "Rate limit exceeded",
    "code": "RATE_LIMITED"
  }
}
```

## Headers

| Header | Description |
|--------|-------------|
| `Content-Type` | `application/json` |
| `X-ShareOut-Event` | Event type |
| `X-ShareOut-Signature` | HMAC-SHA256 signature |
| `X-ShareOut-Delivery-Id` | Unique delivery ID |

## Signature Verification

```javascript
const crypto = require('crypto');

function verifySignature(payload, signature, secret) {
  const expected = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}
```

## Retry Policy

| Attempt | Delay |
|---------|-------|
| 1 | Immediate |
| 2 | 1 minute |
| 3 | 5 minutes |
| 4 | 30 minutes |
| 5 | 2 hours |

Webhooks are retried on 5xx errors or timeouts. 4xx errors are not retried.

## Related

- [Jobs](jobs.md) - Create webhook jobs
- [Overview](overview.md) - API intro
