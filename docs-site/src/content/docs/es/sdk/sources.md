---
title: Fuentes de datos (procedencia)
description: API del SDK para el drawer "¿de dónde vienen estos datos?" y badges por elemento.
---

Convierte la procedencia del `shareout/manifest` en UI para que los visitantes
respondan **¿de dónde vienen estos datos?** sin armar un drawer a mano. Todo del
lado del cliente — sin red, sin permisos.

Ver [Procedencia de datos](/es/guides/data-provenance/) para el patrón del manifest
y el checklist.

## Configuración

Declará procedencia en las fuentes del manifest, vinculá elementos con
`data-shareout-source` o `feeds` en el manifest, y montá:

```javascript
const sdk = await ShareOut.create();
const ctrl = sdk.sources.mount();
```

Auto-montaje sin JS:

```html
<body data-shareout-sources>
```

## Métodos

```typescript
list(): SourceEntry[]
get(ref: string): SourceEntry | null
feeds(): SourceFeed[]
mount(opts?: MountSourcesOptions): SourcesController
open(ref?: string): void
close(): void
```

### `mount(options?)`

Renderiza el botón flotante, el drawer lateral y los badges por elemento.
Devuelve `{ open(ref?), close(), destroy() }`.

| Opción | Default | Propósito |
| --- | --- | --- |
| `title` | `"Data sources"` | Título del drawer |
| `side` | `'right'` | Lado del botón flotante (`'left'` \| `'right'`) |
| `badges` | `true` | Badges "¿de dónde?" por elemento |
| `button` | `true` | Botón flotante de toggle |
| `buttonLabel` | `"Data sources"` | Etiqueta del botón |

Tema vía variables CSS: `--so-src-accent`, `--so-src-bg`, `--so-src-ink`,
`--so-src-card`.

### Tipos

```typescript
interface SourceEntry {
  ref: string;           // "connection:warehouse", "json:revenue", "table:rooms"
  kind: 'connection' | 'json' | 'table';
  key: string;
  label?: string;
  description?: string;
  query?: string;
  tables?: string[];
  refresh?: string;
  asOf?: string;
  replication?: {
    build?: string;
    publish?: string;
    credentials?: string;
    notes?: string;
  };
}

interface SourceFeed {
  element: string;
  source: string;
  note?: string;
}
```

## Ejemplos

```javascript
const sdk = await ShareOut.create();

// Listar todo lo declarado en el manifest
const sources = sdk.sources.list();
const warehouse = sdk.sources.get('connection:warehouse');

// Montar UI
const ctrl = sdk.sources.mount({ side: 'left', title: 'De dónde sale esto' });
ctrl.open('connection:warehouse'); // abrir drawer en una fuente específica
```

## Manifest

La procedencia vive en cada entrada de fuente más `feeds` opcional a nivel raíz:

```html
<script type="shareout/manifest">
{
  "version": "2.0",
  "sources": {
    "connections": {
      "warehouse": {
        "description": "Rollup de actividad 90 días",
        "query": "SELECT …",
        "tables": ["METRICS.FCT_ACTIVITY"],
        "refresh": "daily 12:00 UTC",
        "default": []
      }
    }
  },
  "feeds": [
    { "element": "#chart", "source": "connection:warehouse" }
  ]
}
</script>
```

Ver [Manifest → Procedencia](/es/spec/manifest/#procedencia).
