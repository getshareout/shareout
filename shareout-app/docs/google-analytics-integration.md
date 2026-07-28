# Google Analytics Integration - Technical Documentation

## Overview

ShareOut provides Google Analytics 4 (GA4) integration as a **provider** within the Data Platform Engine. This allows published HTML artifacts to query analytics data from GA4 properties with a unified connection management system.

**Key Features:**
- Provider-based architecture via Data Platform Engine
- Hybrid execution: Direct mode (browser) or Proxy mode (server)
- Named connections with encrypted credential storage
- Two-layer caching (memory + persisted)
- Automatic token refresh
- Per-connection rate limiting
- Support for dimensions, metrics, and date ranges

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User's Browser                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  Published Artifact (HTML)                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ShareOut SDK - PlatformStore                                    │    │
│  │  - sdk.platform.connect('google-analytics', {...})               │    │
│  │  - sdk.platform.execute('google-analytics', 'reports.run', {...})│    │
│  │  - sdk.platform.execute('google-analytics', 'realtime', {...})   │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                              │
     ┌────────────────────────┼────────────────────────┐
     │ Direct Mode            │ Proxy Mode             │
     │ (CORS-enabled)         │ (Server-proxied)       │
     ▼                        ▼
┌─────────┐            ┌─────────────────────────────────────────┐
│ Google  │            │  ShareOut Worker                        │
│Analytics│            │  └─ Data Platform Engine                │
│ Data API│            │      ├─ Google Analytics Provider       │
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
│                    Google Analytics Data API (GA4)                       │
│  https://analyticsdata.googleapis.com/v1beta                             │
│  - Scope: https://www.googleapis.com/auth/analytics.readonly             │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Connection Flow

### Creating a Google Analytics Connection

```
1. User clicks "Connect Google Analytics" button
   │
   ▼
2. SDK calls GET /v1/data/{artifactId}/platform/google-analytics/auth-url
   │
   ▼
3. Provider generates OAuth URL with state parameter:
   {
     provider: "google-analytics",
     artifactId: "art_xxx",
     connectionName: "my-analytics",
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
6. Google redirects to /platform/google-analytics/callback with code
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
  provider TEXT NOT NULL,               -- 'google-analytics'
  config TEXT NOT NULL,                 -- JSON: { propertyId: '123456789' }
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

## Provider Configuration

The Google Analytics provider is configured in `src/data/platform/providers/google-analytics/config.ts`:

```typescript
export const GOOGLE_ANALYTICS_CONFIG: ProviderConfig = {
  id: 'google-analytics',
  name: 'Google Analytics',
  version: 'v1beta',

  execution: {
    defaultMode: 'direct',
    directSupported: true,     // GA Data API supports CORS
    proxyRequired: false,
    corsAllowed: [],           // All origins allowed
  },

  auth: {
    type: 'oauth2',
    oauth: {
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      scopes: ['https://www.googleapis.com/auth/analytics.readonly'],
      clientIdEnvVar: 'GOOGLE_ANALYTICS_CLIENT_ID',
      clientSecretEnvVar: 'GOOGLE_ANALYTICS_CLIENT_SECRET',
    },
    refreshable: true,
  },

  cache: {
    defaultTtlSeconds: 300,      // 5 minutes
    maxTtlSeconds: 3600,         // 1 hour max
    persistable: true,           // Store in artifact_json
    userRefreshable: true,       // Users can trigger cache refresh
  },

  rateLimit: {
    requestsPerMinute: 60,
    requestsPerSecond: 5,
    burstLimit: 10,
    quotaTracking: 'per-connection',  // Each connection tracked separately
  },

  api: {
    baseUrl: 'https://analyticsdata.googleapis.com/v1beta',
    defaultHeaders: {
      'Content-Type': 'application/json',
    },
  },
};
```

---

## Available Endpoints

| Endpoint ID | Method | Path | Cache TTL | Description |
|-------------|--------|------|-----------|-------------|
| `reports.run` | POST | /properties/{propertyId}:runReport | 5 min | Run a standard report |
| `reports.batch` | POST | /properties/{propertyId}:batchRunReports | 5 min | Run multiple reports |
| `reports.pivot` | POST | /properties/{propertyId}:runPivotReport | 5 min | Run pivot report |
| `realtime` | POST | /properties/{propertyId}:runRealtimeReport | 30 sec | Real-time data |
| `metadata` | GET | /properties/{propertyId}/metadata | 1 hour | Available dimensions/metrics |
| `audienceExports.create` | POST | /properties/{propertyId}/audienceExports | - | Create audience export |
| `audienceExports.get` | GET | /properties/{propertyId}/audienceExports/{name} | 5 min | Get audience export |
| `audienceExports.list` | GET | /properties/{propertyId}/audienceExports | 5 min | List audience exports |

---

## Caching Layer

### Two-Layer Cache Architecture

The Data Platform Engine uses a two-layer caching strategy:

```
Request → Check Memory Cache
           ├─ HIT → Return immediately
           └─ MISS → Check Persisted Cache (artifact_json)
                      ├─ HIT → Hydrate memory, return
                      └─ MISS → Fetch from Google Analytics, cache both
