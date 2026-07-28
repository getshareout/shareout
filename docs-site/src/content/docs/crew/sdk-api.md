---
title: Crew SDK & API
description: sdk.crew methods and REST endpoints for defining, running, and scheduling artifact crews.
---

import { Aside } from '@astrojs/starlight/components';

Crew is **owner-only**. All endpoints require the artifact owner's session or API token.

<Aside type="note">
Concepts and tools: [Crew overview](/crew/overview/) · [Tools](/crew/tools/) ·
[Patterns](/crew/patterns/)
</Aside>

## REST endpoints

Base path: `https://shareout.site/v1/data/{artifactId}/crew`

| Method | Path | Action |
| --- | --- | --- |
| `GET` | `/crew` | Get crew config + tool grants |
| `POST` | `/crew/define` | Create or replace crew definition |
| `POST` | `/crew/run` | Start a run (SSE stream) |
| `GET` | `/crew/runs` | List runs |
| `GET` | `/crew/runs/{runId}` | Run + events |
| `GET` | `/crew/runs/{runId}/stream` | Replay run as SSE |
| `GET` | `/crew/triggers` | List triggers |
| `POST` | `/crew/triggers` | Create trigger |
| `PATCH` | `/crew/triggers/{id}` | Update trigger |
| `DELETE` | `/crew/triggers/{id}` | Delete trigger |
| `GET` | `/crew/approvals` | List approvals (`?status=pending`) |
| `POST` | `/crew/approvals/{id}/approve` | Approve queued write |
| `POST` | `/crew/approvals/{id}/reject` | Reject queued write |

Define via curl:

```bash
curl -X POST "https://shareout.site/v1/data/art_abc123/crew/define" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "name": "Daily briefing",
    "instructions": "Read digest json and post summary to Slack.",
    "model": "claude-sonnet-4-20250514",
    "maxIterations": 6,
    "tools": { "read": ["json_get"], "write": ["notify_send"] }
  }'
```

Workspace admins list all crew triggers: `GET /v1/workspaces/{id}/automations`.

## SDK methods

```typescript
// Define / read
define(config: CrewDefineConfig): Promise<{ crew: unknown }>
get(): Promise<{ crew: unknown; grants: unknown[] }>

// Run
run(options?: { input?: string }): AsyncGenerator<CrewRunEvent>

// Run history
runs.list(options?: { limit?: number }): Promise<{ runs: unknown[] }>
runs.get(runId: string): Promise<{ run: unknown; events: unknown[] }>
runs.stream(runId: string): AsyncGenerator<CrewRunEvent>

// Triggers
triggers.list(): Promise<{ triggers: unknown[] }>
triggers.create(config: CrewTriggerConfig): Promise<{ trigger: unknown }>
triggers.update(triggerId: string, patch: TriggerPatch): Promise<{ trigger: unknown }>
triggers.delete(triggerId: string): Promise<{ deleted: boolean }>

// Write approvals
approvals.list(status?: 'pending' | 'approved' | 'rejected' | 'executed' | 'failed'): Promise<{ approvals: unknown[] }>
approvals.approve(approvalId: string): Promise<{ status: string; result?: unknown; error?: string }>
approvals.reject(approvalId: string): Promise<{ rejected: boolean }>

// Usage
usage(workspaceId: string): Promise<unknown>
```

## Types

```typescript
interface CrewDefineConfig {
  name?: string;
  instructions: string;
  model?: 'claude-sonnet-4-20250514' | 'claude-3-5-haiku-20241022';
  maxIterations?: number;
  runBudgetMicroUsd?: number;
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

## Write approvals {#write-approvals}

```javascript
tools: {
  write: ['notify_send', 'table_insert'],
  approval: {
    notify_send: 'always',
    table_insert: 'whenPublic',
  },
}
```

## SDK examples

### Define and run

```javascript
const sdk = await ShareOut.create();

await sdk.crew.define({
  name: 'Data Monitor',
  instructions: 'Check sales for revenue < 0 and summarize.',
  model: 'claude-sonnet-4-20250514',
  tools: { read: ['table_query', 'json_get'] },
});

for await (const event of sdk.crew.run({ input: 'Check now.' })) {
  if (event.type === 'tool_call') console.log(event.tool, event.input);
  if (event.type === 'finish') console.log(event.summary);
}
```

### Cron trigger

```javascript
await sdk.crew.triggers.create({ kind: 'cron', cron: '0 9 * * 1' });
```

### Approve a queued write

```javascript
const { approvals } = await sdk.crew.approvals.list('pending');
await sdk.crew.approvals.approve(approvals[0].id);
```

## Built-in tools (summary)

Full reference: [Crew tools](/crew/tools/).

| Tool | Mode |
| --- | --- |
| `json_get`, `table_query`, `table_schema`, `connection_query`, `web_search` | read |
| `json_set`, `materialize_query`, `table_insert`, `table_update`, `comment_create`, `email_send`, `notify_send`, `scheduled_job_create` | write |
