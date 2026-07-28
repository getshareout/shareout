---
title: AI chat agent
description: Add a Claude-powered chat assistant to your artifact.
---

import { Steps, Aside } from '@astrojs/starlight/components';

Drop a Claude-powered chat agent into any artifact. It can answer from your
artifact's data — `sdk.json`, tables, or a live snapshot you pass in.

## Two steps (don't skip the first)

The agent is **off by default**. Calling `sdk.agent.configure()` in the page does
*not* enable it — that only sets client options and runs with the visitor's
session. A `403 "Agent not enabled"` means you skipped step 1.

<Steps>

1. **Enable it (owner action).** Easiest is at publish time — add an `agent` block
   to the [publish payload](/api/operations/publishartifact/):

   ```jsonc
   {
     "name": "My Dashboard",
     "files": [ /* ... */ ],
     "agent": {
       "enabled": true,
       "systemPrompt": "You are a data analyst for this dashboard. Answer only from the data provided.",
       "model": "claude-sonnet-4-20250514",
       "contextTables": ["sales"]
     }
   }
   ```

   Or via the owner API: `PUT /v1/data/{artifactId}/agent/config` with
   `{ "visitor_enabled": true, "visitor_system_prompt": "…" }`.

2. **Add chat to the page.** Mount the prebuilt widget, or build your own UI with
   `sdk.agent.chat()`.

</Steps>

<Aside type="caution">
System prompt and model live in the **server** config (the `agent` block / `PUT`
above), not in `configure()`. For visitor mode, `configure()`'s `systemPrompt` and
`model` are intentionally ignored, so a visitor can't rewrite the prompt from the
console.
</Aside>

## The prebuilt widget

```javascript
const sdk = await ShareOut.create();

sdk.agent.widget.mount('#support-chat', {
  position: 'bottom-right',
  theme: 'auto',
  welcomeMessage: 'Hi! How can I help?',
});
```

The prebuilt widget uses ShareOut's reading-first streaming scroll — your visitors'
messages stay anchored while replies stream, with jump-to-latest when they scroll away.

## Custom UI with streaming

```javascript
for await (const chunk of sdk.agent.chat({ message: userText })) {
  if (chunk.type === 'content') append(chunk.content);
  else if (chunk.type === 'done') conversationId = chunk.conversationId;
}
```

Pass `conversationId` on the next call to continue a thread.

## Feeding live data

Built-in context only auto-includes `sdk.json` + declared tables. For live data —
a warehouse query, computed KPIs, current filters — pass a fresh snapshot per
message via `context`. It's injected as a "Live page data" block for that turn
only (≈200 KB cap):

```javascript
function snapshot() {
  return { filters: currentFilters, kpis: computedKpis, series: dailyRows };
}

for await (const chunk of sdk.agent.chat({ message: userText, context: snapshot() })) {
  if (chunk.type === 'content') append(chunk.content);
}
```

## Conversations

```javascript
const { conversations } = await sdk.agent.conversations.list({ limit: 20 });
const { messages } = await sdk.agent.conversations.get(id);
await sdk.agent.conversations.delete(id);
```

## Limits

10 requests/min and 100,000 tokens/day per artifact. Over the limit returns `429`
with a `Retry-After` header.

For **server-side automation** (scheduled summaries, Slack delivery, warehouse
narratives), see [Crew](/guides/crew/) — a separate agent that runs with owner tools,
not in the visitor's browser.

## Bring your own keys {#bring-your-own-keys}

For billing control or advanced features (function calling, vision), proxy your
own provider key through the encrypted secrets proxy instead of the built-in
agent. Create a secret (owner only), then call it from the page:

```javascript
// Owner: register the key once
// POST /v1/data/{artifactId}/secrets
// { "name": "anthropic", "allowedHosts": ["api.anthropic.com"],
//   "allowedPaths": ["/v1/messages"], "injectionType": "header",
//   "injectionConfig": { "headerName": "x-api-key" }, "credentials": { "value": "sk-ant-…" } }

const res = await sdk.secrets.post('anthropic', '/v1/messages', {
  model: 'claude-sonnet-4-20250514',
  max_tokens: 1024,
  messages: [{ role: 'user', content: 'Hello!' }],
});
console.log(res.data.content[0].text);
```

Keys are AES-256 encrypted at rest; host allowlists and path patterns restrict
where they can be used. OpenAI, Anthropic, Google AI, Cohere, Mistral, Groq, and
more are supported.

| Use case | Pick |
| --- | --- |
| Quick prototype | Built-in `sdk.agent.chat()` (ShareOut's key) |
| Billing control / production | Secrets proxy with your own key |
| Function calling, vision | Secrets proxy |
