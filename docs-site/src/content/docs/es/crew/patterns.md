---
title: Patrones y ejemplos de Crew
description: Patrones de producción — refrescar, narrar, entregar, y setups reales.
---

## Refrescar → narrar → entregar

| Paso | Mecanismo | ¿LLM? |
| --- | --- | --- |
| **Refrescar** | Job [`query_snapshot`](/es/guides/jobs/) | No |
| **Narrar** | Crew + `json_get` / `json_set` | Sí |
| **Entregar** | `notify_send` o job de entrega | Opcional |

## Briefing diario en Slack

**1. Job de refresh** (12:50 UTC) con clave `digest`:

```bash
curl -X POST https://shareout.site/v1/jobs \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "artifact_id": "art_dashboard",
    "action": "query_snapshot",
    "schedule": "50 12 * * *",
    "config": {
      "connection": "bigquery",
      "params": { "projectId": "my-gcp-project" },
      "queries": [
        { "query": "SELECT …", "target": { "type": "json", "name": "digest", "path": "trends" } }
      ]
    }
  }'
```

**2. Crew de narración** (13:00 UTC):

```javascript
await sdk.crew.define({
  name: 'Briefing diario',
  instructions: 'json_get digest → briefing 110–170 palabras en mrkdwn → notify_send Slack mode both.',
  tools: { read: ['json_get'], write: ['notify_send'], approval: { notify_send: 'never' } },
});
await sdk.crew.triggers.create({ kind: 'cron', cron: '0 13 * * *' });
```

## Monitor de anomalías

```javascript
await sdk.crew.define({
  instructions: 'Si revenue < 0 en sales, json_set alerts con ids; si no, [].',
  tools: { read: ['table_query'], write: ['json_set'] },
});
```

## Investigación al disparar alerta

```jsonc
"on_trigger": {
  "crew": true,
  "instruction": "Explicá la caída en 3 bullets y notify_send a Slack."
}
```

Ver [alertas de métricas](/es/guides/metric-alerts/).

## Desde Telegram

**@ShareOutAI_bot** → `ask_crew`. Ver [Bot de Telegram](/es/guides/telegram-bot/).

## Inspeccionar runs

```javascript
const { runs } = await sdk.crew.runs.list({ limit: 10 });
for await (const event of sdk.crew.runs.stream(runs[0].id)) {
  console.log(event.type, event.summary ?? event.content ?? '');
}
```
