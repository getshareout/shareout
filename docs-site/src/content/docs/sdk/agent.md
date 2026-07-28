---
title: Agent store
description: In-artifact AI chat assistant powered by Claude, with streaming responses and a pre-built widget.
---

import { Aside } from '@astrojs/starlight/components';

Add a Claude-powered chat assistant to any artifact. Access via `sdk.agent`.

<Aside type="caution">
The agent is **off by default**. `configure()` runs with the visitor's session and cannot enable it. Enable via the `agent` block at publish time or via `PUT /v1/data/{artifactId}/agent/config` (owner token).
</Aside>

## Enable the agent

At publish time, add an `agent` block to the publish payload:

```json
{
  "name": "My Dashboard",
  "files": [...],
  "agent": {
    "enabled": true,
    "systemPrompt": "You are a data analyst. Answer only from the data provided.",
    "model": "claude-sonnet-4-20250514",
    "contextJson": true,
    "contextTables": ["sales"]
  }
}
```

Or after publish via API (owner token):

```http
PUT /v1/data/{artifactId}/agent/config
Content-Type: application/json

{
  "visitor_enabled": true,
  "visitor_system_prompt": "You are a helpful assistant.",
  "visitor_model": "claude-sonnet-4-20250514",
  "visitor_context_tables": ["sales"]
}
```

Partial `PUT` bodies are safe — omitted fields keep their existing values, so you can toggle one setting without resending the full config.

## Methods

```typescript
configure(config: AgentConfig): void
chat(options: ChatMessage): AsyncGenerator<ChatChunk>

// Conversation management
conversations.list(options?: { limit?: number; offset?: number }):
  Promise<{ conversations: Conversation[]; total: number }>
conversations.get(id: string):
  Promise<{ conversation: Conversation; messages: unknown[] }>
conversations.delete(id: string): Promise<{ deleted: boolean }>

// Pre-built widget
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
  context?: Record<string, unknown>; // Live page data for this turn (~200 KB cap)
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
In visitor mode, `systemPrompt`, `model`, and `temperature` in `configure()` are ignored — those come from the server config only. Use `chat({ context })` to inject live data per turn.
</Aside>

## Examples

### Pre-built widget

```javascript
const sdk = await ShareOut.create();

sdk.agent.widget.mount('#chat', {
  position: 'bottom-right',
  theme: 'auto',
  welcomeMessage: 'Hi! How can I help?',
});
```

### Custom streaming UI

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

### Live data context (dashboards)

Pass a snapshot of on-screen state each turn so the agent answers from current data, not just stored tables:

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

## Rate limits

| Limit | Default |
|-------|---------|
| Requests/min | 10 per artifact |
| Tokens/day | 100,000 per artifact |

Exceeded returns HTTP 429 with `Retry-After` header and error code `RATE_LIMIT_EXCEEDED`.
