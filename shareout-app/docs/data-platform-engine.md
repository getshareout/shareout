# Data Platform Engine - Developer Guide

## Overview

The Data Platform Engine is an abstraction layer for external API providers (Google Sheets, Shopify, Meta, Pinterest, etc.) with a hybrid execution model supporting both **direct browser calls** and **server-proxied requests**.

```
┌─────────────────────────────────────────────────────────────────┐
│  SDK (Browser)                                                   │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ PlatformStore                                                ││
│  │  - Direct mode: SDK calls provider API directly              ││
│  │  - Proxy mode: SDK calls ShareOut → provider                 ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
     ┌────────────────────────┼────────────────────────┐
     │ Direct Mode            │ Proxy Mode             │
     │ (CORS-enabled APIs)    │ (No CORS support)      │
     ▼                        ▼
┌─────────┐            ┌─────────────────────────────────────────┐
│ Provider│            │  ShareOut Worker                        │
│ API     │            │  └─ Data Platform Engine                │
└─────────┘            │      ├─ Provider Registry               │
                       │      ├─ Unified Cache                   │
                       │      ├─ Rate Limiter                    │
                       │      └─ Credential Manager              │
                       └─────────────────────────────────────────┘
```

---

## Directory Structure

```
src/data/platform/
├── index.ts                    # Main handler, routes /v1/data/{id}/platform/*
├── types.ts                    # Core interfaces & types
├── registry.ts                 # Provider registration
│
├── core/
│   ├── engine.ts               # Execution orchestrator
│   ├── cache.ts                # Two-layer cache (memory + persisted)
│   ├── rate-limiter.ts         # Per-provider rate limiting
│   └── credentials.ts          # Token encryption & connection CRUD
│
├── execution/
│   └── mode-resolver.ts        # Determines direct vs proxy mode
│
└── providers/
    ├── base-provider.ts        # Abstract base class
    └── {provider-name}/        # One folder per provider
        ├── config.ts           # ProviderConfig
        └── index.ts            # Provider implementation
```

---

## Adding a New Provider

### Step 1: Create Provider Directory

```bash
mkdir -p src/data/platform/providers/{provider-name}
```

### Step 2: Create Configuration (`config.ts`)

```typescript
// src/data/platform/providers/shopify/config.ts
import type { ProviderConfig } from '../../types';

export const SHOPIFY_CONFIG: ProviderConfig = {
  // Unique identifier (used in URLs and API)
  id: 'shopify',

  // Display name
  name: 'Shopify',

  // API version
  version: '2024-01',

  // Execution mode configuration
  execution: {
    // Default mode when 'auto' is selected
    defaultMode: 'proxy',

    // Can the SDK call this API directly from browser?
    directSupported: false,

    // Must always go through proxy? (e.g., no CORS support)
    proxyRequired: true,

    // If direct is supported, which origins are allowed?
    corsAllowed: [],
  },

  // Authentication configuration
  auth: {
    // Type: 'oauth2' | 'api_key' | 'basic' | 'bearer' | 'custom'
    type: 'oauth2',

    // OAuth2 specific config
    oauth: {
      authorizationUrl: 'https://{shop}.myshopify.com/admin/oauth/authorize',
      tokenUrl: 'https://{shop}.myshopify.com/admin/oauth/access_token',
      revokeUrl: undefined,
      pkceRequired: false,
      scopes: ['read_products', 'read_orders'],
      // Environment variable names for credentials
      clientIdEnvVar: 'SHOPIFY_CLIENT_ID',
      clientSecretEnvVar: 'SHOPIFY_CLIENT_SECRET',
    },

    // Can tokens be refreshed?
    refreshable: false,  // Shopify tokens don't expire

    // Token lifetime (if applicable)
    expiresInSeconds: undefined,
  },

  // Rate limiting
  rateLimit: {
    requestsPerMinute: 80,
    requestsPerSecond: 2,
    burstLimit: 4,
    // How to track quota: 'per-provider' | 'per-connection' | 'per-artifact'
    quotaTracking: 'per-connection',
  },

  // Caching defaults
  cache: {
    defaultTtlSeconds: 300,      // 5 minutes
    maxTtlSeconds: 3600,         // 1 hour max
    persistable: true,           // Can store in R2/artifact_json
    userRefreshable: true,       // Users can trigger cache refresh
  },

  // API base configuration
  api: {
    baseUrl: 'https://{shop}.myshopify.com/admin/api/{version}',
    version: '2024-01',
    defaultHeaders: {
      'Content-Type': 'application/json',
    },
  },

  // Pagination style
  pagination: {
    // Type: 'cursor' | 'offset' | 'page' | 'link' | 'none'
    type: 'link',  // Shopify uses Link header
    defaultLimit: 50,
    maxLimit: 250,
    cursorField: undefined,
    nextLinkField: 'rel="next"',
  },
};
```

