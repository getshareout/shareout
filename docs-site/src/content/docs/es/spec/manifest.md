---
title: Manifest
description: El bloque shareout/manifest — declarar fuentes de datos, valores calculados y formateadores.
---

Todo artifact debe incluir un bloque `<script type="shareout/manifest">` dentro de
`<head>`, antes del script tag del SDK. Declara cada fuente de datos que usa el artifact.

## Ubicación

```html
<head>
  <script type="shareout/manifest">
  { ... }
  </script>
  <script src="https://shareout.site/sdk/shareout.js"></script>
</head>
```

El manifest debe ir **antes** del script del SDK.

## Esquema

```typescript
interface ShareOutManifest {
  version: "2.0";
  sources?: {
    json?: Record<string, SourceWithProvenance>;
    tables?: Record<string, { schema: TableColumn[]; default?: Record<string, unknown>[] } & SourceProvenance>;
    connections?: Record<string, { default?: unknown[] } & SourceProvenance>;
    blobs?: string[];
    realtime?: string[];
  };
  feeds?: Array<{ element: string; source: string; note?: string }>;
  computed?: Record<string, { formula: string; display?: string }>;
  formatters?: Record<string, { locale?: string; currency?: string; decimals?: number }>;
}

interface SourceProvenance {
  label?: string;
  description?: string;
  query?: string;
  tables?: string[];
  refresh?: string;
  as_of?: string;
  replication?: { build?: string; publish?: string; credentials?: string; notes?: string };
}

type SourceWithProvenance = { default?: any } & SourceProvenance;

interface TableColumn {
  name: string;
  type: "string" | "number" | "boolean" | "date";
  primary?: boolean;
}
```

