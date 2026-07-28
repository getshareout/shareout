# SDK: Editable Grid

A brand-themed, editable spreadsheet grid for your artifact. Access via `sdk.grid(name, options)`.

Renders a live table users can edit in place — backed by a ShareOut **table** (default) or a connected **Google Sheet**. No grid markup, no styling: link the SDK + stylesheet, call `render()`.

> **Lazy-loaded:** the grid UI (Tabulator + theme, ~440 KB) loads from `/sdk/grid.js` only when you call `render()`. Artifacts that never render a grid download none of it.

## Quick start

```html
<script src="$ORIGIN/sdk/shareout.js"></script>
<link rel="stylesheet" href="$ORIGIN/sdk/shareout.css">
<div id="app"></div>
<script>
  const sdk = await ShareOut.create();
  await sdk.grid('inventory', { editable: true }).render('#app');
</script>
```

Cell edits, new rows, and deletes persist to the `inventory` table automatically.

## `sdk.grid(name, options)`

```typescript
sdk.grid(name: string, options?: {
  source?: 'table' | 'sheets';   // default 'table'
  columns?: GridColumn[];         // optional; inferred from rows when omitted
  editable?: boolean;             // default true
  pageSize?: number;              // default 100
  height?: string;                // e.g. '420px'
  // Sheets source only:
  spreadsheetId?: string;
  spreadsheetUrl?: string;
  range?: string;                 // e.g. 'A1:F'
  sheetName?: string;
}): Grid
```

```typescript
interface GridColumn {
  field: string;
  title: string;
  type: 'text' | 'number' | 'boolean' | 'date';
  editable?: boolean;
}
```

## Grid methods

```typescript
// Mount the editable UI (lazy-loads the grid bundle on first call)
render(target: string | HTMLElement): Promise<GridController>

// Data API — usable without rendering a UI
load(range?: { offset?: number; limit?: number }): Promise<{ rows; columns; hasMore }>
setCell(rowId: string, field: string, value: unknown): Promise<void>
addRow(data?: Record<string, unknown>): Promise<GridRow>
deleteRow(rowId: string): Promise<void>
exportCsv(): Promise<string>

// Tear down a mounted grid
destroy(): void
```

`render()` returns a controller: `{ table, addRow(data?), destroy() }` (`table` is the underlying Tabulator instance for advanced use).

## Table source (default)

Backed by `sdk.table(name)` — durable, queryable, up to 100k rows. Reuses the same storage as [table.md](table.md), so a grid and your other table code share data.

```javascript
const grid = sdk.grid('tasks', {
  columns: [
    { field: 'title', title: 'Task', type: 'text' },
    { field: 'done',  title: 'Done', type: 'boolean' },
    { field: 'due',   title: 'Due',  type: 'date' },
  ],
});
await grid.render('#app');
```

Omit `columns` to infer them from the first page of rows (`id`, `createdAt`, `updatedAt` are hidden).

> **Per-viewer isolation & multi-tenant:** the grid reads/writes the underlying table, so the same server-side access rules apply. See [core/access-policy.md](../core/access-policy.md). Client-side column config does not secure data.

## Google Sheets source

Display and edit a connected Google Sheet inside your artifact. Reuses the Sheets connector — see [integrations/google-sheets.md](../integrations/google-sheets.md) for connecting/authorizing.

```javascript
const grid = sdk.grid('sales', {
  source: 'sheets',
  spreadsheetId: '1AbC...',
  range: 'A1:F',
});
if (!(await sdk.sheets.isConnected())) {
  await sdk.sheets.authorize();   // brand your own "Connect Sheets" CTA around this
}
await grid.render('#app');
```

- Reads via `sdk.sheets.fetch` (header row → columns). Cell edits write back to the exact A1 cell via `sdk.sheets.update`; new rows via `append`.
- **Write-back is direct, last-writer-wins** — there is no diff/merge sync engine. Row delete clears the row's cells (not a structural delete); call `load()` again to resync.
- The first sheet row is treated as the header; data starts at row 2.

## Theming

The grid maps to ShareOut design tokens (`--so-*`) automatically — warm neutrals, ShareOut blue only on focus/selection. Link `shareout.css` so the tokens are defined. Do not invent a different palette; see the design anti-patterns the platform enforces.

## Limitations (v1)

- No formula engine / A1 formulas, multi-sheet tabs, or pivots.
- No live multi-cursor collaboration yet (planned; the data binding is built to add it without changing this API).
- Table source paginates (1000 rows/query, 100k/table) — large grids load by page.
