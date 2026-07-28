# Google Sheets Integration - Technical Documentation

## Overview

ShareOut provides Google Sheets integration as a **provider** within the Data Platform Engine. This allows published HTML artifacts to read from and write to Google Sheets with a unified connection management system.

**Key Features:**
- Provider-based architecture via Data Platform Engine
- Hybrid execution: Direct mode (browser) or Proxy mode (server)
- Named connections with encrypted credential storage
- Two-layer caching (memory + persisted)
- Automatic token refresh
- Per-connection rate limiting

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User's Browser                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  Published Artifact (HTML)                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ShareOut SDK - PlatformStore                                    │    │
│  │  - sdk.platform.connect('google-sheets', {...})                  │    │
│  │  - sdk.platform.execute('google-sheets', 'values.get', {...})    │    │
│  │  - sdk.platform.execute('google-sheets', 'values.update', {...}) │    │
│  │  - sdk.platform.execute('google-sheets', 'values.append', {...}) │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                              │
     ┌────────────────────────┼────────────────────────┐
     │ Direct Mode            │ Proxy Mode             │
     │ (CORS-enabled)         │ (Server-proxied)       │
     ▼                        ▼
┌─────────┐            ┌─────────────────────────────────────────┐
│ Google  │            │  ShareOut Worker                        │
│ Sheets  │            │  └─ Data Platform Engine                │
│ API     │            │      ├─ Google Sheets Provider          │
└─────────┘            │      ├─ Two-layer Cache                 │
                       │      ├─ Rate Limiter                    │
                       │      └─ Credential Manager              │
                       ├─────────────────────────────────────────┤
                       │  ┌─────────────────┐  ┌───────────────┐ │
                       │  │  D1 Database    │  │  Credentials  │ │
                       │  │  - Connections  │  │  Key (env)    │ │
                       │  │  - Cache        │  │  - AES-GCM    │ │
                       │  └─────────────────┘  └───────────────┘ │
                       └─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Google Sheets API                                 │
│  https://sheets.googleapis.com/v4/spreadsheets                           │
│  - Scope: https://www.googleapis.com/auth/spreadsheets (read/write)      │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Connection Flow

### Creating a Google Sheets Connection

```
1. User clicks "Connect Google Sheets" button
   │
   ▼
2. SDK calls GET /v1/data/{artifactId}/platform/google-sheets/auth-url
   │
   ▼
3. Provider generates OAuth URL with state parameter:
   {
     provider: "google-sheets",
     artifactId: "art_xxx",
     connectionName: "my-sheets",
     returnUrl: "...",
     ts: 1234567890
   }
   │
   ▼
4. SDK opens popup window to Google OAuth
   │
   ▼
5. User signs into Google, grants permission
   │
   ▼
6. Google redirects to /platform/google-sheets/callback with code
   │
   ▼
7. Provider exchanges code for tokens:
   - access_token (1 hour TTL)
   - refresh_token (long-lived)
   │
   ▼
8. Tokens encrypted with AES-GCM and stored in connections (scope_type='artifact', kind='platform')
   │
   ▼
9. Callback page sends postMessage to parent window
   │
   ▼
10. SDK receives message, resolves connect() promise
```

### Connection Storage Schema

```sql
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,   -- 'artifact' | 'workspace'
  scope_id TEXT NOT NULL,
  name TEXT NOT NULL,                   -- User-defined connection name
  provider TEXT NOT NULL,               -- 'google-sheets'
  config TEXT NOT NULL,                 -- JSON: provider-specific config
  encrypted_credentials TEXT,           -- AES-GCM encrypted tokens
  iv TEXT,                              -- Initialization vector
  preferred_mode TEXT,                  -- 'direct' | 'proxy' | 'auto'
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(artifact_id, name)
);
```

### Token Refresh

When executing a request with an expired token:

```typescript
1. Fetch connection from DB
2. Decrypt credentials
3. Check if access_token is still valid (expires_at > now + 60s buffer)
   ├── Valid → Use access_token
   └── Expired →
       a. Call provider.refreshToken() with refresh_token
       b. Receive new access_token
       c. Encrypt and store new credentials
       d. Use new access_token
```

