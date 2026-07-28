---
title: Grilla editable
description: Grilla tipo hoja de cálculo con la marca ShareOut, respaldada por una tabla o Google Sheets.
---

import { Aside } from '@astrojs/starlight/components';

Una grilla editable con la estética de ShareOut para tu artifact. Accedé vía
`sdk.grid(name, options)`.

Renderiza una tabla en vivo que los usuarios pueden editar en el lugar — respaldada
por una **tabla** de ShareOut (por defecto) o una **Google Sheet** conectada. Enlazá
el SDK + la hoja de estilos y llamá a `render()` — no hace falta markup ni estilos
propios de grilla.

<Aside>
La UI de la grilla (Tabulator + tema, ~440 KB) se carga desde `/sdk/grid.js` solo
cuando llamás a `render()`. Los artifacts que nunca renderizan una grilla no la
descargan.
</Aside>

## Inicio rápido

```html
<script src="https://shareout.site/sdk/shareout.js"></script>
<link rel="stylesheet" href="https://shareout.site/sdk/shareout.css">
<div id="app"></div>
<script>
  const sdk = await ShareOut.create();
  await sdk.grid('inventory', { editable: true }).render('#app');
</script>
```

Las ediciones de celdas, filas nuevas y borrados se persisten en la tabla
`inventory` automáticamente.

## `sdk.grid(name, options)`

```typescript
sdk.grid(name: string, options?: {
  source?: 'table' | 'sheets';   // por defecto 'table'
  columns?: GridColumn[];
  editable?: boolean;             // por defecto true
  pageSize?: number;              // por defecto 100
  height?: string;
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  range?: string;
  sheetName?: string;
}): Grid
```

## Métodos de la grilla

```typescript
render(target: string | HTMLElement): Promise<GridController>
load(range?: { offset?: number; limit?: number }): Promise<{ rows; columns; hasMore }>
setCell(rowId: string, field: string, value: unknown): Promise<void>
addRow(data?: Record<string, unknown>): Promise<GridRow>
deleteRow(rowId: string): Promise<void>
exportCsv(): Promise<string>
destroy(): void
```

## Fuente tabla (por defecto)

Respaldada por [`sdk.table(name)`](/es/sdk/tables/) — durable, consultable, hasta
100k filas.

```javascript
const grid = sdk.grid('tasks', {
  columns: [
    { field: 'title', title: 'Tarea', type: 'text' },
    { field: 'done',  title: 'Hecho', type: 'boolean' },
    { field: 'due',   title: 'Vence', type: 'date' },
  ],
});
await grid.render('#app');
```

## Fuente Google Sheets

```javascript
const grid = sdk.grid('sales', {
  source: 'sheets',
  spreadsheetId: '1AbC...',
  range: 'A1:F',
});
if (!(await sdk.sheets.isConnected())) {
  await sdk.sheets.authorize();
}
await grid.render('#app');
```

## Tema

La grilla usa los tokens de diseño de ShareOut (`--so-*`). Enlazá `shareout.css`.

## Limitaciones (v1)

- Sin motor de fórmulas, pestañas múltiples ni pivots.
- Sin colaboración multi-cursor en vivo todavía.
- La fuente tabla pagina (1000 filas/consulta, 100k/tabla).