## Ejemplo completo

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "json": {
      "settings": {
        "default": { "theme": "light", "language": "en" }
      },
      "metrics": {
        "default": { "revenue": 0, "users": 0, "conversion": 0 }
      }
    },
    "tables": {
      "tasks": {
        "schema": [
          { "name": "id",       "type": "string",  "primary": true },
          { "name": "title",    "type": "string" },
          { "name": "done",     "type": "boolean" },
          { "name": "dueDate",  "type": "date" },
          { "name": "priority", "type": "number" }
        ]
      }
    },
    "blobs": ["logo.png"],
    "realtime": ["board-sync"]
  },
  "computed": {
    "completedCount": {
      "formula": "count(tasks:done=true)",
      "display": "Completed Tasks"
    }
  },
  "formatters": {
    "currency": { "locale": "en-US", "currency": "USD" },
    "percent":  { "decimals": 1 }
  }
}
</script>
```

## Sources

### `sources.json`

Declara las keys usadas con `sdk.json`. Cada key puede incluir un valor `default` que el
editor usa para el preview mock.

```json
"json": {
  "settings": { "default": { "theme": "light" } },
  "counter":  { "default": 0 }
}
```

Toda key pasada a `sdk.json.get()`, `sdk.json.set()` o `sdk.json.update()` debe tener
una entrada aquí.

### `sources.tables`

Declara los nombres de tabla usados con `sdk.table()`. Cada tabla requiere un array
`schema`. Toda tabla debe tener exactamente una columna con `"primary": true`.

```json
"tables": {
  "tasks": {
    "schema": [
      { "name": "id",    "type": "string", "primary": true },
      { "name": "title", "type": "string" },
      { "name": "done",  "type": "boolean" }
    ]
  }
}
```

Tipos de columna: `"string"` | `"number"` | `"boolean"` | `"date"`.

Opcionalmente, filas `default` permiten al editor visual previsualizar la tabla sin fetch en vivo.

**Roles de escritura** (`write`, opcional) — aplicados en el servidor en cada mutación de
fila (`insert`, `update`, `delete`). Por defecto `"any"` (quien pueda llegar a la API de
datos del artifact). Las lecturas nunca se restringen.

| Valor | Quién puede mutar filas |
| --- | --- |
| `"any"` (default) | Owner, editores, viewers y (si está habilitado) escritores públicos anónimos |
| `"collaborator"` | Solo el owner del artifact + colaboradores con rol editor |
| `"owner"` | Solo el owner del artifact |

Los viewers que mutan una tabla restringida reciben `403 TABLE_WRITE_FORBIDDEN`.

```json
"tables": {
  "approvals": {
    "write": "owner",
    "schema": [
      { "name": "id", "type": "string", "primary": true },
      { "name": "status", "type": "string" }
    ]
  }
}
```

### `sources.connections`

Declara nombres de conexiones de workspace usados con `sdk.connection()`. Cada conexión
puede incluir un array `default` de filas de muestra. El editor visual resuelve
`sdk.connection(...).query()` desde estos defaults — **sin query live de warehouse ni API** —
así los artifacts con datos gated siguen renderizando y siendo editables en el estudio.

```json
"connections": {
  "team_bigquery": {
    "default": [
      { "region": "West", "revenue": 125000 },
      { "region": "East", "revenue": 98000 }
    ]
  }
}
```

### `sources.blobs`

Array de nombres de archivo usados con `sdk.blobs`.

```json
"blobs": ["logo.png", "document.pdf"]
```

### `sources.realtime`

Array de identificadores de documentos Y.js usados con `sdk.realtime()`.

```json
"realtime": ["board-sync", "cursors"]
```

## Procedencia

Metadatos opcionales en cualquier fuente `json`, `table` o `connection` para que
los visitantes puedan rastrear de dónde vienen los datos. Alimenta el [drawer de
fuentes de datos](/es/sdk/sources/) del SDK y las advertencias de `provenance` en
`editor_readiness` al publicar.

| Campo | Propósito |
| --- | --- |
| `label` | Nombre legible del dataset |
| `description` | Resumen en una línea |
| `query` | SQL, llamada API o paso de build que produjo los datos |
| `tables` | Tablas subyacentes del warehouse o fuente |
| `refresh` | Cadencia (`daily 12:00 UTC`, `manual`, `live`) |
| `as_of` | Fecha u hora del snapshot |
| `replication` | `{ build, publish, credentials, notes }` — cómo reconstruir |

Vinculá cada gráfico o tabla a su fuente:

```html
<div id="chart" data-shareout-source="connection:warehouse"></div>
```

O declará mapeos en la raíz del manifest:

```json
"feeds": [
  { "element": "#chart", "source": "connection:warehouse", "note": "Rollup 90 días" }
]
```

`source` es una ref `kind:key` (`connection:warehouse`, `json:revenue`,
`table:rooms`). Ver [Procedencia de datos](/es/guides/data-provenance/) para el
patrón completo.

## Valores calculados (computed)

Valores derivados calculados a partir de las sources declaradas. Se referencian en
bindings como `computed:NAME`.

```json
"computed": {
  "completedCount": {
    "formula": "count(tasks:done=true)",
    "display": "Completed Tasks"
  }
}
```

Funciones de fórmula disponibles:

| Fórmula | Ejemplo | Descripción |
|---------|---------|-------------|
| `count(table:field)` | `count(tasks:id)` | Contar todas las filas |
| `count(table:field:filter)` | `count(tasks:id:done=true)` | Contar filas filtradas |
| `sum(table:field)` | `sum(orders:amount)` | Sumar un campo numérico |
| `avg(table:field)` | `avg(orders:amount)` | Promedio de un campo numérico |
| `min(table:field)` | `min(products:price)` | Valor mínimo |
| `max(table:field)` | `max(products:price)` | Valor máximo |

## Formateadores

Definiciones de formato con nombre reutilizables en atributos `data-shareout-format`:

```json
"formatters": {
  "currency": { "locale": "en-US", "currency": "USD" },
  "percent":  { "decimals": 1 },
  "number":   { "locale": "en-US" }
}
```

## Reglas del manifest

1. Debe ser el primer script en `<head>`, antes del script tag del SDK.
2. Debe incluir `"version": "2.0"`.
3. Debe declarar cada key de `sdk.json` usada en el artifact.
4. Debe declarar cada nombre de `sdk.table()` usado en el artifact.
5. El esquema de toda tabla debe incluir una columna de clave primaria.
6. Incluí valores `default` en json, tablas y conexiones para que el editor pueda mostrar previews offline.

## Relacionado

- [Resumen](/es/spec/overview/) — checklist de cumplimiento y referencia de atributos
- [Bindings](/es/spec/bindings/) — usar sources del manifest en expresiones de binding
- [JSON store](/es/sdk/json/) — API de `sdk.json`
- [Tables](/es/sdk/tables/) — API de `sdk.table()`
- [Procedencia de datos](/es/guides/data-provenance/) — campos del manifest + drawer para visitantes
- [SDK Sources](/es/sdk/sources/) — API de `sdk.sources`
