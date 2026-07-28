# Tienda Nube Integration - Technical Documentation

## Overview

ShareOut provides a fully managed Tienda Nube (Nuvemshop) integration that allows published HTML artifacts to read from and write to Tienda Nube stores without requiring users to manage API keys or create their own apps.

**Key Features:**
- One-click OAuth authorization via popup
- Full Tienda Nube REST API access (products, orders, customers, categories, coupons)
- Per-connection token storage (encrypted)
- Smart caching with configurable TTL per endpoint
- Automatic rate limit tracking per connection
- Proxy-only execution (no CORS issues)
- Multi-region support (Argentina/LATAM & Brazil)

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
│  │  - sdk.platform.execute()    → Calls Tienda Nube API (proxied)   │    │
│  │  - sdk.platform.connections()→ List connected stores             │    │
│  └─────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                      ShareOut Worker (Cloudflare)                        │
├─────────────────────────────────────────────────────────────────────────┤
│  /v1/data/{artifactId}/platform/tiendanube/*                             │
│  ┌─────────────────────────────────────────────────────────────────┐    │
│  │  Data Platform Engine (src/data/platform/)                       │    │
│  │  ├── Provider Registry → TiendanubeProvider                      │    │
│  │  ├── OAuth flow management                                       │    │
│  │  ├── Credential encryption/decryption (AES-GCM)                  │    │
│  │  ├── Rate limiter (per-connection tracking)                      │    │
│  │  ├── Cache layer (memory + artifact_json table)                  │    │
│  │  └── Request execution (proxy to Tienda Nube)                    │    │
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
│                        Tienda Nube REST API                              │
│  https://api.tiendanube.com/2025-03/{store_id}/  (Argentina/LATAM)       │
│  https://api.nuvemshop.com.br/2025-03/{store_id}/ (Brazil)               │
│  - Using ShareOut's Tienda Nube Partner App OAuth credentials            │
│  - Scopes: read_products, write_products, read_orders, etc.              │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## OAuth Flow

### First-Time Connection

```
1. User clicks "Connect Tienda Nube"
   │
   ▼
2. SDK calls GET /v1/data/{artifactId}/platform/tiendanube/auth-url?connection={name}
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
4. SDK opens popup window to Tienda Nube OAuth:
   https://www.tiendanube.com/apps/{app_id}/authorize?state={encoded_state}
   │
   ▼
5. User logs into Tienda Nube, authorizes the app
   │
   ▼
6. Tienda Nube redirects to /v1/data/{artifactId}/platform/tiendanube/callback
   with code parameter
   │
   ▼
7. Handler exchanges code for access token:
   POST https://www.tiendanube.com/apps/authorize/token
   {
     client_id: "...",
     client_secret: "...",
     grant_type: "authorization_code",
     code: "..."
   }
   │
   ▼
8. Token response includes user_id (store_id):
   {
     access_token: "...",
     token_type: "bearer",
     scope: "...",
     user_id: 12345678
   }
   │
   ▼
9. Access token encrypted with AES-GCM and stored in connections (scope_type='artifact', kind='platform')
   with store_id in config
   │
   ▼
10. Callback page sends postMessage to parent window
    │
    ▼
11. SDK receives message, resolves connect() promise
```

### Token Characteristics

- **Lifetime:** Tienda Nube access tokens do NOT expire (permanent until new token or uninstall)
- **No refresh needed:** Tokens remain valid indefinitely
- **Revocation:** Users can revoke via Tienda Nube Admin → Apps → Uninstall

---

## Provider Configuration

### Configuration (src/data/platform/providers/tiendanube/config.ts)

```typescript
export const TIENDANUBE_CONFIG: ProviderConfig = {
  id: 'tiendanube',
  name: 'Tienda Nube',
  version: '2025-03',

  execution: {
    defaultMode: 'proxy',
    directSupported: false,    // No CORS support
    proxyRequired: true,
    corsAllowed: [],
  },

  auth: {
    type: 'oauth2',
    oauth: {
      authorizationUrl: 'https://www.tiendanube.com/apps/{app_id}/authorize',
      tokenUrl: 'https://www.tiendanube.com/apps/authorize/token',
      scopes: [
        'read_products', 'write_products',
        'read_orders', 'write_orders',
        'read_customers', 'write_customers',
        'read_coupons',
      ],
      clientIdEnvVar: 'TIENDANUBE_CLIENT_ID',
      clientSecretEnvVar: 'TIENDANUBE_CLIENT_SECRET',
    },
    refreshable: false,        // Tokens don't expire
  },

  rateLimit: {
    requestsPerMinute: 80,
    requestsPerSecond: 2,
    burstLimit: 40,            // Leaky bucket capacity
    quotaTracking: 'per-connection',
  },

  cache: {
    defaultTtlSeconds: 300,    // 5 minutes
    maxTtlSeconds: 3600,
    persistable: true,
    userRefreshable: true,
  },

  pagination: {
    type: 'page',              // Uses page/per_page params
    defaultLimit: 30,
    maxLimit: 200,
  },
};
```

---

## Available Endpoints

### Products

| Endpoint ID | Method | Path | Cache TTL | Description |
|-------------|--------|------|-----------|-------------|
| `products.list` | GET | /products | 5 min | List all products |
| `products.get` | GET | /products/{id} | 5 min | Get single product |
| `products.getBySku` | GET | /products/sku/{sku} | 5 min | Find by SKU |
| `products.create` | POST | /products | - | Create product |
| `products.update` | PUT | /products/{id} | - | Update product |
| `products.delete` | DELETE | /products/{id} | - | Delete product |
| `products.bulkUpdate` | PATCH | /products/stock-price | - | Bulk update (50 max) |

### Product Variants

| Endpoint ID | Method | Path | Cache TTL | Description |
|-------------|--------|------|-----------|-------------|
| `variants.list` | GET | /products/{product_id}/variants | 5 min | List variants |
| `variants.get` | GET | /products/{product_id}/variants/{id} | 5 min | Get variant |
| `variants.create` | POST | /products/{product_id}/variants | - | Create variant |
| `variants.update` | PUT | /products/{product_id}/variants/{id} | - | Update variant |
| `variants.delete` | DELETE | /products/{product_id}/variants/{id} | - | Delete variant |

### Orders

| Endpoint ID | Method | Path | Cache TTL | Description |
|-------------|--------|------|-----------|-------------|
| `orders.list` | GET | /orders | 1 min | List orders |
| `orders.get` | GET | /orders/{id} | 1 min | Get single order |
| `orders.create` | POST | /orders | - | Create order |
| `orders.update` | PUT | /orders/{id} | - | Update order |
| `orders.close` | POST | /orders/{id}/close | - | Archive order |
| `orders.open` | POST | /orders/{id}/open | - | Reopen order |
| `orders.cancel` | POST | /orders/{id}/cancel | - | Cancel order |
| `fulfillments.list` | GET | /orders/{order_id}/fulfillment_orders | 1 min | Fulfillment orders |

### Customers

| Endpoint ID | Method | Path | Cache TTL | Description |
|-------------|--------|------|-----------|-------------|
| `customers.list` | GET | /customers | 5 min | List customers |
| `customers.get` | GET | /customers/{id} | 5 min | Get customer |
| `customers.create` | POST | /customers | - | Create customer |
| `customers.update` | PUT | /customers/{id} | - | Update customer |
| `customers.delete` | DELETE | /customers/{id} | - | Delete customer |

### Categories

| Endpoint ID | Method | Path | Cache TTL | Description |
|-------------|--------|------|-----------|-------------|
| `categories.list` | GET | /categories | 5 min | List categories |
| `categories.get` | GET | /categories/{id} | 5 min | Get category |
| `categories.create` | POST | /categories | - | Create category |
| `categories.update` | PUT | /categories/{id} | - | Update category |
| `categories.delete` | DELETE | /categories/{id} | - | Delete category |

### Coupons

| Endpoint ID | Method | Path | Cache TTL | Description |
|-------------|--------|------|-----------|-------------|
| `coupons.list` | GET | /coupons | 5 min | List coupons |
| `coupons.get` | GET | /coupons/{id} | 5 min | Get coupon |
| `coupons.create` | POST | /coupons | - | Create coupon |
| `coupons.update` | PUT | /coupons/{id} | - | Update coupon |
| `coupons.delete` | DELETE | /coupons/{id} | - | Delete coupon |

### Other

| Endpoint ID | Method | Path | Cache TTL | Description |
|-------------|--------|------|-----------|-------------|
| `store.get` | GET | /store | 1 hour | Get store info |
| `webhooks.list` | GET | /webhooks | 1 min | List webhooks |
| `webhooks.create` | POST | /webhooks | - | Create webhook |
| `webhooks.delete` | DELETE | /webhooks/{id} | - | Delete webhook |
| `locations.list` | GET | /locations | 10 min | List inventory locations |

---

## Request/Response Examples

### Connect Store (OAuth)

**Step 1: Get Auth URL**
```http
GET /v1/data/art_abc123/platform/tiendanube/auth-url?connection=my-store

Response:
{
  "authUrl": "https://www.tiendanube.com/apps/123456/authorize?state=eyJ..."
}
```

**Step 2: User completes OAuth in popup**

**Step 3: Callback creates connection automatically**

### List Products

**Request:**
```http
POST /v1/data/art_abc123/platform/tiendanube/products.list/execute
Content-Type: application/json

{
  "connectionId": "conn_xxxxxxxxxxxx",
  "params": {
    "queryParams": {
      "per_page": 50,
      "page": 1
    }
  }
}
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": 12345678,
      "name": { "es": "Camiseta Clásica" },
      "handle": { "es": "camiseta-clasica" },
      "variants": [
        { "id": 87654321, "price": "29.99", "sku": "TSHIRT-001" }
      ]
    }
  ],
  "meta": {
    "provider": "tiendanube",
    "endpoint": "products.list",
    "executionMode": "proxy",
    "cached": false,
    "executionTimeMs": 234
  },
  "pagination": {
    "hasMore": true,
    "cursor": "2",
    "total": 150
  },
  "rateLimit": {
    "remaining": 38,
    "limit": 40
  }
}
```

### Get Single Order

**Request:**
```http
POST /v1/data/art_abc123/platform/tiendanube/orders.get/execute
Content-Type: application/json

{
  "connectionId": "conn_xxxxxxxxxxxx",
  "params": {
    "pathParams": { "id": 98765432 }
  }
}
```

### Create Product

**Request:**
```http
POST /v1/data/art_abc123/platform/tiendanube/products.create/execute
Content-Type: application/json

{
  "connectionId": "conn_xxxxxxxxxxxx",
  "params": {
    "body": {
      "name": { "es": "Nuevo Producto" },
      "description": { "es": "<p>Descripción aquí</p>" },
      "variants": [
        { "price": "49.99", "sku": "NEW-001", "stock": 100 }
      ]
    }
  }
}
```

### Paginate Through Results

**First request:**
```http
POST /platform/tiendanube/products.list/execute
{
  "connectionId": "conn_xxx",
  "params": { "queryParams": { "per_page": 200 } }
}
```

**Subsequent requests (using page number):**
```http
POST /platform/tiendanube/products.list/execute
{
  "connectionId": "conn_xxx",
  "params": {
    "queryParams": { "per_page": 200, "page": 2 }
  }
}
```

---

## SDK Reference

### Platform Methods

```typescript
class ShareOut {
  platform: {
    connections(provider?: string): Promise<Connection[]>
    connect(options: ConnectOptions): Promise<boolean>
    createConnection(options: CreateConnectionOptions): Promise<{ id: string }>
    deleteConnection(name: string): Promise<void>
    isConnected(provider: string): Promise<boolean>
    execute<T>(options: ExecuteOptions): Promise<PlatformResponse<T>>
  }
}

interface ConnectOptions {
  provider: 'tiendanube';
  name: string;           // Connection name (e.g., "my-store")
}

interface ExecuteOptions {
  provider: 'tiendanube';
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
```

---

## Multi-Region Support

Tienda Nube operates in two regions with different API endpoints:

| Region | Countries | API Host |
|--------|-----------|----------|
| Argentina/LATAM | Argentina, Mexico, Chile, etc. | `api.tiendanube.com` |
| Brazil | Brazil | `api.nuvemshop.com.br` |

The region is stored in the connection config and defaults to Argentina. Set `region: 'br'` in config for Brazilian stores.

---

## Rate Limits & Quotas

### Tienda Nube API Limits

Tienda Nube uses a "leaky bucket" algorithm:

| Limit | Value |
|-------|-------|
| Bucket size | 40 requests |
| Leak rate | 2 requests/second |
| Effective rate | ~2 requests/second |
| Higher-tier multiplier | 10x (Next/Evolution plans) |

### Response Headers

```
x-rate-limit-limit: 40
x-rate-limit-remaining: 35
x-rate-limit-reset: 1234567890
```

### ShareOut Rate Limit Tracking

ShareOut tracks rate limits per-connection:

```typescript
rateLimit: {
  remaining: 35,
  limit: 40,
  resetAt: 1234567890000  // Unix timestamp in ms
}
```

---

## Error Codes

| Code | HTTP | Description | Resolution |
|------|------|-------------|------------|
| `PROVIDER_NOT_FOUND` | 404 | Provider not registered | Check provider import |
| `CONNECTION_NOT_FOUND` | 404 | Connection doesn't exist | Create connection first |
| `MISSING_STORE_ID` | 400 | Store ID not in connection config | Reconnect via OAuth |
| `TIENDANUBE_401` | 401 | Invalid/expired access token | Reconnect via OAuth |
| `TIENDANUBE_402` | 402 | Store subscription unpaid | User must pay subscription |
| `TIENDANUBE_403` | 403 | Missing required scopes | Reinstall app with correct scopes |
| `TIENDANUBE_404` | 404 | Resource not found | Check resource ID |
| `TIENDANUBE_422` | 422 | Invalid request data | Check request body |
| `TIENDANUBE_429` | 429 | Rate limit exceeded | Wait and retry |

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/data/platform/providers/tiendanube/config.ts` | Provider configuration |
| `src/data/platform/providers/tiendanube/index.ts` | Provider implementation |
| `src/data/platform/index.ts` | Platform request router |
| `src/data/platform/core/engine.ts` | Execution orchestrator |
| `src/data/platform/core/credentials.ts` | Token encryption & storage |

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `TIENDANUBE_CLIENT_ID` | Yes | OAuth app ID from Tienda Nube Partners |
| `TIENDANUBE_CLIENT_SECRET` | Yes | OAuth app secret |
| `CREDENTIALS_KEY` | Yes | 32-byte key for AES-GCM encryption |
| `SHAREOUT_BASE_URL` | Yes | Base URL for OAuth redirects |

### Setting Up Tienda Nube Credentials

1. Create a [Tienda Nube Partner account](https://partners.tiendanube.com)
2. Create a new app in Partner Dashboard
3. Set **App URL:** `https://shareout.site`
4. Set **Redirect URL:** `https://shareout.site/v1/data/*/platform/tiendanube/callback`
5. Select API scopes: `read_products`, `write_products`, `read_orders`, `read_customers`
6. Copy App ID and App Secret
7. Add to Cloudflare:
   ```bash
   npx wrangler secret put TIENDANUBE_CLIENT_ID
   npx wrangler secret put TIENDANUBE_CLIENT_SECRET
   ```

---

## Comparison with Shopify

| Aspect | Shopify | Tienda Nube |
|--------|---------|-------------|
| Auth URL | Per-shop (`{shop}.myshopify.com`) | Central (`tiendanube.com/apps/{app_id}`) |
| Token URL | Per-shop | Central (`tiendanube.com/apps/authorize/token`) |
| Store ID | In URL subdomain | From token response (`user_id`) |
| API base | `{shop}.myshopify.com/admin/api/{version}` | `api.tiendanube.com/{version}/{store_id}` |
| Rate limit header | `X-Shopify-Shop-Api-Call-Limit` | `x-rate-limit-remaining` |
| Pagination | Link header with `page_info` cursor | `page`/`per_page` params |
| Regions | Single global API | Argentina/LATAM & Brazil |

---

## Webhook Events

Available webhook events for real-time notifications:

### Orders
- `order/created`, `order/updated`, `order/paid`
- `order/packed`, `order/fulfilled`, `order/cancelled`

### Products
- `product/created`, `product/updated`, `product/deleted`

### Customers
- `customer/created`, `customer/updated`, `customer/deleted`

### Categories
- `category/created`, `category/updated`, `category/deleted`

### App
- `app/uninstalled`, `app/suspended`, `app/resumed`

### Required (LGPD Compliance)
- `store/redact` - Delete merchant data after uninstall
- `customers/redact` - Remove consumer data per LGPD
- `customers/data_request` - Provide customer data