```

### Cache Key Format

```
Cache Key: {provider}:{endpoint}:{queryHash}

Example: google-analytics:reports.run:a1b2c3d4
```

### Cache Entry Structure

```json
{
  "data": {
    "dimensionHeaders": [{ "name": "date" }, { "name": "country" }],
    "metricHeaders": [{ "name": "activeUsers" }],
    "rows": [
      { "dimensionValues": [...], "metricValues": [...] }
    ],
    "rowCount": 100
  },
  "meta": {
    "cachedAt": "2024-01-15T10:00:00Z",
    "ttlSeconds": 300
  }
}
```

### Cache TTL by Endpoint Type

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Standard reports | 5 min | Balance freshness and API quota |
| Realtime reports | 30 sec | Near real-time data needs |
| Metadata | 1 hour | Rarely changes |
| Audience exports | 5 min | Export status may change |

### Cache Invalidation

- **Manual refresh:** `POST /platform/cache/refresh` with endpoint filter
- **TTL expiry:** Automatic on read when TTL exceeded
- **No write operations:** GA4 Data API is read-only

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

### Google Analytics Provider

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/platform/google-analytics` | GET | None | Get provider config & endpoints |
| `/platform/google-analytics/auth-url` | GET | Owner | Get OAuth URL |
| `/platform/google-analytics/callback` | GET | None | OAuth callback handler |
| `/platform/google-analytics/prepare` | POST | Owner | Get credentials for direct mode |
| `/platform/google-analytics/{endpoint}/execute` | POST | Varies | Execute API request |

### Cache Management

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/platform/cache/status` | GET | None | Get cache statistics |
| `/platform/cache/refresh` | POST | Owner | Invalidate cache |

---

## Request/Response Examples

### Run Report

**Request:**
```http
POST /v1/data/art_abc123/platform/google-analytics/reports.run/execute
Content-Type: application/json

