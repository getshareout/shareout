# AI Chat Agent Reference

Add AI-powered chat assistants to your ShareOut artifacts. The agent uses Claude models and can access your artifact's data for context-aware responses.

> **Account-level Telegram bot:** users can also chat with their pages from Telegram after linking in Settings. That is a separate, cross-artifact assistant — see [telegram.md](telegram.md). This file covers the **in-artifact** `sdk.agent` widget only.

## Quick start (read this first)

Getting a working visitor chat agent takes **two** things — a common mistake is doing only the second and getting a `403 "Agent not enabled for this artifact"`:

**1. Enable the agent (owner action).** The agent is **off by default**. `sdk.agent.configure()` in the page does **not** enable it (it only sets client options, and it runs with the *visitor's* session so it can't change server config). Enable it one of two ways:

- **At publish time (easiest)** — add an `agent` block to the publish payload:
  ```jsonc
  {
    "name": "My Dashboard",
    "files": [ /* ... */ ],
    "agent": {
      "enabled": true,
      "systemPrompt": "You are a data analyst for this dashboard. Answer only from the data provided.",
      "model": "claude-sonnet-4-20250514",   // optional
      "contextJson": false,                    // optional: skip sdk.json if you feed live data
      "contextTables": ["sales"]               // optional: auto-include these tables
    }
  }
  ```
- **Or via the config API** (owner token): `PUT /v1/data/{artifactId}/agent/config` with `{ "visitor_enabled": true, "visitor_system_prompt": "...", "visitor_model": "..." }`.

**2. Add chat to the page.** Mount the widget, or build custom UI with `sdk.agent.chat()` (below).

> **System prompt & model live in the server config** (the `agent` block / PUT above), not in `sdk.agent.configure()`. For visitor mode, `configure()`'s `systemPrompt`/`model` are intentionally ignored — only the owner-set server config applies (so a visitor can't rewrite the prompt from the console). Use `configure()` for the pre-built widget; use **`chat({ context })`** to feed live data (next section).

## Feeding live / external data (dashboards, warehouse queries)

The built-in context only auto-includes **`sdk.json` + declared tables**. If your data is live (a BigQuery/REST query, computed state, current filters), pass it per message via **`context`** — it's injected into the model's view of that turn as a "Live page data" block, so the agent answers from exactly what's on screen. Re-send the freshest snapshot each turn; the stored chat history stays clean (only the current turn carries data).

```javascript
const sdk = await ShareOut.create();

// Build a compact snapshot of whatever is currently displayed.
function snapshot() {
  return {
    filters: currentFilters,          // e.g. { brand: 'northwind', window: 90 }
    kpis: computedKpis,               // summary numbers
    series: dailyRows,                // the data behind the charts
  };
}

for await (const chunk of sdk.agent.chat({ message: userText, context: snapshot() })) {
  if (chunk.type === 'content') append(chunk.content);
}
```

Keep the snapshot reasonably small (the server caps injected context at ~200KB). For data that lives in `sdk.json`/tables, set `contextJson`/`contextTables` in the config instead and skip `context`.

## SDK Interface

### `sdk.agent.configure(config)`

