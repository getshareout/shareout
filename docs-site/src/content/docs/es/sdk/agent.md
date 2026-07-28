---
title: Agent store
description: Asistente de chat con IA dentro de un artifact, con respuestas en streaming y un widget pre-construido.
---

import { Aside } from '@astrojs/starlight/components';

Agregá un asistente de chat con Claude a cualquier artifact. Accedé vía `sdk.agent`.

<Aside type="caution">
El agente está **deshabilitado por defecto**. `configure()` corre con la sesión del visitante y no puede habilitarlo. Habilitalo a través del bloque `agent` al publicar, o con `PUT /v1/data/{artifactId}/agent/config` (token del owner).
</Aside>

## Habilitar el agente

Al publicar, incluí un bloque `agent` en el payload:

```json
{
  "name": "Mi Dashboard",
  "files": [...],
  "agent": {
    "enabled": true,
    "systemPrompt": "Sos un analista de datos. Respondé solo con los datos provistos.",
    "model": "claude-sonnet-4-20250514",
    "contextJson": true,
    "contextTables": ["sales"]
  }
}
```

O después de publicar, vía API (token del owner):

```http
PUT /v1/data/{artifactId}/agent/config
Content-Type: application/json

{
  "visitor_enabled": true,
  "visitor_system_prompt": "Sos un asistente útil.",
  "visitor_model": "claude-sonnet-4-20250514",
  "visitor_context_tables": ["sales"]
}
```

Los `PUT` parciales son seguros — los campos omitidos conservan sus valores existentes, así que podés cambiar un ajuste sin reenviar toda la configuración.

## Métodos

```typescript
configure(config: AgentConfig): void
chat(options: ChatMessage): AsyncGenerator<ChatChunk>

// Manejo de conversaciones
conversations.list(options?: { limit?: number; offset?: number }):
  Promise<{ conversations: Conversation[]; total: number }>
conversations.get(id: string):
  Promise<{ conversation: Conversation; messages: unknown[] }>
conversations.delete(id: string): Promise<{ deleted: boolean }>

// Widget pre-construido
widget.mount(selector: string, options?: WidgetOptions): void
widget.unmount(): void
widget.toggle(): void
widget.setTheme(theme: 'light' | 'dark' | 'auto'): void
```

```typescript
interface AgentConfig {
  systemPrompt?: string;
  model?: 'claude-sonnet-4-20250514' | 'claude-3-5-haiku-20241022';
  maxTokens?: number;
  temperature?: number;
  context?: { json?: boolean; tables?: string[]; blobs?: boolean };
}

interface ChatMessage {
  message: string;
  conversationId?: string;
  context?: Record<string, unknown>; // datos en vivo para este turno (~200 KB máx)
}

interface ChatChunk {
  type: 'content' | 'done' | 'error';
  content?: string;
  conversationId?: string;
  usage?: { input_tokens: number; output_tokens: number };
  error?: string;
}

interface WidgetOptions {
  position?: 'bottom-right' | 'bottom-left' | 'inline';
  theme?: 'light' | 'dark' | 'auto';
  placeholder?: string;
  welcomeMessage?: string;
  minimized?: boolean;
}
```

<Aside type="note">
En modo visitante, `systemPrompt`, `model` y `temperature` en `configure()` son ignorados — esos valores vienen del server config. Usá `chat({ context })` para inyectar datos en vivo por turno.
</Aside>

## Ejemplos

### Widget pre-construido

```javascript
const sdk = await ShareOut.create();

sdk.agent.widget.mount('#chat', {
  position: 'bottom-right',
  theme: 'auto',
  welcomeMessage: '¡Hola! ¿En qué te puedo ayudar?',
});
```

### UI de streaming personalizada

```javascript
const sdk = await ShareOut.create();
let conversationId = null;

async function send(text) {
  let reply = '';
  for await (const chunk of sdk.agent.chat({
    message: text,
    conversationId,
  })) {
    if (chunk.type === 'content') {
      reply += chunk.content;
      output.textContent = reply;
    } else if (chunk.type === 'done') {
      conversationId = chunk.conversationId;
    }
  }
}
```

### Contexto de datos en vivo (dashboards)

Pasá un snapshot del estado de la pantalla en cada turno para que el agente responda con los datos actuales, no solo los almacenados:

```javascript
function snapshot() {
  return { filters: activeFilters, kpis: computedKpis, series: chartRows };
}

for await (const chunk of sdk.agent.chat({
  message: userText,
  context: snapshot(),
})) {
  if (chunk.type === 'content') append(chunk.content);
}
```

## Límites de uso

| Límite | Por defecto |
|--------|-------------|
| Requests/min | 10 por artifact |
| Tokens/día | 100.000 por artifact |

Si se supera, retorna HTTP 429 con header `Retry-After` y código `RATE_LIMIT_EXCEEDED`.