{
  "connectionId": "conn_xxx",
  "params": {
    "pathParams": {
      "propertyId": "123456789"
    },
    "body": {
      "dateRanges": [
        { "startDate": "30daysAgo", "endDate": "today" }
      ],
      "dimensions": [
        { "name": "date" },
        { "name": "country" }
      ],
      "metrics": [
        { "name": "activeUsers" },
        { "name": "sessions" }
      ],
      "limit": 100
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "dimensionHeaders": [
      { "name": "date" },
      { "name": "country" }
    ],
    "metricHeaders": [
      { "name": "activeUsers", "type": "TYPE_INTEGER" },
      { "name": "sessions", "type": "TYPE_INTEGER" }
    ],
    "rows": [
      {
        "dimensionValues": [
          { "value": "20240115" },
          { "value": "United States" }
        ],
        "metricValues": [
          { "value": "1234" },
          { "value": "2345" }
        ]
      }
    ],
    "rowCount": 100,
    "metadata": {
      "currencyCode": "USD",
      "timeZone": "America/Los_Angeles"
    }
  },
  "meta": {
    "provider": "google-analytics",
    "endpoint": "reports.run",
    "executionMode": "proxy",
    "cached": false,
    "executionTimeMs": 456
  }
}
```

### Realtime Report

**Request:**
```http
POST /v1/data/art_abc123/platform/google-analytics/realtime/execute
Content-Type: application/json

{
  "connectionId": "conn_xxx",
  "params": {
    "pathParams": {
      "propertyId": "123456789"
    },
    "body": {
      "dimensions": [
        { "name": "country" }
      ],
      "metrics": [
        { "name": "activeUsers" }
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
    "dimensionHeaders": [{ "name": "country" }],
    "metricHeaders": [{ "name": "activeUsers", "type": "TYPE_INTEGER" }],
    "rows": [
      {
        "dimensionValues": [{ "value": "United States" }],
        "metricValues": [{ "value": "42" }]
      },
      {
        "dimensionValues": [{ "value": "United Kingdom" }],
        "metricValues": [{ "value": "15" }]
      }
    ],
    "rowCount": 2
  },
  "meta": {
    "provider": "google-analytics",
    "endpoint": "realtime",
    "executionMode": "proxy",
    "cached": false,
    "executionTimeMs": 234
  }
}
```

### Get Metadata (Available Dimensions & Metrics)

**Request:**
```http
POST /v1/data/art_abc123/platform/google-analytics/metadata/execute
Content-Type: application/json

{
  "connectionId": "conn_xxx",
  "params": {
    "pathParams": {
      "propertyId": "123456789"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "name": "properties/123456789/metadata",
    "dimensions": [
      {
        "apiName": "date",
        "uiName": "Date",
        "description": "The date of the event",
        "category": "Time"
      },
      {
        "apiName": "country",
        "uiName": "Country",
        "description": "The country from which user activity originated",
        "category": "Geography"
      }
    ],
    "metrics": [
      {
        "apiName": "activeUsers",
        "uiName": "Active users",
        "description": "The number of distinct users who visited your site",
        "category": "User",
        "type": "TYPE_INTEGER"
      },
      {
        "apiName": "sessions",
        "uiName": "Sessions",
        "description": "The number of sessions that began on your site",
        "category": "Session",
        "type": "TYPE_INTEGER"
      }
    ]
  },
  "meta": {
    "provider": "google-analytics",
    "endpoint": "metadata",
    "executionMode": "proxy",
    "cached": true,
    "executionTimeMs": 12
  }
}
```

### Batch Run Reports

**Request:**
```http
POST /v1/data/art_abc123/platform/google-analytics/reports.batch/execute
Content-Type: application/json

{
  "connectionId": "conn_xxx",
  "params": {
    "pathParams": {
      "propertyId": "123456789"
    },
    "body": {
      "requests": [
        {
          "dateRanges": [{ "startDate": "7daysAgo", "endDate": "today" }],
          "dimensions": [{ "name": "date" }],
          "metrics": [{ "name": "activeUsers" }]
        },
        {
          "dateRanges": [{ "startDate": "7daysAgo", "endDate": "today" }],
          "dimensions": [{ "name": "country" }],
          "metrics": [{ "name": "sessions" }]
        }
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
    "reports": [
      {
        "dimensionHeaders": [{ "name": "date" }],
        "metricHeaders": [{ "name": "activeUsers", "type": "TYPE_INTEGER" }],
        "rows": [...],
        "rowCount": 7
      },
      {
        "dimensionHeaders": [{ "name": "country" }],
        "metricHeaders": [{ "name": "sessions", "type": "TYPE_INTEGER" }],
        "rows": [...],
        "rowCount": 25
      }
    ]
  },
  "meta": {
    "provider": "google-analytics",
    "endpoint": "reports.batch",
    "executionMode": "proxy",
    "cached": false,
    "executionTimeMs": 678
  }
}
```

---

## SDK Reference

### PlatformStore API for Google Analytics

```typescript
// Access via sdk.platform
const platform = sdk.platform;

// Connection management
await platform.connect('google-analytics', {
  name: 'my-analytics',
  config: { propertyId: '123456789' }
});

await platform.getConnections();
await platform.deleteConnection('my-analytics');

// Execute operations
await platform.execute<ReportResponse>('google-analytics', 'reports.run', {
  connectionId: 'conn_xxx',
  params: {
    pathParams: { propertyId: '123456789' },
    body: {
      dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
      dimensions: [{ name: 'date' }],
      metrics: [{ name: 'activeUsers' }]
    }
  }
});

// Realtime data
await platform.execute('google-analytics', 'realtime', {
  connectionId: 'conn_xxx',
  params: {
    pathParams: { propertyId: '123456789' },
    body: {
      dimensions: [{ name: 'country' }],
      metrics: [{ name: 'activeUsers' }]
    }
  }
});

// Cache management
await platform.cacheStatus();
await platform.refreshCache({ provider: 'google-analytics' });
```

### Type Definitions

```typescript
interface ExecuteOptions {
  connectionId: string;
  params: RequestParams;
  mode?: 'direct' | 'proxy' | 'auto';  // Default: 'auto'
}

interface RequestParams {
  pathParams?: {
    propertyId: string;
  };
  body?: ReportRequest | RealtimeRequest | BatchRequest;
}

interface ReportRequest {
  dateRanges: DateRange[];
  dimensions?: Dimension[];
  metrics: Metric[];
  dimensionFilter?: FilterExpression;
  metricFilter?: FilterExpression;
  offset?: number;
  limit?: number;
  orderBys?: OrderBy[];
  keepEmptyRows?: boolean;
}

interface DateRange {
  startDate: string;  // 'YYYY-MM-DD' or 'NdaysAgo' or 'today' or 'yesterday'
  endDate: string;
  name?: string;
}

interface Dimension {
  name: string;  // e.g., 'date', 'country', 'deviceCategory'
}

interface Metric {
  name: string;  // e.g., 'activeUsers', 'sessions', 'bounceRate'
}

interface ReportResponse {
  dimensionHeaders: DimensionHeader[];
  metricHeaders: MetricHeader[];
  rows: Row[];
  rowCount: number;
  metadata?: {
    currencyCode: string;
    timeZone: string;
  };
}

interface Row {
  dimensionValues: { value: string }[];
  metricValues: { value: string }[];
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
```

### Common Dimensions

| API Name | UI Name | Category |
|----------|---------|----------|
| `date` | Date | Time |
| `dateHour` | Date + hour | Time |
| `country` | Country | Geography |
| `city` | City | Geography |
| `deviceCategory` | Device category | Platform / Device |
| `browser` | Browser | Platform / Device |
| `operatingSystem` | Operating system | Platform / Device |
| `sessionSource` | Session source | Traffic source |
| `sessionMedium` | Session medium | Traffic source |
| `landingPage` | Landing page | Page / Screen |
| `pagePath` | Page path | Page / Screen |

### Common Metrics

| API Name | UI Name | Type |
|----------|---------|------|
| `activeUsers` | Active users | Integer |
| `newUsers` | New users | Integer |
| `sessions` | Sessions | Integer |
| `screenPageViews` | Views | Integer |
| `bounceRate` | Bounce rate | Percent |
| `averageSessionDuration` | Avg. session duration | Seconds |
| `engagementRate` | Engagement rate | Percent |
| `conversions` | Conversions | Integer |
| `totalRevenue` | Total revenue | Currency |

---

## Security Model

### Credential Protection

1. **Encryption at Rest:** All credentials encrypted with AES-GCM using `CREDENTIALS_KEY`
2. **Connection Ownership:** Connections belong to artifact owners only
3. **Read-Only Scope:** Only `analytics.readonly` scope requested
4. **Direct Mode Security:** Short-lived tokens prepared server-side, never expose refresh tokens

### Execution Mode Security

| Mode | Token Exposure | Use Case |
|------|----------------|----------|
| **Proxy** | None (server holds tokens) | Default, most secure |
| **Direct** | Short-lived access token only | Performance-critical reads |

### Property Access

Users can only access GA4 properties they have permission to view in their Google account. The OAuth scope ensures read-only access.

---

## Rate Limits & Quotas

### Google Analytics Data API Limits

| Resource | Limit | Window |
|----------|-------|--------|
| Core requests | 10,000 | per day per project |
| Core requests | 10 | per second per property |
| Realtime requests | 10 | per second per property |
| Concurrent requests | 10 | per property |

### Provider Rate Limiting

From the Google Analytics provider config:

```typescript
rateLimit: {
  requestsPerMinute: 60,
  requestsPerSecond: 5,
  burstLimit: 10,
  quotaTracking: 'per-connection',  // Each connection tracked separately
}
```

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
    "limit": 60,
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
| `GA_400` | 400 | Invalid report request | Check dimensions/metrics |
| `GA_403` | 403 | Property not accessible | Verify property access |
| `GA_404` | 404 | Property not found | Check property ID |
| `GA_429` | 429 | Google rate limit exceeded | Wait and retry |

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/data/platform/index.ts` | Main platform handler |
| `src/data/platform/providers/google-analytics/config.ts` | Provider configuration |
| `src/data/platform/providers/google-analytics/index.ts` | Provider implementation |
| `src/data/platform/core/engine.ts` | Execution orchestrator |
| `src/data/platform/core/cache.ts` | Two-layer cache |
| `src/data/platform/core/credentials.ts` | Token encryption/storage |
| `sdk/src/platform.ts` | PlatformStore SDK class |
| `docs/data-platform-engine.md` | Full platform documentation |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_ANALYTICS_CLIENT_ID` | Yes | OAuth client ID from Google Cloud Console |
| `GOOGLE_ANALYTICS_CLIENT_SECRET` | Yes | OAuth client secret |
| `CREDENTIALS_KEY` | Yes | 32-byte key for AES-GCM encryption |
| `SHAREOUT_BASE_URL` | Yes | Base URL for OAuth redirects |

### Setting Up Google Analytics Credentials

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create or select a project
3. Enable the **Google Analytics Data API**
4. Go to **Credentials** → **Create Credentials** → **OAuth client ID**
5. Select **Web application**
6. Add authorized redirect URI: `https://shareout.site/v1/data/*/platform/google-analytics/callback`
7. Copy Client ID and Client Secret
8. Add to Cloudflare:
   ```bash
   npx wrangler secret put GOOGLE_ANALYTICS_CLIENT_ID
   npx wrangler secret put GOOGLE_ANALYTICS_CLIENT_SECRET
   ```

---

## Usage Examples

### Dashboard with Traffic Overview

```typescript
// Fetch multiple reports in one batch
const { data } = await sdk.platform.execute('google-analytics', 'reports.batch', {
  connectionId: 'conn_xxx',
  params: {
    pathParams: { propertyId: '123456789' },
    body: {
      requests: [
        // Users by date (last 30 days)
        {
          dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'date' }],
          metrics: [{ name: 'activeUsers' }, { name: 'sessions' }]
        },
        // Top countries
        {
          dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'country' }],
          metrics: [{ name: 'activeUsers' }],
          limit: 10,
          orderBys: [{ metric: { metricName: 'activeUsers' }, desc: true }]
        },
        // Top pages
        {
          dateRanges: [{ startDate: '30daysAgo', endDate: 'today' }],
          dimensions: [{ name: 'pagePath' }],
          metrics: [{ name: 'screenPageViews' }],
          limit: 10,
          orderBys: [{ metric: { metricName: 'screenPageViews' }, desc: true }]
        }
      ]
    }
  }
});

// data.reports[0] = users by date
// data.reports[1] = top countries
// data.reports[2] = top pages
```

### Real-Time Visitors Widget

```typescript
// Poll realtime data every 30 seconds
async function updateRealtimeWidget() {
  const { data } = await sdk.platform.execute('google-analytics', 'realtime', {
    connectionId: 'conn_xxx',
    params: {
      pathParams: { propertyId: '123456789' },
      body: {
        dimensions: [{ name: 'country' }],
        metrics: [{ name: 'activeUsers' }]
      }
    }
  });

  const totalActive = data.rows?.reduce(
    (sum, row) => sum + parseInt(row.metricValues[0].value), 0
  ) || 0;

  document.getElementById('active-users').textContent = totalActive;
}

setInterval(updateRealtimeWidget, 30000);
```

---

## See Also

- [Data Platform Engine Guide](./data-platform-engine.md) - Full platform documentation
- [Adding New Providers](./data-platform-engine.md#adding-a-new-provider) - How to add providers
- [Google Sheets Integration](./google-sheets-integration.md) - Similar OAuth provider
