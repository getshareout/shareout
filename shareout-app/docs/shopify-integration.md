# Shopify Integration - Technical Documentation

## Overview

ShareOut provides a fully managed Shopify integration that allows published HTML artifacts to read from and write to Shopify stores without requiring users to manage API keys or create their own apps.

**Key Features:**
- One-click OAuth authorization via popup
- Full Shopify Admin REST API access (products, orders, customers, inventory)
- Per-connection token storage (encrypted)
- Smart caching with configurable TTL per endpoint
- Automatic rate limit tracking per connection
- Proxy-only execution (no CORS issues)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           User's Browser                                 │
├─────────────────────────────────────────────────────────────────────────┤
│  Published Artifact (HTML)                                               │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  ShareOut SDK                                                    │    │
│  │  - sdk.platform.connect()    → Opens OAuth popup                 │    │
│  │  - sdk.platform.execute()    → Calls Shopify API (proxied)       │    │
│  │  - sdk.platform.connections()→ List connected stores             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ShareOut Worker (Cloudflare)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  /v1/data/{artifactId}/platform/shopify/*                                │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Data Platform Engine (src/data/platform/)                       │    │
│  │  ├── Provider Registry → ShopifyProvider                         │    │
│  │  ├── OAuth flow management                                       │    │
│  │  ├── Credential encryption/decryption (AES-GCM)                  │    │
│  │  ├── Rate limiter (per-connection tracking)                      │    │
│  │  ├── Cache layer (memory + artifact_json table)                  │    │
│  │  └── Request execution (proxy to Shopify)                        │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                    │                                     │
│  ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐      │
│  │  D1 Database    │    │  platform_      │    │  CREDENTIALS_   │      │
│  │  - Connections  │    │  connections    │    │  KEY (env)      │      │
│  │  - Cache        │    │  table          │    │  - AES-GCM      │      │
│  └─────────────────┘    └─────────────────┘    └─────────────────┘      │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                        Shopify Admin REST API                            │
│  https://{shop}.myshopify.com/admin/api/2024-01/                         │
│  - Using ShareOut's Shopify Partner App OAuth credentials                │
│  - Scopes: read_products, write_products, read_orders, etc.              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## OAuth Flow

### First-Time Connection

```
1. User enters shop name and clicks "Connect Shopify"
   │
   ▼
2. SDK calls GET /v1/data/{artifactId}/platform/shopify/auth-url?shop={shop}&connection={name}
   │
   ▼
3. Handler generates OAuth URL with state parameter:
   {
     artifactId: "art_xxx",
     connectionName: "my-store",
     returnUrl: "...",
     ts: 1234567890
   }
   │
   ▼
4. SDK opens popup window to Shopify OAuth:
   https://{shop}.myshopify.com/admin/oauth/authorize?
     client_id={SHOPIFY_CLIENT_ID}&
     scope=read_products,write_products,read_orders,...&
     redirect_uri={callback_url}&
     state={encoded_state}
   │
   ▼
5. User logs into Shopify, installs the app
   │
   ▼
6. Shopify redirects to /v1/data/{artifactId}/platform/shopify/callback
   with code and shop parameters
   │
   ▼
7. Handler exchanges code for access token:
   POST https://{shop}.myshopify.com/admin/oauth/access_token
   {
     client_id: "...",
     client_secret: "...",
     code: "..."
   }
   │
   ▼
8. Access token encrypted with AES-GCM and stored in connections (scope_type='artifact', kind='platform')
   with shop name in config
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
  id TEXT PRIMARY KEY,                -- conn_xxxxxxxxxxxx
  scope_type TEXT NOT NULL,           -- 'artifact' here; 'workspace' when shared
  scope_id TEXT NOT NULL,             -- the artifact id
  name TEXT NOT NULL,                 -- User-defined connection name
  kind TEXT NOT NULL,                 -- 'platform'
  provider TEXT NOT NULL,             -- 'shopify'
  config TEXT NOT NULL DEFAULT '{}',  -- JSON: { "shop": "my-store" }
  encrypted_credentials TEXT,         -- AES-GCM encrypted token object
  iv TEXT,                            -- Initialization vector
  preferred_mode TEXT NOT NULL DEFAULT 'auto',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(scope_type, scope_id, name)
);
```

### Token Characteristics

- **Lifetime:** Shopify access tokens do NOT expire (permanent until revoked)
- **No refresh needed:** Unlike Google, tokens remain valid indefinitely
- **Revocation:** Users can revoke via Shopify Admin → Apps → Uninstall

---

## Provider Implementation

### Configuration (src/data/platform/providers/shopify/config.ts)

```typescript
export const SHOPIFY_CONFIG: ProviderConfig = {
  id: 'shopify',
  name: 'Shopify',
  version: '2024-01',

  execution: {
    defaultMode: 'proxy',
    directSupported: false,    // No CORS support
    proxyRequired: true,
    corsAllowed: [],
  },

  auth: {
    type: 'oauth2',
    oauth: {
      authorizationUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
      tokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token',
      scopes: [
        'read_products', 'write_products',
        'read_orders', 'read_customers', 'read_inventory',
      ],
      clientIdEnvVar: 'SHOPIFY_CLIENT_ID',
      clientSecretEnvVar: 'SHOPIFY_CLIENT_SECRET',
    },
    refreshable: false,        // Tokens don't expire
  },

  rateLimit: {
    requestsPerMinute: 80,     // Shopify: ~2 req/sec
    requestsPerSecond: 2,
    burstLimit: 4,
    quotaTracking: 'per-connection',  // Each store has own limits
  },

  cache: {
    defaultTtlSeconds: 300,    // 5 minutes
    maxTtlSeconds: 3600,
    persistable: true,
    userRefreshable: true,
  },

  pagination: {
    type: 'link',              // Shopify uses Link header
    defaultLimit: 50,
    maxLimit: 250,
  },
};
```

### Available Endpoints

| Endpoint ID | Method | Path | Cache TTL | Description |
|-------------|--------|------|-----------|-------------|
| `products.list` | GET | /products.json | 5 min | List all products |
| `products.get` | GET | /products/{id}.json | 5 min | Get single product |
| `products.count` | GET | /products/count.json | 1 min | Get product count |
| `products.create` | POST | /products.json | - | Create product |
| `products.update` | PUT | /products/{id}.json | - | Update product |
| `orders.list` | GET | /orders.json | 1 min | List orders |
| `orders.get` | GET | /orders/{id}.json | 1 min | Get single order |
| `orders.count` | GET | /orders/count.json | 1 min | Get order count |
| `customers.list` | GET | /customers.json | 5 min | List customers |
| `customers.get` | GET | /customers/{id}.json | 5 min | Get customer |
| `customers.count` | GET | /customers/count.json | 1 min | Get customer count |
| `inventory.levels` | GET | /inventory_levels.json | 1 min | Get inventory |
| `inventory.locations` | GET | /locations.json | 10 min | List locations |
| `shop.get` | GET | /shop.json | 1 hour | Get shop info |
| `collections.list` | GET | /custom_collections.json | 5 min | List collections |
| `smartCollections.list` | GET | /smart_collections.json | 5 min | Smart collections |

---

## Caching Layer

### How It Works

Shopify data is cached using the Data Platform Engine's two-tier cache:

1. **Memory Cache:** In-worker memory (fast, cleared on restart)
2. **Persistent Cache:** `artifact_json` table (durable, survives restarts)

```
Request → Check Memory Cache
           ├─ HIT → Return immediately
           └─ MISS → Check Persistent Cache
                      ├─ HIT → Hydrate memory, return
                      └─ MISS → Fetch from Shopify, cache both
```

### Cache Key Format

```
shopify:{endpoint}:{queryHash}

Example: shopify:products.list:a1b2c3d4
```

### Cache TTL by Endpoint Type

| Data Type | TTL | Rationale |
|-----------|-----|-----------|
| Products | 5 min | Changes infrequently |
| Orders | 1 min | Time-sensitive data |
| Customers | 5 min | Changes infrequently |
| Inventory | 1 min | Real-time accuracy needed |
| Shop info | 1 hour | Rarely changes |

### Cache Invalidation

```http
POST /v1/data/{artifactId}/platform/cache/refresh
Content-Type: application/json

{
  "provider": "shopify",
  "endpoint": "products.list"  // Optional: clear specific endpoint
}
```

---

## API Endpoints

### Connection Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/platform/connections` | GET | List all connections |
| `/platform/connections` | POST | Create connection (direct token) |
| `/platform/connections/{name}` | GET | Get connection details |
| `/platform/connections/{name}` | DELETE | Delete connection |

### OAuth Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/platform/shopify/auth-url` | GET | Get OAuth authorization URL |
| `/platform/shopify/callback` | GET | OAuth callback handler |

### Execution Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/platform/shopify` | GET | Get provider config & endpoints |
| `/platform/shopify/{endpoint}/execute` | POST | Execute API request |
| `/platform/shopify/prepare` | POST | Prepare credentials (for direct mode) |

### Cache Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/platform/cache/status` | GET | Get cache statistics |
| `/platform/cache/refresh` | POST | Invalidate cache |

---

## Request/Response Examples

### Connect Store (OAuth)

**Step 1: Get Auth URL**
```http
GET /v1/data/art_abc123/platform/shopify/auth-url?shop=my-store&connection=main-store

Response:
{
  "authUrl": "https://my-store.myshopify.com/admin/oauth/authorize?client_id=xxx&scope=read_products,read_orders&redirect_uri=https://shareout.site/v1/data/art_abc123/platform/shopify/callback&state=eyJ..."
}
```

**Step 2: User completes OAuth in popup**

**Step 3: Callback creates connection automatically**

### List Products

**Request:**
```http
POST /v1/data/art_abc123/platform/shopify/products.list/execute
Content-Type: application/json

{
  "connectionId": "conn_xxxxxxxxxxxx",
  "params": {
    "queryParams": {
      "limit": 50,
      "status": "active"
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "products": [
      {
        "id": 123456789,
        "title": "Classic T-Shirt",
        "vendor": "My Brand",
        "product_type": "Apparel",
        "variants": [
          { "id": 987654321, "price": "29.99", "sku": "TSHIRT-001" }
        ]
      }
    ]
  },
  "meta": {
    "provider": "shopify",
    "endpoint": "products.list",
    "executionMode": "proxy",
    "cached": false,
    "executionTimeMs": 234
  },
  "pagination": {
    "hasMore": true,
    "cursor": "eyJsYXN0X2lkIjoxMjM0NTY3ODl9"
  },
  "rateLimit": {
    "remaining": 38,
    "limit": 40
  }
}
```

### Get Single Product

**Request:**
```http
POST /v1/data/art_abc123/platform/shopify/products.get/execute
Content-Type: application/json

{
  "connectionId": "conn_xxxxxxxxxxxx",
  "params": {
    "pathParams": { "id": 123456789 }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "product": {
      "id": 123456789,
      "title": "Classic T-Shirt",
      "body_html": "<p>Premium quality cotton</p>",
      "vendor": "My Brand",
      "variants": [...]
    }
  },
  "meta": {
    "provider": "shopify",
    "endpoint": "products.get",
    "executionMode": "proxy",
    "cached": true,
    "cachedAt": "2024-01-15T10:00:00Z",
    "executionTimeMs": 12
  }
}
```

### Create Product

**Request:**
```http
POST /v1/data/art_abc123/platform/shopify/products.create/execute
Content-Type: application/json

{
  "connectionId": "conn_xxxxxxxxxxxx",
  "params": {
    "body": {
      "product": {
        "title": "New Product",
        "body_html": "<p>Description here</p>",
        "vendor": "My Brand",
        "product_type": "Apparel",
        "variants": [
          { "price": "49.99", "sku": "NEW-001" }
        ]
      }
    }
  }
}
```

### Paginate Through Results

**First request:**
```http
POST /platform/shopify/products.list/execute
{
  "connectionId": "conn_xxx",
  "params": { "queryParams": { "limit": 250 } }
}
```

**Subsequent requests (using cursor):**
```http
POST /platform/shopify/products.list/execute
{
  "connectionId": "conn_xxx",
  "params": {
    "queryParams": { "page_info": "eyJsYXN0X2lkIjoxMjM0NTY3ODl9" }
  }
}
```

---

## SDK Reference

### Platform Methods

```typescript
class ShareOut {
  platform: {
    // Connection management
    connections(provider?: string): Promise<Connection[]>
    connect(options: ConnectOptions): Promise<boolean>
    createConnection(options: CreateConnectionOptions): Promise<{ id: string }>
    deleteConnection(name: string): Promise<void>

    // Check connection
    isConnected(provider: string): Promise<boolean>

    // Execute API calls
    execute<T>(options: ExecuteOptions): Promise<PlatformResponse<T>>
  }
}

interface ConnectOptions {
  provider: 'shopify';
  name: string;           // Connection name (e.g., "my-store")
  params: {
    shop: string;         // Shop subdomain (e.g., "my-store")
  };
}

interface CreateConnectionOptions {
  provider: 'shopify';
  name: string;
  config: { shop: string };
  credentials: { access_token: string };
}

interface ExecuteOptions {
  provider: 'shopify';
  endpoint: string;       // e.g., "products.list"
  connectionId: string;   // Connection ID or name
  params?: {
    pathParams?: Record<string, string | number>;
    queryParams?: Record<string, string | number | boolean>;
    body?: unknown;
  };
  options?: {
    cache?: boolean;
    forceRefresh?: boolean;
  };
}

interface PlatformResponse<T> {
  success: boolean;
  data?: T;
  error?: { code: string; message: string };
  meta: {
    provider: string;
    endpoint: string;
    executionMode: 'direct' | 'proxy';
    cached: boolean;
    cachedAt?: string;
    executionTimeMs: number;
  };
  pagination?: {
    hasMore: boolean;
    cursor?: string;
  };
  rateLimit?: {
    remaining: number;
    limit: number;
  };
}
```

---

## Security Model

### Data Isolation

Each artifact has completely isolated connections:

```sql
-- ALL queries include artifact_id
SELECT * FROM connections
WHERE artifact_id = ? AND id = ?

-- Customer A cannot access Customer B's connections
-- Even with a valid connection ID, wrong artifact_id = no results
```

### Token Protection

1. **Encryption at Rest:** All tokens encrypted with AES-GCM using `CREDENTIALS_KEY`
2. **No Token Exposure:** Tokens never sent to browser, all API calls proxied
3. **Per-Connection Storage:** Each connection has unique encrypted credentials
4. **Artifact Scoping:** Connection queries always require artifact_id match

### Proxy-Only Execution

Shopify does not support CORS, so all requests go through ShareOut:

```
Browser → ShareOut (adds auth header) → Shopify API
```

This means:
- Access tokens never leave the server
- Request/response can be logged and rate-limited
- Cache can be applied server-side

---

## Rate Limits & Quotas

### Shopify API Limits

Shopify uses a "leaky bucket" algorithm with 40 points and 2 points/second leak rate:

| Limit | Value |
|-------|-------|
| Bucket size | 40 points |
| Leak rate | 2 points/second |
| Effective rate | ~2 requests/second |
| Recovery time | 20 seconds (empty to full) |

### ShareOut Rate Limit Tracking

ShareOut tracks rate limits per-connection:

```typescript
// Rate limit info extracted from Shopify response headers
// X-Shopify-Shop-Api-Call-Limit: 32/40

rateLimit: {
  remaining: 8,   // 40 - 32
  limit: 40
}
```

### Mitigation

- **Caching:** Reduces API calls significantly
- **Per-Connection Tracking:** Each store's limit tracked separately
- **Response Headers:** `rateLimit` object in every response

---

## Error Codes

| Code | HTTP | Description | Resolution |
|------|------|-------------|------------|
| `PROVIDER_NOT_FOUND` | 404 | Shopify provider not registered | Check provider import |
| `CONNECTION_NOT_FOUND` | 404 | Connection doesn't exist | Create connection first |
| `ENDPOINT_NOT_FOUND` | 404 | Invalid endpoint ID | Check available endpoints |
| `MISSING_SHOP` | 400 | Shop name not in connection config | Reconnect with shop param |
| `SHOPIFY_401` | 401 | Invalid/expired access token | Reconnect via OAuth |
| `SHOPIFY_403` | 403 | Missing required scopes | Reinstall app with correct scopes |
| `SHOPIFY_404` | 404 | Resource not found | Check resource ID |
| `SHOPIFY_422` | 422 | Invalid request data | Check request body |
| `SHOPIFY_429` | 429 | Rate limit exceeded | Wait and retry |
| `RATE_LIMITED` | 429 | ShareOut rate limit | Wait and retry |

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/data/platform/providers/shopify/config.ts` | Provider configuration |
| `src/data/platform/providers/shopify/index.ts` | Provider implementation |
| `src/data/platform/index.ts` | Platform request router |
| `src/data/platform/core/engine.ts` | Execution orchestrator |
| `src/data/platform/core/credentials.ts` | Token encryption & storage |
| `src/data/platform/core/cache.ts` | Two-tier caching |
| `src/data/platform/core/rate-limiter.ts` | Rate limit tracking |
| `src/data/platform/types.ts` | TypeScript interfaces |
| `src/skill.ts` | Agent skill documentation |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SHOPIFY_CLIENT_ID` | Yes | OAuth app client ID from Shopify Partners |
| `SHOPIFY_CLIENT_SECRET` | Yes | OAuth app client secret |
| `CREDENTIALS_KEY` | Yes | 32-byte key for AES-GCM encryption |
| `SHAREOUT_BASE_URL` | Yes | Base URL for OAuth redirects |

### Setting Up Shopify Credentials

1. Create a [Shopify Partner account](https://partners.shopify.com)
2. Create a new app in Partner Dashboard
3. Set **App URL:** `https://shareout.site`
4. Set **Allowed redirection URLs:** `https://shareout.site/v1/data/*/platform/shopify/callback`
5. Select API scopes: `read_products`, `write_products`, `read_orders`, `read_customers`, `read_inventory`
6. Copy Client ID and Client Secret
7. Add to Cloudflare:
   ```bash
   npx wrangler secret put SHOPIFY_CLIENT_ID
   npx wrangler secret put SHOPIFY_CLIENT_SECRET
   ```

---

## Future Improvements

1. **Webhooks:** Subscribe to Shopify webhooks for real-time updates
2. **GraphQL Support:** Add Shopify GraphQL Admin API provider
3. **Bulk Operations:** Support for bulk data export/import
4. **Multi-Store:** Connect multiple stores per artifact
5. **Metafields:** Full metafield CRUD support
6. **Storefront API:** Read-only storefront data access