---

## Caching Layer

### Two-Layer Cache Architecture

The Data Platform Engine uses a two-layer caching strategy:

```
Request → Check Memory Cache
           ├─ HIT → Return immediately
           └─ MISS → Check Persisted Cache (artifact_json)
                      ├─ HIT → Hydrate memory, return
                      └─ MISS → Fetch from Google Sheets, cache both
```

### Cache Key Format

```
Cache Key: {provider}:{endpoint}:{queryHash}

Example: google-sheets:values.get:a1b2c3d4
```

### Cache Entry Structure

```json
{
  "data": {
    "values": [["Name", "Sales"], ["Alice", 100]],
    "range": "Sheet1!A1:B2",
    "majorDimension": "ROWS"
  },
  "meta": {
    "cachedAt": "2024-01-15T10:00:00Z",
    "ttlSeconds": 300
  }
}
```

### Cache Configuration

From the Google Sheets provider config:

```typescript
cache: {
  defaultTtlSeconds: 300,      // 5 minutes
  maxTtlSeconds: 3600,         // 1 hour max
  persistable: true,           // Store in artifact_json
  userRefreshable: true,       // Users can trigger cache refresh
}
```

### Cache Invalidation

- **Write operations:** `values.update` and `values.append` invalidate related cache entries
- **Manual refresh:** `POST /platform/cache/refresh` with endpoint filter
- **TTL expiry:** Automatic on read when TTL exceeded

---

## API Endpoints

All endpoints are under `/v1/data/{artifactId}/platform/`.

### Connection Management

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/platform/connections` | GET | Owner | List all connections |
| `/platform/connections` | POST | Owner | Create connection |
| `/platform/connections/{name}` | GET | Owner | Get connection details |
| `/platform/connections/{name}` | DELETE | Owner | Delete connection |

### Google Sheets Provider

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/platform/google-sheets` | GET | None | Get provider config & endpoints |
| `/platform/google-sheets/auth-url` | GET | Owner | Get OAuth URL |
| `/platform/google-sheets/callback` | GET | None | OAuth callback handler |
| `/platform/google-sheets/prepare` | POST | Owner | Get credentials for direct mode |
| `/platform/google-sheets/{endpoint}/execute` | POST | Varies | Execute API request |

### Available Endpoints (via execute)

| Endpoint ID | Method | Auth | Description |
|-------------|--------|------|-------------|
| `values.get` | POST | None | Read values from range |
| `values.update` | POST | Owner | Update values in range |
| `values.append` | POST | Owner | Append rows to sheet |
| `spreadsheet.get` | POST | None | Get spreadsheet metadata |

### Cache Management

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/platform/cache/status` | GET | None | Get cache statistics |
| `/platform/cache/refresh` | POST | Owner | Invalidate cache |

---

## Request/Response Examples

### Read Values

**Request:**
```http
POST /v1/data/art_abc123/platform/google-sheets/values.get/execute
Content-Type: application/json

