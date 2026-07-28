---
title: Tools de Crew
description: Tools de lectura y escritura para crews — consultas, snapshots, entrega y aprobaciones.
---

import { Aside } from '@astrojs/starlight/components';

Concedé tools en `sdk.crew.define({ tools: { read: [...], write: [...] } })`.
El runtime solo expone lo que el owner habilitó.

```javascript
await sdk.crew.define({
  instructions: '…',
  tools: {
    read: ['json_get', 'connection_query'],
    write: ['json_set', 'notify_send'],
    approval: { notify_send: 'always' },
    limits: { connection_query: { maxCalls: 5, maxRows: 100 } },
  },
});
```

## Tools de lectura

| Tool | Qué hace |
| --- | --- |
| `json_get` | Lee una clave del JSON store |
| `table_query` | Consulta filas de una tabla |
| `table_schema` | Inspecciona columnas |
| `connection_query` | Consulta una [conexión del workspace](/es/teams/connections/) |
| `web_search` | Búsqueda web (si está habilitada) |

### `connection_query`

- **REST:** `query = "GET /endpoint/path"`
- **Warehouse:** `query` = SQL; `params.projectId` para BigQuery

Devuelve filas al contexto del crew — ideal para **agregados y resultados chicos**.
Corre como el **owner del artifact**, incluyendo conectores per-user.

## Tools de escritura

| Tool | Qué hace |
| --- | --- |
| `json_set` | Escribe o mergea en el JSON store |
| `materialize_query` | Guarda resultados de conexión sin cargar cada fila en la conversación |
| `table_insert` / `table_update` | Mutan tablas |
| `comment_create` | Agrega comentario |
| `email_send` | Envía email |
| `notify_send` | Entrega one-shot a Slack, email, Discord, webhook |
| `scheduled_job_create` | Crea [job programado](/es/guides/jobs/) |

### `json_set`

Escribe en el JSON store. `path` opcional mergea un campo dentro del objeto.

<Aside type="note">
Bloqueado con `access_policy` activa — JSON store solo owner/editor.
</Aside>

### `materialize_query`

| `target.type` | Escribe en |
| --- | --- |
| `table` | `sdk.table(name)` |
| `dataset` | `sdk.dataset(name)` |
| `json` | clave `name`; `path` opcional |

```jsonc
{
  "connection": "team_bigquery",
  "query": "SELECT * FROM `project.dataset.table` LIMIT 500",
  "params": { "projectId": "my-gcp-project" },
  "target": { "type": "json", "name": "snapshot", "path": "rows" }
}
```

Usá **`query_snapshot`** cuando el SQL es estable. **`materialize_query`** cuando el
agente elige qué refrescar.

### `notify_send`

```jsonc
{
  "destination": "slack",
  "message": "*Resumen diario*\nRevenue +12% vs ayer.",
  "config": { "connection": "team", "channelId": "C0123456789", "mode": "both" },
  "source": {
    "connection": "warehouse",
    "query": "SELECT … FROM metrics.daily_revenue …",
    "asOf": "2026-06-22"
  }
}
```

Pasá `source` al entregar números derivados de datos — se agrega un footer de
atribución compacto (`_Source: … · as of …_` más la query en una línea) para que
los destinatarios puedan rastrear las cifras. Ver
[Procedencia de datos](/es/guides/data-provenance/).

Ver [integración Slack](/es/integrations/slack/).

## Aprobaciones de escritura

| Política | Cuándo |
| --- | --- |
| `never` | Ejecuta de inmediato |
| `always` | Siempre requiere aprobación del owner |
| `whenPublic` | Solo si el artifact es público |

```javascript
const { approvals } = await sdk.crew.approvals.list('pending');
await sdk.crew.approvals.approve(approvals[0].id);
```

## Límites por tool

```javascript
limits: { connection_query: { maxCalls: 10, maxRows: 500 } }
```
