---
title: Crew store
description: Punto de entrada del SDK del navegador para crews — ver la sección Crew para la referencia completa.
---

import { Aside } from '@astrojs/starlight/components';

`sdk.crew` está documentado en la sección **Crew**:

| Página | Contenido |
| --- | --- |
| [Introducción](/es/crew/overview/) | Qué es Crew y cómo funcionan los runs |
| [Tools](/es/crew/tools/) | Cada tool en detalle |
| [Patrones y ejemplos](/es/crew/patterns/) | Refrescar → narrar → entregar |
| [SDK y API](/es/crew/sdk-api/) | Métodos, tipos, REST |

<Aside type="note">
Crew es solo para owners. Distinto de [`sdk.agent`](/es/guides/ai-agent/) (chat visitantes).
</Aside>

## Referencia rápida

```javascript
await sdk.crew.define({ instructions: '…', tools: { read: ['json_get'], write: ['json_set'] } });
for await (const event of sdk.crew.run()) {
  if (event.type === 'finish') console.log(event.summary);
}
```

Ver [SDK y API](/es/crew/sdk-api/).
