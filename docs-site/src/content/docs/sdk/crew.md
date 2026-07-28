---
title: Crew store
description: Browser SDK entry point for artifact crews — see the Crew docs section for the full reference.
---

import { Aside } from '@astrojs/starlight/components';

The `sdk.crew` store is documented in the **Crew** section:

| Page | Contents |
| --- | --- |
| [Crew overview](/crew/overview/) | What Crew is, when to use it, how runs work |
| [Tools](/crew/tools/) | Every built-in tool in depth |
| [Patterns & examples](/crew/patterns/) | Refresh → narrate → deliver, daily briefings |
| [SDK & API](/crew/sdk-api/) | `sdk.crew` methods, types, REST endpoints |

<Aside type="note">
Crew is owner-only and different from [`sdk.agent`](/guides/ai-agent/) (visitor chat).
</Aside>

## Quick reference

```javascript
const sdk = await ShareOut.create(); // owner session

await sdk.crew.define({ instructions: '…', tools: { read: ['json_get'], write: ['json_set'] } });

for await (const event of sdk.crew.run()) {
  if (event.type === 'finish') console.log(event.summary);
}
```

See [SDK & API](/crew/sdk-api/) for the complete method list.
