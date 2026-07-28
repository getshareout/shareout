---
title: Alertas de métricas
description: Seguí un número de un dashboard y recibí un aviso cuando cruza un umbral.
---

Una alerta de métrica vigila un número de un artifact y te avisa cuando cruza un
umbral — "avisame cuando los ingresos bajen de 100k" — entregado a Slack, email,
Discord o un webhook. Chequea los datos guardados del artifact según una
programación, así el dashboard y la alerta siempre coinciden.

## Cómo funciona

1. **Exponé una métrica seguible** en el artifact (lo hace un manager, una vez).
2. **Suscribite a ella** con una condición, una programación y un destino.

El evaluador lee los datos guardados, nunca la página renderizada — así que
escribí el KPI que se muestra en tu almacén JSON (o una tabla) y apuntá la
métrica ahí.

## 1. Definir una métrica

```bash
curl -X PUT https://shareout.site/v1/metric-alerts/definitions \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "artifact_id": "art_abc123",
    "metric_id": "revenue",
    "label": "Revenue",
    "format": "currency:USD",
    "source": { "type": "json_path", "key": "metrics", "path": "$.revenue" }
  }'
```

| Fuente | Lee |
| --- | --- |
| `json_path` | Un valor dentro de una clave del almacén JSON (ej. `$.revenue`) |
| `table_count` | Cantidad de filas de una tabla (filtro `where` opcional) |
| `table_aggregate` | `sum` / `avg` / `min` / `max` de un campo numérico |

## 2. Crear una alerta

```bash
curl -X POST https://shareout.site/v1/metric-alerts \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{
    "artifact_id": "art_abc123",
    "metric_id": "revenue",
    "name": "Ingresos por debajo del objetivo",
    "condition": { "op": "lt", "value": 100000 },
    "schedule": "0 9 * * 1-5",
    "destination": {
      "kind": "slack",
      "config": { "connection": "team", "targetType": "channel", "channelId": "C0123456789", "mode": "message" }
    }
  }'
```

### Condiciones

| Operador | Se dispara cuando el valor… |
| --- | --- |
| `gt` / `gte` | sube por encima / igual o por encima del umbral |
| `lt` / `lte` | baja por debajo / igual o por debajo |
| `eq` | es igual |
| `change_pct_gt` / `change_pct_lt` | sube / baja más de N% desde el último chequeo |

`schedule` es una expresión cron (cada cuánto chequear). Un **cooldown** (1 día
por defecto) evita que una métrica que sigue pasada del umbral alerte en cada chequeo.

## Quién puede hacer qué

- **Managers** (owner/editor del artifact, o owner/admin del workspace) definen
  métricas y envían alertas a donde sea — canales de Slack del equipo, webhooks,
  cualquier email.
- **Viewers** solo pueden suscribirse a sí mismos — un DM de Slack o un email a su
  propia dirección. En una página publicada lo hacen desde el botón **Follow
  metric** de la barra de herramientas.

## Ejecutar, pausar, inspeccionar

| Acción | Endpoint |
| --- | --- |
| Chequear ahora | `POST /v1/metric-alerts/{id}/run` |
| Pausar | `PATCH /v1/metric-alerts/{id}` → `{ "enabled": false }` |
| Historial | `GET /v1/metric-alerts/{id}/events` |

Relacionado: [Programar jobs](/es/guides/jobs/) para entrega recurrente sin umbral.
Para una **investigación** en lenguaje natural cuando se dispara una alerta, agregá
`on_trigger.crew` — ver [Crew](/es/guides/crew/#investigación-al-disparar-una-alerta).

## Metric watches

Los **metric watches** son un hermano más liviano de las alertas de métricas — sin
configurar destinos, solo campana. Desde el Inspector → **Watches** de una página
abierta, elegí una tabla y un tipo de métrica:

| Tipo | Vigila |
| --- | --- |
| `count` | Cantidad de filas de una tabla |
| `sum` | Suma de una columna numérica |
| `last` | Último valor de una columna |

Un barrido horario compara el valor actual con la línea base guardada. Cuando se
mueve **±20%** (por defecto, configurable), recibís una tarjeta **metric watch** en
la campana. Cooldown de seis horas entre alertas repetidas del mismo watch.

| | Alertas de métricas | Metric watches |
| --- | --- | --- |
| Setup | Definir métrica + condición + cron + destino | Elegir tabla + tipo en Inspector |
| Entrega | Slack, email, Discord, webhook | Solo campana |
| Caso de uso | "Avisame cuando revenue &lt; 100k cada día hábil" | "Avisame si salta el conteo de filas de esta tabla" |

### API

```http
POST   /v1/metric-watch     { "artifact_id", "table", "kind", "column?", "threshold_pct?" }
GET    /v1/metric-watch?artifact_id=…
DELETE /v1/metric-watch/{id}
```

Auth: cookie de sesión o token API. El asistente del workspace también expone la
herramienta `watch_metric` para el mismo flujo de creación.
