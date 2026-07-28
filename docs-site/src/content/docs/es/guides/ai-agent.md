---
title: Agente de chat con IA
description: Agregá un asistente de chat con Claude a tu artifact.
---

import { Steps, Aside } from '@astrojs/starlight/components';

Sumá un agente de chat con Claude a cualquier artifact. Puede responder a partir de
los datos de tu artifact — `sdk.json`, tablas, o un snapshot en vivo que le pases.

## Dos pasos (no te saltees el primero)

El agente está **apagado por defecto**. Llamar a `sdk.agent.configure()` en la página *no*
lo habilita — eso solo configura opciones del cliente y corre con la sesión del visitante.
Un `403 "Agent not enabled"` significa que te salteaste el paso 1.

<Steps>

1. **Habilitalo (acción del owner).** Lo más fácil es al momento de publicar — agregá un bloque `agent`
   al [payload de publish](/api/operations/publishartifact/):

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

   O vía la API del owner: `PUT /v1/data/{artifactId}/agent/config` con
   `{ "visitor_enabled": true, "visitor_system_prompt": "…" }`.

2. **Agregá el chat a la página.** Montá el widget prearmado, o construí tu propia UI con
   `sdk.agent.chat()`.

</Steps>

<Aside type="caution">
El system prompt y el model viven en la config del **servidor** (el bloque `agent` / el `PUT`
de arriba), no en `configure()`. Para el modo visitante, el `systemPrompt` y el
`model` de `configure()` se ignoran a propósito, así un visitante no puede reescribir el prompt desde la
consola.
</Aside>

## El widget prearmado

```javascript
const sdk = await ShareOut.create();

sdk.agent.widget.mount('#support-chat', {
  position: 'bottom-right',
  theme: 'auto',
  welcomeMessage: 'Hi! How can I help?',
});
```

El widget prearmado usa el scroll streaming reading-first de ShareOut — los mensajes
de tus visitantes quedan anclados mientras llegan las respuestas, con ir al final si se alejan.

## UI personalizada con streaming

```javascript
for await (const chunk of sdk.agent.chat({ message: userText })) {
  if (chunk.type === 'content') append(chunk.content);
  else if (chunk.type === 'done') conversationId = chunk.conversationId;
}
```

Pasá `conversationId` en la siguiente llamada para continuar un hilo.

## Alimentar datos en vivo

El contexto integrado solo auto-incluye `sdk.json` + las tablas declaradas. Para datos en vivo —
una query a un warehouse, KPIs calculados, los filtros actuales — pasá un snapshot fresco por
mensaje vía `context`. Se inyecta como un bloque "Live page data" solo para ese turno
(tope ≈200 KB):

```javascript
function snapshot() {
  return { filters: currentFilters, kpis: computedKpis, series: dailyRows };
}

for await (const chunk of sdk.agent.chat({ message: userText, context: snapshot() })) {
  if (chunk.type === 'content') append(chunk.content);
}
```

## Conversaciones

```javascript
const { conversations } = await sdk.agent.conversations.list({ limit: 20 });
const { messages } = await sdk.agent.conversations.get(id);
await sdk.agent.conversations.delete(id);
```

## Límites

10 requests/min y 100,000 tokens/día por artifact. Pasado el límite devuelve `429`
con un header `Retry-After`.

Para **automatización del lado del servidor** (resúmenes programados, entrega a Slack,
narrativas de warehouse), ver [Crew](/es/guides/crew/) — un agente separado que corre
con tools de owner, no en el navegador del visitante.

## Traé tus propias keys {#bring-your-own-keys}

Para controlar la facturación o para features avanzadas (function calling, vision), pasá tu
propia key de proveedor a través del proxy de secrets encriptado en vez del agente integrado.
Creá un secret (solo el owner), después llamalo desde la página:

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

Las keys están encriptadas con AES-256 en reposo; los allowlists de hosts y los patrones de paths restringen
dónde se pueden usar. Están soportados OpenAI, Anthropic, Google AI, Cohere, Mistral, Groq y
más.

| Caso de uso | Elegí |
| --- | --- |
| Prototipo rápido | `sdk.agent.chat()` integrado (la key de ShareOut) |
| Control de facturación / producción | Proxy de secrets con tu propia key |
| Function calling, vision | Proxy de secrets |