### Step 3: Implement Provider Class (`index.ts`)

```typescript
// src/data/platform/providers/shopify/index.ts
import { BaseProvider, type ProviderResponse } from '../base-provider';
import type {
  ProviderEndpoint,
  AuthContext,
  TokenResult,
  ExecutionContext,
  RequestParams,
  DirectCredentials,
  DecryptedCredentials,
  PageInfo,
  RateLimitInfo,
} from '../../types';
import { SHOPIFY_CONFIG } from './config';
import { registerProvider } from '../../registry';

class ShopifyProvider extends BaseProvider {
  readonly config = SHOPIFY_CONFIG;

  // Define available endpoints
  readonly endpoints = new Map<string, ProviderEndpoint>([
    ['products.list', {
      id: 'products.list',
      method: 'GET',
      path: '/products.json',
      description: 'List all products',
      cache: { ttlSeconds: 300 },
    }],
    ['products.get', {
      id: 'products.get',
      method: 'GET',
      path: '/products/{productId}.json',
      cache: { ttlSeconds: 300 },
    }],
    ['orders.list', {
      id: 'orders.list',
      method: 'GET',
      path: '/orders.json',
      cache: { ttlSeconds: 60 },
    }],
    // Add more endpoints...
  ]);

  // Build OAuth authorization URL
  async getAuthUrl(ctx: AuthContext): Promise<string> {
    const { shop } = ctx.params;  // Get shop from connection config
    const params = new URLSearchParams({
      client_id: ctx.env.SHOPIFY_CLIENT_ID,
      scope: this.config.auth.oauth!.scopes.join(','),
      redirect_uri: ctx.callbackUrl,
      state: ctx.state,
    });
    return `https://${shop}.myshopify.com/admin/oauth/authorize?${params}`;
  }

  // Exchange authorization code for tokens
  async handleCallback(ctx: AuthContext, code: string): Promise<TokenResult> {
    const { shop } = ctx.params;

    const response = await fetch(
      `https://${shop}.myshopify.com/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: ctx.env.SHOPIFY_CLIENT_ID,
          client_secret: ctx.env.SHOPIFY_CLIENT_SECRET,
          code,
        }),
      }
    );

    if (!response.ok) {
      throw new Error(`Token exchange failed: ${await response.text()}`);
    }

    const data = await response.json() as { access_token: string; scope: string };

    return {
      accessToken: data.access_token,
      scope: data.scope,
      // Shopify tokens don't expire
    };
  }

  // Refresh expired tokens (if supported)
  async refreshToken(_ctx: AuthContext, _refreshToken: string): Promise<TokenResult> {
    throw new Error('Shopify tokens do not expire');
  }

  // Prepare credentials for direct browser calls
  async prepareDirectCredentials(
    _ctx: AuthContext,
    _credentials: DecryptedCredentials
  ): Promise<DirectCredentials> {
    // Shopify doesn't support direct mode
    throw new Error('Shopify does not support direct mode');
  }

  // Execute API request
  async executeRequest<T = unknown>(
    ctx: ExecutionContext,
    endpoint: ProviderEndpoint,
    params: RequestParams
  ): Promise<ProviderResponse<T>> {
    const { shop } = ctx.connectionConfig.config as { shop: string };

    // Build URL from endpoint path
    const url = this.buildUrl(
      `https://${shop}.myshopify.com/admin/api/${this.config.api.version}`,
      endpoint,
      params
    );

    const response = await fetch(url, {
      method: endpoint.method,
      headers: {
        'X-Shopify-Access-Token': ctx.credentials.access_token,
        'Content-Type': 'application/json',
      },
      body: params.body ? JSON.stringify(params.body) : undefined,
    });

    const rateLimit = this.extractRateLimitInfo(response);

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      return {
        success: false,
        status: response.status,
        error: {
          code: `SHOPIFY_${response.status}`,
          message: error.errors || response.statusText,
        },
        rateLimit: rateLimit || undefined,
      };
    }

    const data = await response.json() as T;
    const pagination = this.extractNextPage({ headers: response.headers, data });

    return {
      success: true,
      data,
      status: response.status,
      rateLimit: rateLimit || undefined,
      pagination: pagination || undefined,
    };
  }

  // Extract pagination info from response
  extractNextPage(response: ProviderResponse): PageInfo | null {
    const linkHeader = response.headers?.get('Link');
    if (!linkHeader) return null;

    const nextMatch = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    if (!nextMatch) return null;

    return { hasMore: true, cursor: nextMatch[1] };
  }

  // Extract rate limit info from response headers
  extractRateLimitInfo(response: Response): RateLimitInfo | null {
    const callLimit = response.headers.get('X-Shopify-Shop-Api-Call-Limit');
    if (!callLimit) return null;

    const [current, max] = callLimit.split('/').map(Number);
    return {
      remaining: max - current,
      limit: max,
    };
  }
}

