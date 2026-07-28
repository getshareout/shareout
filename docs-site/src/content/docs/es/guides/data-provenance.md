---
title: Procedencia de datos
description: Mostrá de dónde salen tus números — campos del manifest, vínculos por elemento y el drawer de fuentes de datos.
---

import { Aside } from '@astrojs/starlight/components';

Los dashboards y reportes corren sobre consultas, conectores, snapshots y
entregas programadas. Los visitantes (y quienes reenvían un Slack o email)
preguntan constantemente **de dónde salen los números y cómo reproducirlos.**
Respondé en build-time: declará la procedencia en el manifest y ShareOut renderiza
la UI por vos.

<Aside type="note">
Es una recomendación fuerte, no un bloqueo. ShareOut nunca impide publicar por
falta de procedencia — pero el perfil de readiness al publicar **advierte** cuando
una fuente en vivo no tiene query ni descripción, y el editor lo marca. Tratá esas
advertencias como "terminá la historia de los datos."
</Aside>

## La regla única

**Por cada dataset que lee un artifact, declará en el manifest: qué es, la query o
script que lo produjo, las tablas que toca, cuándo se refresca y cómo reconstruirlo.**
Después vinculá cada gráfico o tabla a su fuente.

## 1. Declarar procedencia en las fuentes

Cada entrada de `sources.{connections,json,tables}` acepta campos opcionales de
procedencia:

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "connections": {
      "warehouse": {
        "label": "Actividad de clientes (90d)",
        "description": "Eventos de creación/interacción por empresa, últimos 90 días.",
        "query": "SELECT company_id, SUM(recipes_created + vendors_created) AS act\nFROM CUSTOMER_METRICS.FCT_CUSTOMER_ACTIVITY\nWHERE event_date >= DATEADD(day,-90,CURRENT_DATE)\nGROUP BY 1",
        "tables": ["CUSTOMER_METRICS.FCT_CUSTOMER_ACTIVITY"],
        "refresh": "daily 12:00 UTC",
        "as_of": "2026-06-22",
        "replication": {
          "build": "python build_scorecard.py",
          "publish": "node publish_scorecard.mjs",
          "credentials": "Key-pair Snowflake en la conexión del workspace"
        },
        "default": [{ "company_id": "c1", "act": 42 }]
      }
    }
  }
}
</script>
```

| Campo | Propósito |
| --- | --- |
| `label` | Nombre legible del dataset |
| `description` | Una línea: qué es |
| `query` | SQL, llamada API o paso de build exacto que produjo los datos |
| `tables` | Tablas subyacentes del warehouse o fuente |
| `refresh` | Cadencia en palabras (`daily 12:00 UTC`, `manual`, `live`) |
| `as_of` | Fecha u hora del snapshot |
| `replication` | `{ build, publish, credentials, notes }` — cómo reconstruir desde cero |

Todos los campos son opcionales y retrocompatibles. Mantené `default` también —
alimenta el preview del editor. Ver [Manifest → Procedencia](/es/spec/manifest/#procedencia).

## 2. Vincular cada gráfico o tabla a su fuente

Dos formas; usá una o ambas.

**Atributo por elemento** (lo más simple):

```html
<div id="rev-chart" data-shareout-source="connection:warehouse"></div>
<table data-shareout-source="json:revenue">…</table>
```

**`feeds` en el manifest** (cuando no podés editar el elemento, o querés una nota):

```json
"feeds": [
  { "element": "#rev-chart", "source": "connection:warehouse", "note": "Rollup 90 días" }
]
```

`source` es una ref `kind:key` — `connection:warehouse`, `json:revenue`,
`table:rooms`.

## 3. Mostrar el drawer a los visitantes

Una línea de JavaScript:

```javascript
const sdk = await ShareOut.create();
sdk.sources.mount(); // botón flotante "Data sources" + drawer + badges por elemento
```

O cero líneas — agregá el atributo y el SDK monta al cargar el DOM:

```html
<body data-shareout-sources>
```

Lo que ven los visitantes:

- Un drawer **Data sources**: una tarjeta por dataset con descripción, tablas,
  refresh, as-of, **View query** colapsable y bloque **Replicate**
  (build/publish/credentials).
- Un badge **ⓘ source** en cada elemento que etiquetaste (o mapeaste vía `feeds`);
  al hacer clic abre el drawer en ese dataset.

Ver [SDK Sources](/es/sdk/sources/) para la API completa.

## 4. Atribuir entregas de crew

Cuando un crew o job entrega números derivados de datos a Slack, Telegram o
email, pasá `source` a `notify_send` para que los destinatarios puedan rastrear
las cifras:

```jsonc
{
  "destination": "slack",
  "message": "Adopción semanal: 62% de cuentas activas (+4pts).",
  "config": { "connection": "team_slack", "channelId": "C0…" },
  "source": {
    "connection": "acme_snowflake",
    "query": "SELECT … FROM CUSTOMER_METRICS.FCT_CUSTOMER_ACTIVITY …",
    "asOf": "2026-06-22"
  }
}
```

Se agrega un footer compacto: `_Source: acme_snowflake · as of 2026-06-22_`
más la query en una línea. Ver [Crew tools → notify_send](/es/crew/tools/#notify_send).

## Checklist

- [ ] Cada conexión o dataset declara `description` + `query` (+ `tables`)
- [ ] `refresh` + `as_of` definidos para que los visitantes sepan qué tan frescos están los datos
- [ ] `replication.{build,publish,credentials}` completos — la respuesta "cómo reconstruir"
- [ ] Cada gráfico o tabla con `data-shareout-source` o mapeado en `feeds`
- [ ] `sdk.sources.mount()` (o `<body data-shareout-sources>`) para que los visitantes lo vean
- [ ] Entregas de crew o jobs pasan `source` a `notify_send`
- [ ] El perfil de readiness al publicar no muestra advertencias de `provenance`

## Relacionado

- [Manifest](/es/spec/manifest/) — campos de procedencia y `feeds`
- [SDK Sources](/es/sdk/sources/) — API de `sdk.sources`
- [Publicar artifacts](/es/guides/publishing/) — hallazgos de provenance en `editor_readiness`
- [Conexiones](/es/sdk/connections/) — query en vivo + materialize
- [Crew tools](/es/crew/tools/) — `notify_send` con `source`
