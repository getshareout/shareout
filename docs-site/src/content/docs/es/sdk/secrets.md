---
title: Secrets proxy
description: Llamá a APIs externas desde un artifact sin exponer claves de API en el navegador.
---

import { Aside } from '@astrojs/starlight/components';

Proxy de requests HTTP a través del worker de ShareOut para que las claves de API nunca lleguen al navegador. Accedé vía `sdk.secrets`.

Los secrets los crea el owner del artifact (vía dashboard o API) y se almacenan cifrados en el servidor. El navegador envía requests al worker; el worker inyecta la clave y las reenvía al host destino.

## Métodos

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

## Configuración

Creá un secret (solo owner):

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

Opciones de `injectionType`: `bearer` (header Authorization), `header` (header personalizado), `query` (query parameter).

## Ejemplos

### OpenAI

```javascript
const sdk = await ShareOut.create();

const response = await sdk.secrets.post('openai', '/v1/chat/completions', {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: '¡Hola!' }],
});
console.log(response.choices[0].message.content);
```

### Anthropic

```javascript
const response = await sdk.secrets.post('anthropic', '/v1/messages', {
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: '¡Hola!' }],
});
console.log(response.content[0].text);
```

### GET con query params

```javascript
const data = await sdk.secrets.get('my-api', '/v1/items', { status: 'active' });
```

### Proxy de bajo nivel (streaming)

Para respuestas en streaming, llamá al endpoint proxy directamente y manejá SSE de forma manual:

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
// parsear SSE desde response.body
```

## Configuraciones de providers comunes

| Provider | Host | `injectionType` | Notas |
|----------|------|-----------------|-------|
| OpenAI | `api.openai.com` | `bearer` | — |
| Anthropic | `api.anthropic.com` | `header` | `headerName: x-api-key` |
| Google AI | `generativelanguage.googleapis.com` | `query` | parámetro `key` |
| Groq | `api.groq.com` | `bearer` | — |
| Mistral | `api.mistral.ai` | `bearer` | — |

<Aside type="tip">
Las claves se cifran en reposo (AES-256). Las allowlists de hosts y los patrones de paths evitan el filtrado de credenciales. Los rate limits son configurables por secret (por defecto: 60 req/min).
</Aside>