Client-side options for the pre-built widget. **For visitor mode, `systemPrompt`/`model`/`temperature` here are ignored** — those are owner config (set the `agent` block at publish time or `PUT /agent/config`; see [Quick start](#quick-start-read-this-first)). To feed live data, use `chat({ context })`, not `configure`.

```typescript
sdk.agent.configure({
  systemPrompt?: string,          // widget only; visitor prompt comes from server config
  model?: 'claude-sonnet-4-20250514' | 'claude-3-5-haiku-20241022',
  maxTokens?: number,             // Max response tokens (default: 4096)
  temperature?: number,           // Creativity 0-1 (default: 0.7)
  context?: {
    json?: boolean,               // Include sdk.json data (default: true)
    tables?: string[],            // Table names to include
    blobs?: boolean,              // Include blob URLs (default: false)
  }
});
```

### `sdk.agent.chat(options)`

Send a message and receive streaming response.

```typescript
interface ChatOptions {
  message: string;                // User's message
  conversationId?: string;        // Continue existing conversation
  context?: Record<string, any>;  // Live page data for THIS turn — injected into the
                                  // model's view as a "Live page data" block. Use for
                                  // warehouse queries / computed state / current filters.
                                  // Re-send the freshest snapshot each turn; ~200KB cap.
}

// Returns AsyncIterable<ChatChunk>
interface ChatChunk {
  type: 'content' | 'done' | 'error';
  content?: string;               // Partial response text
  conversationId?: string;        // Conversation ID (on 'done')
  usage?: {                       // Token usage (on 'done')
    input_tokens: number;
    output_tokens: number;
  };
  error?: string;                 // Error message (on 'error')
}
```

**Example:**
```javascript
let response = '';
for await (const chunk of sdk.agent.chat({ message: 'Hello!' })) {
  if (chunk.type === 'content') {
    response += chunk.content;
    updateUI(response);
  } else if (chunk.type === 'done') {
    console.log('Done! Conversation:', chunk.conversationId);
  } else if (chunk.type === 'error') {
    console.error('Error:', chunk.error);
  }
}
```

### `sdk.agent.conversations`

Manage chat history.

```typescript
// List conversations
const { conversations, total } = await sdk.agent.conversations.list({
  limit?: number,   // Default: 20
  offset?: number,  // Default: 0
});

// Get conversation with messages
const { conversation, messages } = await sdk.agent.conversations.get(id);

// Delete conversation
const { deleted } = await sdk.agent.conversations.delete(id);
```

### `sdk.agent.widget`

Pre-built chat widget with Shadow DOM isolation.

```typescript
// Mount widget
sdk.agent.widget.mount(selector: string, options?: {
  position?: 'bottom-right' | 'bottom-left' | 'inline',
  theme?: 'light' | 'dark' | 'auto',
  placeholder?: string,
  welcomeMessage?: string,
  minimized?: boolean,
  mode?: 'ask' | 'auto',         // default auto — reveals Ask/Do toggle when pilot enabled
  pilot?: boolean,               // false = chat-only even when owner enabled Page Pilot
  pilotInstructions?: string,    // layout hint for Do (pilot) tasks
});

// Controls
sdk.agent.widget.toggle();                    // Minimize/expand
sdk.agent.widget.setTheme('dark');            // Change theme
sdk.agent.widget.unmount();                   // Remove widget
```

## REST API Endpoints

All endpoints are under `/v1/data/{artifactId}/agent/`.

### POST `/agent/chat`

Send a chat message. Returns Server-Sent Events (SSE) stream.

**Request:**
```json
{
  "message": "What tasks are due today?",
  "conversationId": "conv_abc123",
  "context": { "additionalInfo": "..." }
}
```

**Response (SSE stream):**
```
data: {"type":"content","content":"Based on","conversationId":"conv_abc123"}
data: {"type":"content","content":" your tasks..."}
data: {"type":"done","conversationId":"conv_abc123","usage":{"input_tokens":150,"output_tokens":50}}
```

### GET `/agent/conversations`

List conversations for this artifact.

**Query params:**
- `limit` (default: 20)
- `offset` (default: 0)
- `mode` ('visitor' | 'admin', default: 'visitor')

**Response:**
```json
{
  "success": true,
  "data": {
    "conversations": [
      {
        "id": "conv_abc123",
        "artifact_id": "art_xyz",
        "mode": "visitor",
        "title": "What tasks are due today?",
        "message_count": 4,
        "created_at": "2026-05-25T20:00:00Z",
        "updated_at": "2026-05-25T20:05:00Z"
      }
    ],
    "total": 15,
    "limit": 20,
    "offset": 0
  }
}
```

### GET `/agent/conversations/{id}`

Get a conversation with all messages.

**Response:**
```json
{
  "success": true,
  "data": {
    "conversation": { ... },
    "messages": [
      { "id": "msg_1", "role": "user", "content": "Hello", "created_at": "..." },
      { "id": "msg_2", "role": "assistant", "content": "Hi there!", "created_at": "..." }
    ]
  }
}
```

### DELETE `/agent/conversations/{id}`

Delete a conversation and its messages.

### GET `/agent/config`

Get agent configuration for this artifact.

### PUT `/agent/config`

Update agent configuration (owner only).

**Request:**
```json
{
  "visitor_enabled": true,
  "visitor_system_prompt": "You are a helpful assistant.",
  "visitor_model": "claude-sonnet-4-20250514",
  "visitor_context_json": true,
  "visitor_context_tables": ["tasks", "users"]
}
```

### GET `/agent/usage`

Get usage statistics (owner only).

**Query params:**
- `period` (YYYY-MM format, default: current month)

**Response:**
```json
{
  "success": true,
  "data": {
    "period": "2026-05",
    "usage": {
      "visitor": { "input_tokens": 50000, "output_tokens": 25000, "request_count": 150 },
      "admin": { "input_tokens": 10000, "output_tokens": 8000, "request_count": 20 }
    }
  }
}
```

## Admin Mode (Owner-Only)

Owners get additional capabilities for editing artifacts via AI.

### GET `/agent/admin/context`

Get full artifact context including source files.

**Response:**
```json
{
  "success": true,
  "data": {
    "context": {
      "files": [
        { "path": "index.html", "content": "<!DOCTYPE html>...", "mime": "text/html" },
        { "path": "style.css", "content": "body {...", "mime": "text/css" }
      ],
      "skillDocs": "# ShareOut SDK Reference...",
      "artifact": { "id": "art_xyz", "name": "My App", "visibility": "public", "currentVersion": 5 },
      "json": { "theme": "dark" },
      "tables": ["tasks", "users"]
    }
  }
}
```

### POST `/agent/admin/chat`

Admin chat with code edit suggestions. Returns SSE stream.

The AI can suggest code changes in diff format. The `done` event includes parsed suggestions:

```json
{
  "type": "done",
  "conversationId": "conv_xyz",
  "suggestedEdits": [
    {
      "file": "index.html",
      "type": "replace",
      "search": "<button>Click</button>",
      "replace": "<button onclick=\"handleClick()\">Click Me</button>"
    }
  ]
}
```

### POST `/agent/admin/apply`

Apply suggested edits to staging.

**Request:**
```json
{
  "conversationId": "conv_xyz",
  "edits": [
    {
      "file": "index.html",
      "type": "replace",
      "search": "<button>Click</button>",
      "replace": "<button onclick=\"handleClick()\">Click Me</button>"
    }
  ]
}
```

### POST `/agent/admin/publish`

Publish pending edits as a new version.

**Request:**
```json
{
  "conversationId": "conv_xyz",
  "commitMessage": "Add click handler to button"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "version": { "id": "ver_abc", "version_no": 6 },
    "url": "$ORIGIN/a/my-app",
    "appliedEdits": 1
  }
}
```

## Rate Limits

| Limit | Default | Scope |
|-------|---------|-------|
| Requests/minute | 10 | Per artifact |
| Tokens/day | 100,000 | Per artifact |

Rate limit exceeded returns HTTP 429 with:
```json
{
  "success": false,
  "error": "Rate limit exceeded",
  "code": "RATE_LIMIT_EXCEEDED",
  "retryAfter": 45
}
```

Headers included:
- `X-RateLimit-Remaining: 0`
- `Retry-After: 45`

## Examples

### Support Chat Widget

```html
<!DOCTYPE html>
<html>
<head>
  <title>Help Center</title>
  <script src="$ORIGIN/sdk/shareout.js"></script>
</head>
<body>
  <h1>Help Center</h1>
  <div id="support-chat"></div>

  <script>
    const sdk = new ShareOut();

    sdk.agent.configure({
      systemPrompt: `You are a support assistant for Acme Corp.
        Product: Task Manager Pro
        Common issues: login problems, syncing, billing
        Always be helpful and suggest contacting support@acme.com for complex issues.`
    });

    sdk.agent.widget.mount('#support-chat', {
      position: 'bottom-right',
      theme: 'auto',
      welcomeMessage: 'Hi! Need help with Task Manager Pro?'
    });
  </script>
</body>
</html>
```

### Data Explorer Assistant

```html
<script>
  const sdk = new ShareOut();

  sdk.agent.configure({
    systemPrompt: 'Help users explore and understand their data.',
    context: {
      json: true,
      tables: ['sales', 'customers', 'products']
    }
  });

  // Custom UI
  document.getElementById('send').onclick = async () => {
    const input = document.getElementById('input');
    const output = document.getElementById('output');

    output.textContent = '';

    for await (const chunk of sdk.agent.chat({ message: input.value })) {
      if (chunk.type === 'content') {
        output.textContent += chunk.content;
      }
    }

    input.value = '';
  };
</script>
```

### Multi-turn Conversation

```javascript
let conversationId = null;

async function sendMessage(text) {
  const chunks = [];

  for await (const chunk of sdk.agent.chat({
    message: text,
    conversationId
  })) {
    if (chunk.type === 'content') {
      chunks.push(chunk.content);
    } else if (chunk.type === 'done') {
      conversationId = chunk.conversationId;
    }
  }

  return chunks.join('');
}

// First message starts new conversation
await sendMessage('What is the status of order #123?');

// Follow-up uses same conversation
await sendMessage('Can you cancel it?');

// Clear conversation
conversationId = null;
```

---

## Bring Your Own AI Keys

Use your own OpenAI, Anthropic, or other AI API keys via the secrets proxy. This gives you full control over models, billing, and API features.

### Setup

1. **Create a secret** with your API key (owner only, via dashboard or API):

```javascript
// OpenAI
POST /v1/data/{artifactId}/secrets
{
  "name": "openai",
  "allowedHosts": ["api.openai.com"],
  "allowedMethods": ["POST"],
  "allowedPaths": ["/v1/chat/completions", "/v1/embeddings"],
  "injectionType": "bearer",
  "credentials": { "value": "sk-..." }
}

// Anthropic
POST /v1/data/{artifactId}/secrets
{
  "name": "anthropic",
  "allowedHosts": ["api.anthropic.com"],
  "allowedMethods": ["POST"],
  "allowedPaths": ["/v1/messages"],
  "injectionType": "header",
  "injectionConfig": { "headerName": "x-api-key" },
  "credentials": { "value": "sk-ant-..." }
}

// Vercel AI Gateway
POST /v1/data/{artifactId}/secrets
{
  "name": "vercel-ai",
  "allowedHosts": ["gateway.ai.vercel.app"],
  "allowedMethods": ["POST"],
  "allowedPaths": ["/v1/*"],
  "injectionType": "bearer",
  "credentials": { "value": "your-vercel-token" }
}
```

2. **Call via secrets proxy** from your artifact:

```javascript
const sdk = new ShareOut();

// OpenAI Chat
const response = await sdk.secrets.post('openai', '/v1/chat/completions', {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(response.data.choices[0].message.content);

// Anthropic Messages
const claude = await sdk.secrets.post('anthropic', '/v1/messages', {
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }]
});
console.log(claude.data.content[0].text);
```

### Streaming Responses

For streaming, parse Server-Sent Events manually:

```javascript
async function streamOpenAI(prompt) {
  const response = await fetch(
    `${sdk._baseUrl}/v1/data/${sdk._artifactId}/secrets/openai/proxy`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        path: '/v1/chat/completions',
        body: {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: prompt }],
          stream: true
        }
      })
    }
  );

  // The proxy returns the upstream response directly
  const reader = response.body.getReader();
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const chunk = decoder.decode(value);
    // Parse SSE: data: {"choices":[{"delta":{"content":"..."}}]}
    for (const line of chunk.split('\n')) {
      if (line.startsWith('data: ') && line !== 'data: [DONE]') {
        const json = JSON.parse(line.slice(6));
        const content = json.choices?.[0]?.delta?.content;
        if (content) process.stdout.write(content);
      }
    }
  }
}
```

### Provider Configs

| Provider | Host | Injection | Header/Param |
|----------|------|-----------|--------------|
| OpenAI | `api.openai.com` | `bearer` | - |
| Anthropic | `api.anthropic.com` | `header` | `x-api-key` |
| Vercel AI Gateway | `gateway.ai.vercel.app` | `bearer` | - |
| Google AI | `generativelanguage.googleapis.com` | `query` | `key` |
| Cohere | `api.cohere.ai` | `bearer` | - |
| Mistral | `api.mistral.ai` | `bearer` | - |
| Groq | `api.groq.com` | `bearer` | - |
| Together AI | `api.together.xyz` | `bearer` | - |
| Fireworks | `api.fireworks.ai` | `bearer` | - |
| Perplexity | `api.perplexity.ai` | `bearer` | - |

### Security Notes

- **Keys are encrypted** at rest using AES-256
- **Host allowlists** prevent credential leakage to unauthorized domains
- **Path patterns** restrict which endpoints can be called
- **Rate limits** configurable per secret (default: 60 req/min)
- **Audit logs** track all proxy requests for debugging

### When to Use What

| Use Case | Recommendation |
|----------|----------------|
| Quick prototype | Built-in `sdk.agent.chat()` (uses ShareOut's API key) |
| Production with billing control | Secrets proxy with your own key |
| Advanced features (function calling, vision) | Secrets proxy |
| Multiple AI providers | Secrets proxy (one secret per provider)
