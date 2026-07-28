---
title: Secrets proxy
description: Call external APIs from an artifact without exposing API keys in browser code.
---

import { Aside } from '@astrojs/starlight/components';

Proxy HTTP requests through the ShareOut worker so API keys never reach the browser. Access via `sdk.secrets`.

Secrets are created by the artifact owner (via dashboard or API) and stored encrypted server-side. The browser sends requests to the worker; the worker injects the key and forwards to the target host.

## Methods

```typescript
proxy<T>(secretName: string, options: ProxyOptions): Promise<ProxyResult<T>>
get<T>(secretName: string, path: string, query?: Record<string, string>): Promise<T>
post<T>(secretName: string, path: string, body?: unknown, headers?: Record<string, string>): Promise<T>
put<T>(secretName: string, path: string, body?: unknown): Promise<T>
delete<T>(secretName: string, path: string): Promise<T>
```

```typescript
interface ProxyOptions {
  method?: string;
  path: string;
  body?: unknown;
  headers?: Record<string, string>;
  query?: Record<string, string>;
}

interface ProxyResult<T = unknown> {
  data: T;
  status: number;
  executionTimeMs: number;
}
```

## Setup

Create a secret (owner only):

```http
POST /v1/data/{artifactId}/secrets
Content-Type: application/json

{
  "name": "openai",
  "allowedHosts": ["api.openai.com"],
  "allowedMethods": ["POST"],
  "allowedPaths": ["/v1/chat/completions", "/v1/embeddings"],
  "injectionType": "bearer",
  "credentials": { "value": "sk-..." }
}
```

`injectionType` options: `bearer` (Authorization header), `header` (custom header name), `query` (query parameter).

## Examples

### OpenAI

```javascript
const sdk = await ShareOut.create();

const response = await sdk.secrets.post('openai', '/v1/chat/completions', {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.choices[0].message.content);
```

### Anthropic

```javascript
const response = await sdk.secrets.post('anthropic', '/v1/messages', {
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(response.content[0].text);
```

### GET with query params

```javascript
const data = await sdk.secrets.get('my-api', '/v1/items', { status: 'active' });
```

### Low-level proxy (streaming)

For streaming responses, call the proxy endpoint directly and handle SSE manually:

```javascript
const response = await fetch(
  `${sdk._baseUrl}/v1/data/${sdk._artifactId}/secrets/openai/proxy`,
  {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      path: '/v1/chat/completions',
      body: { model: 'gpt-4o', messages: [{ role: 'user', content: prompt }], stream: true },
    }),
  }
);
// parse SSE from response.body
```

## Common provider configs

| Provider | Host | `injectionType` | Notes |
|----------|------|-----------------|-------|
| OpenAI | `api.openai.com` | `bearer` | — |
| Anthropic | `api.anthropic.com` | `header` | `headerName: x-api-key` |
| Google AI | `generativelanguage.googleapis.com` | `query` | `key` param |
| Groq | `api.groq.com` | `bearer` | — |
| Mistral | `api.mistral.ai` | `bearer` | — |

<Aside type="tip">
Keys are encrypted at rest (AES-256). Host allowlists and path patterns prevent credential leakage. Rate limits are configurable per secret (default: 60 req/min).
</Aside>
