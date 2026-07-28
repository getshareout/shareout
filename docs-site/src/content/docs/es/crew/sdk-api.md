---
title: SDK y API de Crew
description: Métodos de sdk.crew y endpoints REST para definir, ejecutar y programar crews.
---

import { Aside } from '@astrojs/starlight/components';

Crew es **solo para owners**.

<Aside type="note">
Conceptos: [Introducción](/es/crew/overview/) · [Tools](/es/crew/tools/) ·
[Patrones](/es/crew/patterns/)
</Aside>

## Endpoints REST

Base: `https://shareout.site/v1/data/{artifactId}/crew`

| Método | Ruta | Acción |
| --- | --- | --- |
| `GET` | `/crew` | Config + grants |
| `POST` | `/crew/define` | Crear o reemplazar crew |
| `POST` | `/crew/run` | Iniciar run (SSE) |
| `GET` | `/crew/runs` | Listar runs |
| `GET` | `/crew/runs/{runId}` | Run + eventos |
| `GET` | `/crew/triggers` | Listar triggers |
| `POST` | `/crew/triggers` | Crear trigger |
| `GET` | `/crew/approvals` | Listar aprobaciones |
| `POST` | `/crew/approvals/{id}/approve` | Aprobar escritura |

```bash
curl -X POST "https://shareout.site/v1/data/art_abc123/crew/define" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"instructions":"…","tools":{"read":["json_get"],"write":["notify_send"]}}'
```

## Métodos SDK

```typescript
define(config): Promise<{ crew: unknown }>
get(): Promise<{ crew: unknown; grants: unknown[] }>
run(options?): AsyncGenerator<CrewRunEvent>
runs.list / runs.get / runs.stream
triggers.list / create / update / delete
approvals.list / approve / reject
usage(workspaceId)
```

Ver tipos completos en la [versión en inglés](/crew/sdk-api/) (mismos nombres).

## Ejemplos

```javascript
await sdk.crew.define({
  instructions: 'Revisá sales.',
  tools: { read: ['table_query'] },
});

for await (const event of sdk.crew.run()) {
  if (event.type === 'finish') console.log(event.summary);
}

await sdk.crew.triggers.create({ kind: 'cron', cron: '0 9 * * 1' });
```

## Tools (resumen)

Referencia completa: [Tools de Crew](/es/crew/tools/).
