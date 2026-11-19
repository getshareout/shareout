---
title: SDK y API de Crew
description: Métodos de sdk.crew y endpoints REST para definir, ejecutar y programar crews.
---

import { Aside } from '@astrojs/starlight/components';

Crew es **solo para owners**. Todos los endpoints piden la sesión o el token de API del owner
del artefacto.

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
| `PATCH` | `/crew` | Actualizar solo los campos enviados (grants intactos salvo que mandes `tools`) |
| `DELETE` | `/crew` | Borrar el crew con sus grants, triggers, runs y aprobaciones (`404` si no hay) |
| `POST` | `/crew/run` | Iniciar run (SSE) |
| `GET` | `/crew/runs` | Listar runs |
| `GET` | `/crew/runs/{runId}` | Run + eventos |
| `GET` | `/crew/runs/{runId}/stream` | Repetir un run como SSE |
| `GET` | `/crew/triggers` | Listar triggers |
| `POST` | `/crew/triggers` | Crear trigger |
| `PATCH` | `/crew/triggers/{id}` | Actualizar trigger |
| `DELETE` | `/crew/triggers/{id}` | Borrar trigger |
| `GET` | `/crew/approvals` | Listar aprobaciones (`?status=pending`) |
| `POST` | `/crew/approvals/{id}/approve` | Aprobar escritura en cola |
| `POST` | `/crew/approvals/{id}/reject` | Rechazar escritura en cola |

Definir con curl:

```bash
curl -X POST "https://shareout.site/v1/data/art_abc123/crew/define" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "Resumen diario",
    "instructions": "Leé el json digest y postea un resumen en Slack.",
    "model": "claude-sonnet-5",
    "maxIterations": 6,
    "maxRuntimeMs": 240000,
    "maxTokensPerCall": 8192,
    "tools": { "read": ["json_get"], "write": ["notify_send"] }
  }'
```

Los admins del workspace listan todos los triggers de crews: `GET /v1/workspaces/{id}/automations`.

## Métodos SDK

```typescript
// Definir / leer
define(config: CrewDefineConfig): Promise<{ crew: unknown }>
update(patch: Partial<CrewDefineConfig>): Promise<{ crew: unknown }>
get(): Promise<{ crew: unknown; grants: unknown[] }>

// Ejecutar
run(options?: { input?: string }): AsyncGenerator<CrewRunEvent>

// Historial de runs
runs.list(options?: { limit?: number }): Promise<{ runs: unknown[] }>
runs.get(runId: string): Promise<{ run: unknown; events: unknown[] }>
runs.stream(runId: string): AsyncGenerator<CrewRunEvent>

// Triggers
triggers.list(): Promise<{ triggers: unknown[] }>
triggers.create(config: CrewTriggerConfig): Promise<{ trigger: unknown }>
triggers.update(triggerId: string, patch: TriggerPatch): Promise<{ trigger: unknown }>
triggers.delete(triggerId: string): Promise<{ deleted: boolean }>

// Aprobaciones de escritura
approvals.list(status?: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'): Promise<{ approvals: unknown[] }>
approvals.approve(approvalId: string): Promise<{ status: string; result?: unknown; error?: string }>
approvals.reject(approvalId: string): Promise<{ rejected: boolean }>

// Uso
usage(workspaceId: string): Promise<unknown>
```

## Tipos

```typescript
interface CrewDefineConfig {
  name?: string;
  instructions: string;
  model?: 'claude-sonnet-5' | 'claude-haiku-4-5-20251001';
  /** 1–40 (o el tope del plan del owner), 8 por defecto. */
  maxIterations?: number;
  runBudgetMicroUsd?: number;
  /** Solo runs programados (cron/condition): 5000–300000 ms, 25000 por defecto.
   *  Los runs manuales, por evento y de chat quedan en 25000. */
  maxRuntimeMs?: number;
  /** Tokens de salida máximos por llamada al modelo: 256–16384, 4096 por defecto. */
  maxTokensPerCall?: number;
  // Un tope fuera de rango → 400 INVALID_REQUEST con el campo y sus límites.
  tools?: CrewToolGrant;
}

interface CrewToolGrant {
  read?: string[];
  write?: string[];
  approval?: Record<string, 'never' | 'always' | 'whenPublic'>;
  limits?: Record<string, { maxRows?: number; maxCalls?: number; maxBytes?: number }>;
}

interface CrewTriggerConfig {
  kind: 'cron' | 'event' | 'condition';
  cron?: string;
  eventType?: string;
  condition?: {
    predicate?: { table: string; where?: Record<string, unknown>; op: 'gt' | 'gte' | 'lt' | 'lte' | 'eq'; value: number };
    cooldownSeconds?: number;
  };
}

interface CrewRunEvent {
  type: 'run_start' | 'reasoning' | 'tool_call' | 'tool_result' | 'finish' | 'error' | 'done';
  runId?: string;
  content?: string;
  tool?: string;
  input?: unknown;
  result?: unknown;
  summary?: string;
  error?: string;
  terminationReason?: string;
  iterations?: number;
  costMicroUsd?: number;
}
```

## Aprobaciones de escritura

```javascript
tools: {
  write: ['notify_send', 'table_insert'],
  approval: {
    notify_send: 'always',
    table_insert: 'whenPublic',
  },
}
```

## Ejemplos

### Definir y ejecutar

```javascript
const sdk = await ShareOut.create();

await sdk.crew.define({
  name: 'Monitor de datos',
  instructions: 'Revisá sales buscando revenue < 0 y resumí.',
  model: 'claude-sonnet-5',
  tools: { read: ['table_query', 'json_get'] },
});

for await (const event of sdk.crew.run({ input: 'Revisá ahora.' })) {
  if (event.type === 'tool_call') console.log(event.tool, event.input);
  if (event.type === 'finish') console.log(event.summary);
}
```

### Trigger cron

```javascript
// Darles hasta 4 minutos a los runs programados (los grants no cambian)
await sdk.crew.update({ maxRuntimeMs: 240_000 });
await sdk.crew.triggers.create({ kind: 'cron', cron: '0 9 * * 1' });
```

### Aprobar una escritura en cola

```javascript
const { approvals } = await sdk.crew.approvals.list('pending');
await sdk.crew.approvals.approve(approvals[0].id);
```

## Tools (resumen)

Referencia completa: [Tools de Crew](/es/crew/tools/).

| Tool | Modo |
| --- | --- |
| `json_get`, `table_query`, `table_schema`, `connection_query`, `web_search`, `file_list`, `file_read`, `workspace_artifacts`, `workspace_data_read`, `knowledge_search`, `action_item_list` | lectura |
| `json_set`, `materialize_query`, `table_insert`, `table_update`, `comment_create`, `action_item_create`, `email_send`, `notify_send`, `scheduled_job_create`, `pilot_verify` | escritura |