// Self-register when module is imported
const shopifyProvider = new ShopifyProvider();
registerProvider(shopifyProvider);

export { shopifyProvider };
export { SHOPIFY_CONFIG } from './config';
```

### Step 4: Register the Provider

Add the import to `src/data/platform/index.ts`:

```typescript
// src/data/platform/index.ts
import './providers/google-sheets';
import './providers/shopify';  // Add this line
```

### Step 5: Add Environment Variables

If your provider needs credentials, add them to:

1. **`src/types.ts`** (Env interface):
```typescript
export interface Env {
  // ... existing vars
  SHOPIFY_CLIENT_ID: string;
  SHOPIFY_CLIENT_SECRET: string;
}
```

2. **`wrangler.toml`** (for local dev):
```toml
[vars]
SHOPIFY_CLIENT_ID = "your-dev-client-id"

[secrets]
# Run: npx wrangler secret put SHOPIFY_CLIENT_SECRET
```

---

## Key Concepts

### Execution Modes

| Mode | When Used | Flow |
|------|-----------|------|
| **Direct** | Provider allows CORS | SDK gets credentials → calls API directly |
| **Proxy** | No CORS or needs server auth | SDK → ShareOut → Provider API |
| **Auto** | Let engine decide | Based on provider config & request origin |

**Direct mode benefits:**
- Reduces ShareOut backend load
- Lower latency (no proxy hop)
- SDK handles credentials securely (short-lived tokens)

**Proxy mode required when:**
- Provider doesn't support CORS
- Credentials can't be exposed to browser
- Need server-side processing/transformation

### Caching Strategy

**Two-layer cache:**

1. **Memory (fast):** In-worker memory, cleared on restart
2. **Persisted (durable):** `artifact_json` table or R2

```
Request → Check Memory Cache
           ├─ HIT → Return immediately
           └─ MISS → Check Persisted Cache
                      ├─ HIT → Hydrate memory, return
                      └─ MISS → Fetch from provider, cache both
```

**Cache keys:** `{provider}:{endpoint}:{queryHash}`

**User refresh:** `POST /platform/cache/refresh` invalidates user-refreshable cache entries.

### Rate Limiting

Per-provider sliding window rate limiting:

```typescript
rateLimit: {
  requestsPerMinute: 300,  // Main limit
  requestsPerSecond: 10,   // Burst protection
  quotaTracking: 'per-connection',  // Track per connection
}
```

Tracking modes:
- `per-provider`: Shared across all artifacts
- `per-connection`: Per connection instance
- `per-artifact`: Per artifact using the provider

### Credential Management

Credentials are encrypted with AES-GCM and stored in `connections`:

```sql
CREATE TABLE connections (
  id TEXT PRIMARY KEY,
  scope_type TEXT NOT NULL,   -- 'artifact' | 'workspace'
  scope_id TEXT NOT NULL,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  config TEXT NOT NULL,          -- JSON: provider-specific config
  encrypted_credentials TEXT,    -- AES-GCM encrypted tokens
  iv TEXT,                       -- Initialization vector
  preferred_mode TEXT,           -- 'direct' | 'proxy' | 'auto'
  created_at TEXT,
  updated_at TEXT
);
```

---

## API Endpoints

### Connection Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/platform/connections` | GET | List all connections |
| `/platform/connections` | POST | Create connection |
| `/platform/connections/{name}` | GET | Get connection details |
| `/platform/connections/{name}` | DELETE | Delete connection |