{
  "connectionId": "conn_xxx",
  "params": {
    "pathParams": {
      "spreadsheetId": "1ABC...",
      "range": "Sheet1!A1:B10"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "range": "Sheet1!A1:B10",
    "majorDimension": "ROWS",
    "values": [
      ["Name", "Sales"],
      ["Alice", 100],
      ["Bob", 150]
    ]
  },
  "meta": {
    "provider": "google-sheets",
    "endpoint": "values.get",
    "executionMode": "proxy",
    "cached": true,
    "executionTimeMs": 12
  }
}
```

### Update Values

**Request:**
```http
POST /v1/data/art_abc123/platform/google-sheets/values.update/execute
Authorization: Bearer so_xxx
Content-Type: application/json

{
  "connectionId": "conn_xxx",
  "params": {
    "pathParams": {
      "spreadsheetId": "1ABC...",
      "range": "Sheet1!A2:B3"
    },
    "body": {
      "values": [
        ["Alice", 150],
        ["Bob", 200]
      ]
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "spreadsheetId": "1ABC...",
    "updatedRange": "Sheet1!A2:B3",
    "updatedRows": 2,
    "updatedColumns": 2,
    "updatedCells": 4
  },
  "meta": {
    "provider": "google-sheets",
    "endpoint": "values.update",
    "executionMode": "proxy",
    "cached": false,
    "executionTimeMs": 234
  }
}
```

### Append Rows

**Request:**
```http
POST /v1/data/art_abc123/platform/google-sheets/values.append/execute
Authorization: Bearer so_xxx
Content-Type: application/json

{
  "connectionId": "conn_xxx",
  "params": {
    "pathParams": {
      "spreadsheetId": "1ABC...",
      "range": "Sheet1"
    },
    "body": {
      "values": [
        ["Charlie", 175],
        ["Diana", 225]
      ]
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "spreadsheetId": "1ABC...",
    "tableRange": "Sheet1!A1:B3",
    "updates": {
      "updatedRange": "Sheet1!A4:B5",
      "updatedRows": 2,
      "updatedColumns": 2,
      "updatedCells": 4
    }
  },
  "meta": {
    "provider": "google-sheets",
    "endpoint": "values.append",
    "executionMode": "proxy",
    "cached": false,
    "executionTimeMs": 189
  }
}
```

---

## SDK Reference

### PlatformStore API for Google Sheets

```typescript
// Access via sdk.platform
const platform = sdk.platform;

// Connection management
await platform.connect('google-sheets', {
  name: 'my-sheets',
  config: { /* provider-specific */ }
});

await platform.getConnections();
await platform.deleteConnection('my-sheets');

// Execute operations
await platform.execute<T>('google-sheets', 'values.get', {
  connectionId: 'conn_xxx',
  params: {
    pathParams: { spreadsheetId: '...', range: 'Sheet1' }
  }
});

await platform.execute('google-sheets', 'values.update', {
  connectionId: 'conn_xxx',
  params: {
    pathParams: { spreadsheetId: '...', range: 'Sheet1!A2:B3' },
    body: { values: [['Alice', 150]] }
  }
});

// Cache management
await platform.cacheStatus();
await platform.refreshCache({ provider: 'google-sheets' });
```

### Type Definitions

```typescript
interface ExecuteOptions {
  connectionId: string;
  params: RequestParams;
  mode?: 'direct' | 'proxy' | 'auto';  // Default: 'auto'
}

interface RequestParams {
  pathParams?: Record<string, string>;
  queryParams?: Record<string, string | number | boolean>;
  body?: unknown;
}

interface ExecuteResult<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta: {
    provider: string;
    endpoint: string;
    executionMode: 'direct' | 'proxy';
    cached: boolean;
    executionTimeMs: number;
  };
  rateLimit?: {
    remaining: number;
    limit: number;
  };
}

interface Connection {
  id: string;
  name: string;
  provider: string;
  config: Record<string, unknown>;
  preferredMode: 'direct' | 'proxy' | 'auto';
  createdAt: string;
}
```

---

## Security Model

### Credential Protection

1. **Encryption at Rest:** All credentials encrypted with AES-GCM using `CREDENTIALS_KEY`
2. **Connection Ownership:** Connections belong to artifact owners only
3. **Write Protection:** Update/append require owner Bearer token
4. **Direct Mode Security:** Short-lived tokens prepared server-side, never expose refresh tokens

### Execution Mode Security

| Mode | Token Exposure | Use Case |
|------|----------------|----------|
| **Proxy** | None (server holds tokens) | Default, most secure |
| **Direct** | Short-lived access token only | Performance-critical reads |

### Owner Verification

```typescript
// Handled by Data Platform Engine's credential manager
async function verifyOwner(request: Request, ctx: DataContext): Promise<boolean> {
  // Check Bearer token
  const authHeader = request.headers.get('Authorization');
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    const payload = await verifyAccessToken(token, ctx.artifactId, ctx.env);
    if (payload && payload.authType === 'owner') {
      return true;
    }
  }

  // Check session cookie
  const cookies = request.headers.get('Cookie');
  const sessionToken = extractTokenFromCookie(cookies, /shareout_session=([^;]+)/);
  if (sessionToken) {
    const user = await verifySessionToken(sessionToken, ctx.env);
    if (user) {
      const artifact = await getArtifact(ctx.artifactId);
      return artifact.owner_id === user.id;
    }
  }

  return false;
}
```

---

## Rate Limits & Quotas

### Provider Rate Limiting

From the Google Sheets provider config:

```typescript
rateLimit: {
  requestsPerMinute: 300,
  requestsPerSecond: 10,
  burstLimit: 20,
  quotaTracking: 'per-connection',  // Each connection tracked separately
}
```

### Google Sheets API Limits

| Resource | Limit | Window |
|----------|-------|--------|
| Read requests | 300 | per minute per user |
| Write requests | 300 | per minute per user |

### Rate Limit Response

When rate limited, responses include:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Rate limit exceeded. Retry after 2s."
  },
  "rateLimit": {
    "remaining": 0,
    "limit": 300,
    "retryAfterMs": 2000
  }
}
```

**Mitigation:** Two-layer caching reduces API calls significantly.

---

## Error Codes

| Code | HTTP | Description | Resolution |
|------|------|-------------|------------|
| `CONNECTION_NOT_FOUND` | 404 | Connection doesn't exist | Create connection first |
| `PROVIDER_NOT_FOUND` | 404 | Provider not registered | Check provider ID |
| `ENDPOINT_NOT_FOUND` | 404 | Endpoint not defined | Check available endpoints |
| `NOT_CONNECTED` | 401 | No credentials stored | User must authorize via OAuth |
| `TOKEN_EXPIRED` | 401 | Access token expired and refresh failed | Re-authorize |
| `OWNER_REQUIRED` | 403 | Only owner can perform action | Use owner's Bearer token |
| `RATE_LIMITED` | 429 | Rate limit exceeded | Wait and retry |
| `INVALID_REQUEST` | 400 | Missing required fields | Check request body |
| `PROVIDER_ERROR` | 500 | Google API error | Check error details |
| `GOOGLE_SHEETS_403` | 403 | Sheet not accessible | Share sheet with authorized account |

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/data/platform/index.ts` | Main platform handler |
| `src/data/platform/providers/google-sheets/config.ts` | Provider configuration |
| `src/data/platform/providers/google-sheets/index.ts` | Provider implementation |
| `src/data/platform/core/engine.ts` | Execution orchestrator |
| `src/data/platform/core/cache.ts` | Two-layer cache |
| `src/data/platform/core/credentials.ts` | Token encryption/storage |
| `sdk/src/platform.ts` | PlatformStore SDK class |
| `docs/data-platform-engine.md` | Full platform documentation |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_SHEETS_CLIENT_ID` | Yes | OAuth client ID from Google Cloud Console |
| `GOOGLE_SHEETS_CLIENT_SECRET` | Yes | OAuth client secret |
| `CREDENTIALS_KEY` | Yes | 32-byte key for AES-GCM encryption |
| `SHAREOUT_BASE_URL` | Yes | Base URL for OAuth redirects |

---

## Provider Configuration

The Google Sheets provider is configured in `src/data/platform/providers/google-sheets/config.ts`:

```typescript
export const GOOGLE_SHEETS_CONFIG: ProviderConfig = {
  id: 'google-sheets',
  name: 'Google Sheets',

  execution: {
    defaultMode: 'direct',
    directSupported: true,     // Google Sheets API supports CORS
    proxyRequired: false,
    corsAllowed: [],           // All origins allowed
  },

  auth: {
    type: 'oauth2',
    oauth: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
      clientIdEnvVar: 'GOOGLE_SHEETS_CLIENT_ID',
      clientSecretEnvVar: 'GOOGLE_SHEETS_CLIENT_SECRET',
    },
    refreshable: true,
  },

  cache: {
    defaultTtlSeconds: 300,
    maxTtlSeconds: 3600,
    persistable: true,
    userRefreshable: true,
  },

  rateLimit: {
    requestsPerMinute: 300,
    requestsPerSecond: 10,
    quotaTracking: 'per-connection',
  },
};
```

---

## See Also

- [Data Platform Engine Guide](./data-platform-engine.md) - Full platform documentation
- [Adding New Providers](./data-platform-engine.md#adding-a-new-provider) - How to add providers