### Provider Operations

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/platform/providers` | GET | List registered providers |
| `/platform/{provider}` | GET | Get provider config & endpoints |
| `/platform/{provider}/auth-url` | GET | Get OAuth URL |
| `/platform/{provider}/callback` | GET | OAuth callback handler |
| `/platform/{provider}/prepare` | POST | Get credentials for direct mode |
| `/platform/{provider}/{endpoint}/execute` | POST | Execute via proxy |

### Cache Management

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/platform/cache/status` | GET | Get cache statistics |
| `/platform/cache/refresh` | POST | Invalidate cache |

---

## Testing Your Provider

### 1. Create a Test Connection

```bash
curl -X POST "https://shareout.site/v1/data/{artifactId}/platform/connections" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "my-shopify-store",
    "provider": "shopify",
    "config": { "shop": "my-store" },
    "credentials": {
      "access_token": "shpat_xxx"
    }
  }'
```

### 2. Execute a Request

```bash
curl -X POST "https://shareout.site/v1/data/{artifactId}/platform/shopify/products.list/execute" \
  -H "Authorization: Bearer {token}" \
  -H "Content-Type: application/json" \
  -d '{
    "connectionId": "conn_xxx",
    "params": {
      "queryParams": { "limit": 10 }
    }
  }'
```

### 3. Check Response Format

```json
{
  "success": true,
  "data": { "products": [...] },
  "meta": {
    "provider": "shopify",
    "endpoint": "products.list",
    "executionMode": "proxy",
    "cached": false,
    "executionTimeMs": 234
  },
  "pagination": {
    "hasMore": true,
    "cursor": "https://..."
  },
  "rateLimit": {
    "remaining": 38,
    "limit": 40
  }
}
```

---

## Common Patterns

### OAuth Providers (Google, Meta, Shopify)

```typescript
auth: {
  type: 'oauth2',
  oauth: { ... },
  refreshable: true,
}
```

### API Key Providers (OpenAI, Stripe)

```typescript
auth: {
  type: 'api_key',
  apiKey: {
    headerName: 'Authorization',
    prefix: 'Bearer ',
  },
  refreshable: false,
}
```

### Providers with Direct Mode (Google Sheets)

```typescript
execution: {
  defaultMode: 'direct',
  directSupported: true,
  proxyRequired: false,
  corsAllowed: [],  // Empty = all origins
}
```

### Providers Requiring Proxy (Shopify, most APIs)

```typescript
execution: {
  defaultMode: 'proxy',
  directSupported: false,
  proxyRequired: true,
  corsAllowed: [],
}
```

---

## Checklist for New Providers

- [ ] Create `providers/{name}/config.ts` with `ProviderConfig`
- [ ] Create `providers/{name}/index.ts` extending `BaseProvider`
- [ ] Implement all abstract methods:
  - [ ] `getAuthUrl()` - OAuth URL generation
  - [ ] `handleCallback()` - Token exchange
  - [ ] `refreshToken()` - Token refresh (or throw if not supported)
  - [ ] `prepareDirectCredentials()` - For direct mode (or throw)
  - [ ] `executeRequest()` - API request execution
  - [ ] `extractNextPage()` - Pagination parsing
  - [ ] `extractRateLimitInfo()` - Rate limit header parsing
- [ ] Define all endpoints in `endpoints` Map
- [ ] Call `registerProvider()` at module load
- [ ] Import provider in `src/data/platform/index.ts`
- [ ] Add env vars to `src/types.ts` and `wrangler.toml`
- [ ] Test OAuth flow end-to-end
- [ ] Test API request execution
- [ ] Verify caching works correctly
- [ ] Check rate limiting headers are parsed

---

## Troubleshooting

### Provider not found

Ensure the provider is imported in `src/data/platform/index.ts`:
```typescript
import './providers/your-provider';
```

### OAuth callback fails

Check:
1. Callback URL matches registered app URL
2. State parameter is correctly encoded/decoded
3. Environment variables are set

### Rate limiting not working

Verify `extractRateLimitInfo()` parses the provider's headers correctly.

### Direct mode not working

1. Check `directSupported: true` in config
2. Verify `prepareDirectCredentials()` returns valid credentials
3. Ensure provider's CORS allows the request origin
