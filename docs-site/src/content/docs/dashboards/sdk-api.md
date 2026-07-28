---
title: Dashboards SDK API
description: Complete method reference for sdk.dashboards — create, open, widgets, filters, layout, presenter, and more.
---

Access the dashboards namespace via `sdk.dashboards`. A dashboard session
(`Dashboard` instance) is opened with `sdk.dashboards.open()` or
`sdk.dashboards.view()` and communicates over a live Y.js CRDT document.

The `visibility` field accepts `private`, `workspace`, and `public`. (`unlisted`
is a retired legacy alias, still accepted on the API and treated as `public`.)

## Top-level: `sdk.dashboards`

### `sdk.dashboards.create()`

```typescript
create(options: CreateOptions): Promise<CreateResult>

interface CreateOptions {
  title: string;
  description?: string;
  template?: string;
  layout?: 'fixed' | 'responsive';
  columns?: number;          // default 12
  rowHeight?: number;        // default 80 (px)
  visibility?: 'private' | 'workspace' | 'public';
}

interface CreateResult {
  id: string;
  editorUrl: string;         // shareout.site/a/{slug}
  publishedUrl: string;      // shareout.site/p/{slug}
  editorArtifactId: string;
  publishedArtifactId: string;
}
```

```javascript
const result = await sdk.dashboards.create({
  title: 'Sales Dashboard',
  visibility: 'public',
});
```

### `sdk.dashboards.open()`

Open a dashboard for editing. Requires authentication. Returns a connected
`Dashboard` instance.

```typescript
open(id: string): Promise<Dashboard>
```

### `sdk.dashboards.view()`

Open a dashboard in published/view mode. No authentication required for
`public` dashboards.

```typescript
view(id: string): Promise<Dashboard>
```

### `sdk.dashboards.list()`

```typescript
list(): Promise<DashboardInfo[]>

interface DashboardInfo {
  id: string;
  title: string;
  widgetCount: number;
  editorUrl: string;
  publishedUrl: string;
  visibility: 'private' | 'workspace' | 'public';
  createdAt: string;
  updatedAt: string;
}
```

### `sdk.dashboards.delete()`

```typescript
delete(id: string): Promise<boolean>
```

Returns `false` if not found, throws on other errors.

---

## Dashboard instance

Returned by `open()` and `view()`. The connection is established automatically
by both methods; you do not need to call `connect()` manually.

```typescript
connect(): Promise<void>    // re-connect after disconnect
disconnect(): void          // disconnect but keep document
destroy(): void             // full cleanup
```

---

## `dashboard.meta`

Dashboard-level settings. Properties set here cascade to all widgets unless a
widget specifies an override.

### `meta.get()`

```typescript
get(): DashboardMeta

interface DashboardMeta {
  id: string;
  title: string;
  description: string;

  // Layout
  layout: 'fixed' | 'responsive';
  columns: number;
  rowHeight: number;
  gap: number;
  padding: number;

  // Cascading visual defaults (inherited by widgets)
  defaultFont: { heading: string; body: string; mono: string };
  defaultColors: {
    background: string;
    surface: string;
    text: string;
    textSecondary: string;
    accent: string;
    positive: string;
    negative: string;
    neutral: string;
  };

  // Data defaults
  refreshInterval: number | null;   // auto-refresh in seconds
  timezone: string;
  dateFormat: string;
  numberFormat: { locale: string; currency?: string };

  createdBy: string;
  updatedAt: string;
}
```

### `meta.set()`

```typescript
set(changes: Partial<DashboardMeta>): void
```

```javascript
dashboard.meta.set({
  title: 'Q4 Sales Dashboard',
  defaultColors: {
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    accent: '#3b82f6',
  },
  refreshInterval: 300,
});
```

### `meta.observe()`

```typescript
observe(handler: (meta: DashboardMeta) => void): () => void
```

Returns an unsubscribe function.

---

## `dashboard.widgets`

### `widgets.list()`

```typescript
list(): Widget[]

interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  dataSource: string | null;
  query?: DataQuery;
  config: WidgetConfig;
  overrides?: WidgetOverrides;
  owner: string | null;
  locked: boolean;
}

type WidgetType = 'kpi' | 'chart' | 'table' | 'text' | 'image' | 'embed' | 'filter' | 'html';

interface DataQuery {
  filter?: Record<string, any>;
  sort?: { field: string; order: 'asc' | 'desc' };
  limit?: number;
  transform?: string;   // JavaScript transform expression
}

interface WidgetOverrides {
  surface?: string;
  font?: { heading?: string; body?: string; mono?: string };
}
```

### `widgets.get()`

```typescript
get(id: string): Widget | null
```

### `widgets.add()`

```typescript
add(type: WidgetType, config: WidgetConfig, position?: LayoutItem): Widget

interface LayoutItem {
  x: number;     // column start (0-indexed)
  y: number;     // row start
  w: number;     // width in columns
  h: number;     // height in rows
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
}
```

Config shapes per type — see [KPI config](#kpi-config), [Chart config](#chart-config), [Table config](#table-config) below.

### `widgets.update()`

```typescript
update(id: string, changes: Partial<Widget>): void
```

### `widgets.delete()`

```typescript
delete(id: string): boolean
```

### `widgets.duplicate()`

```typescript
duplicate(id: string): Widget
```

### `widgets.observe()`

```typescript
observe(handler: (widgets: Widget[]) => void): () => void
```

### `widgets.getContent()` / `widgets.setContent()`

For `html` and `text` widgets. `getContent()` returns a `Y.Text` for
collaborative binding; `setContent()` replaces content directly.

```typescript
getContent(id: string): Y.Text
setContent(id: string, html: string): void
```

### `widgets.setOwner()` / `widgets.lock()` / `widgets.unlock()`

```typescript
setOwner(id: string, userId: string | null): void
lock(id: string): void
unlock(id: string): void
```

Locked widgets can only be edited by their `owner`.

---

## `dashboard.layout`

Grid position management.

```typescript
get(): LayoutItem[]
update(widgetId: string, position: Partial<LayoutItem>): void
move(widgetId: string, x: number, y: number): void
resize(widgetId: string, w: number, h: number): void
observe(handler: (layout: LayoutItem[]) => void): () => void
```

---

## `dashboard.dataSources`

Bind widgets to data. See [Data sources](/dashboards/data-sources/) for when to use
each type and truncation rules.

```typescript
type DataSourceType =
  | 'static' | 'api' | 'sql' | 'shareout' | 'dataset' | 'csv' | 'websocket';

interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  config: DataSourceConfig;
  refreshInterval?: number;
  lastRefreshed?: string;
  truncated?: boolean;       // last refresh hit a row cap
  lastWarning?: string | null;
}

interface DataSourceConfig {
  data?: unknown[];                    // static
  url?: string; method?: 'GET' | 'POST'; headers?: Record<string, string>; body?: unknown; // api
  connectionId?: string; query?: string; // sql
  tableId?: string;                    // shareout table
  datasetName?: string;                // dataset extract
  limit?: number;                      // optional row cap (table ≤ 1000)
}
```

### Methods

```typescript
list(): DataSource[]
add(config: Omit<DataSource, 'id'>): DataSource
update(id: string, changes: Partial<DataSource>): void
delete(id: string): boolean
refresh(id: string): Promise<void>
refreshAll(): Promise<void>
getData(id: string): any[]
getFilteredData(id: string, filters?: FilterState): any[]
isTruncated(id: string): boolean
observe(id: string, handler: (data: any[]) => void): () => void
```

```javascript
// Static data
dashboard.dataSources.add({
  name: 'Sales Data',
  type: 'static',
  config: { data: salesArray },
});

// REST API with auto-refresh
dashboard.dataSources.add({
  name: 'Live Metrics',
  type: 'api',
  config: {
    url: 'https://api.example.com/metrics',
    method: 'GET',
    headers: { Authorization: 'Bearer ...' },
  },
  refreshInterval: 60,
});

// ShareOut table (max 1000 rows per refresh — check isTruncated())
dashboard.dataSources.add({
  name: 'Customers',
  type: 'shareout',
  config: { tableId: 'customers' },
});

// Materialized dataset (full extract, or page with config.limit)
dashboard.dataSources.add({
  name: 'Shipments extract',
  type: 'dataset',
  config: { datasetName: 'shipments' },
});

// Live SQL / warehouse connection
dashboard.dataSources.add({
  name: 'Warehouse KPIs',
  type: 'sql',
  config: {
    connectionId: 'warehouse',
    query: 'SELECT region, SUM(revenue) AS revenue FROM sales GROUP BY 1',
  },
  refreshInterval: 300,
});
```

---

## `dashboard.filters`

### Filter definitions

```typescript
interface FilterDefinition {
  id: string;
  type: 'select' | 'multiselect' | 'daterange' | 'numberrange' | 'search';
  label: string;
  dataSource?: string;
  field?: string;
  options?: { value: string; label: string }[];
  defaultValue?: FilterValue;
  affects: string[];    // widget IDs or '*' for all
}

type FilterValue =
  | string
  | string[]
  | { from: string; to: string }
  | { min: number; max: number };
```

### Methods

```typescript
getDefinitions(): FilterDefinition[]
addDefinition(def: Omit<FilterDefinition, 'id'>): FilterDefinition
updateDefinition(id: string, changes: Partial<FilterDefinition>): void
deleteDefinition(id: string): boolean
getState(): FilterState       // { [filterId]: FilterValue }
setValue(filterId: string, value: FilterValue): void
reset(): void                 // reset all to defaults
observe(handler: (state: FilterState) => void): () => void
```

---

## `dashboard.presets`

Saved filter combinations for quick access.

```typescript
interface FilterPreset {
  id: string;
  name: string;
  description?: string;
  icon?: string;
  color?: string;
  filters: FilterState;
  isDefault: boolean;
  isPinned: boolean;
  isShared: boolean;
  createdBy: string;
  createdAt: string;
}
```

```typescript
list(): FilterPreset[]
create(preset: Omit<FilterPreset, 'id' | 'createdAt'>): FilterPreset
update(id: string, changes: Partial<FilterPreset>): void
delete(id: string): boolean
apply(id: string): void
setDefault(id: string | null): void
getDefault(): FilterPreset | null
pin(id: string): void
unpin(id: string): void
getPinned(): FilterPreset[]
observe(handler: (presets: FilterPreset[]) => void): () => void
```

```javascript
dashboard.presets.create({
  name: 'Q4 2026',
  icon: '📊',
  filters: dashboard.filters.getState(),
  isPinned: true,
  isShared: true,
  isDefault: false,
});

dashboard.presets.apply('preset-q4-2026');
dashboard.presets.setDefault('preset-this-week');
```

---

## `dashboard.interactions`

Cross-widget interactions: clicking one widget filters others.

```typescript
interface InteractionConfig {
  id?: string;
  trigger: {
    widgetId: string;
    event: 'click' | 'select' | 'hover';
    field?: string;
  };
  action: {
    type: 'filter' | 'navigate' | 'highlight' | 'custom';
    target: string | string[];    // widget IDs or '*'
    config: any;
  };
}
```

```typescript
define(config: InteractionConfig): string       // returns interaction ID
remove(id: string): void
list(): InteractionConfig[]
trigger(widgetId: string, event: 'click' | 'select' | 'hover', data: Record<string, unknown>): void
onInteraction(handler: (event: InteractionEvent) => void): () => void
onWidgetInteraction(widgetId: string, handler: (event: InteractionEvent) => void): () => void
```

```javascript
dashboard.interactions.define({
  trigger: { widgetId: 'sales-chart', event: 'click', field: 'region' },
  action: {
    type: 'filter',
    target: ['sales-table', 'kpi-revenue'],
    config: { filterField: 'region' },
  },
});
```

---

## `dashboard.presenter`

Presenter mode syncs focus, pointer, and cycling to all viewers in real time.

```typescript
start(options?: PresenterOptions): Promise<void>
stop(): void
state(): DashboardPresentationState
isActive(): boolean
isPresenter(): boolean

// Widget focus
focusWidget(widgetId: string): void
clearFocus(): void
nextWidget(): void
previousWidget(): void

// Auto-cycling
startCycle(options?: CycleOptions): void
stopCycle(): void

// Timer
timer.elapsed(): number
timer.setCountdown(seconds: number): void
timer.remaining(): number | null
timer.pause(): void
timer.resume(): void

// Pointer
pointer.enable(): void
pointer.disable(): void
pointer.move(x: number, y: number): void

subscribe(handler: (state: DashboardPresentationState) => void): () => void
```

```javascript
await dashboard.presenter.start({ countdown: 1800 });   // 30-min timer
dashboard.presenter.focusWidget('kpi-revenue');
dashboard.presenter.startCycle({ interval: 30, loop: true });
```

---

## `dashboard.versions`

```typescript
versions.list(): Promise<Version[]>
versions.create(name: string, description?: string): Promise<Version>
versions.restore(versionId: string): Promise<void>
versions.diff(fromId: string, toId: string): Promise<VersionDiff>
versions.delete(versionId: string): Promise<boolean>
versions.subscribe(handler: (versions: Version[]) => void): () => void
```

```javascript
await dashboard.versions.create('Before meeting', 'Snapshot before live edits');
const versions = await dashboard.versions.list();
await dashboard.versions.restore(versions[2].id);
```

---

## `dashboard.publish`

```typescript
getUrl(): string                                            // shareout.site/p/{slug}
setVisibility(v: 'private' | 'workspace' | 'public'): void
unpublish(): void
republish(): void
```

---

## `dashboard.presence`

Ephemeral user presence over WebSocket (not persisted in the Y.js document).

```typescript
set(state: Partial<DashboardPresenceState>): void
get(): Map<string, DashboardPresenceState>
subscribe(handler: (users: Map<string, DashboardPresenceState>) => void): () => void
```

---

## `dashboard.undo`

Per-user undo stack scoped to the current user's own changes.

```typescript
undo.manager(): Y.UndoManager
undo.canUndo(): boolean
undo.canRedo(): boolean
undo.undo(): void
undo.redo(): void
```

---

## `dashboard.transact()`

Batch multiple changes into a single undo step.

```typescript
transact(fn: () => void): void
```

```javascript
dashboard.transact(() => {
  const widget = dashboard.widgets.add('kpi', config, position);
  dashboard.widgets.setOwner(widget.id, currentUserId);
});
// Both changes appear as one undo step
```

---

## Events

```typescript
dashboard.on(event: DashboardEvent, handler: Function): void
dashboard.off(event: DashboardEvent, handler: Function): void

type DashboardEvent =
  | 'widget:added' | 'widget:deleted' | 'widget:updated'
  | 'layout:changed'
  | 'filter:changed'
  | 'data:refreshed'
  | 'presentation:start' | 'presentation:end'
  | 'sync' | 'status';
```

---

## `sdk.dashboards.helpers`

Formatting and data utilities.

```typescript
helpers.formatNumber(value: number, options?: Intl.NumberFormatOptions): string
helpers.formatCurrency(value: number, currency?: string): string
helpers.formatPercent(value: number, decimals?: number): string
helpers.formatDate(date: Date | string, format?: string): string

helpers.getColorScale(type: 'sequential' | 'diverging' | 'categorical', name?: string): string[]
helpers.getSemanticColor(type: 'positive' | 'negative' | 'neutral' | 'warning'): string

helpers.aggregate(data: any[], groupBy: string, aggs: Aggregation[]): any[]
helpers.pivot(data: any[], rows: string, cols: string, values: string): any[]
helpers.timeSeries(data: any[], dateField: string, interval: 'day' | 'week' | 'month'): any[]
```

---

## Widget config types

### KPI config

```typescript
interface KPIConfig {
  value: string;
  label: string;
  format: 'number' | 'currency' | 'percent' | 'custom';
  formatOptions?: Intl.NumberFormatOptions;
  comparison?: {
    value: string;
    type: 'absolute' | 'percent';
    invertColors?: boolean;
  };
  sparkline?: { field: string; type: 'line' | 'bar' | 'area' };
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
}
```

### Chart config

```typescript
interface ChartConfig {
  chartType: 'line' | 'bar' | 'area' | 'pie' | 'donut' | 'scatter' | 'heatmap' | 'gauge' | 'funnel' | 'treemap';
  xAxis?: { field: string; type: 'category' | 'time' | 'value'; label?: string };
  yAxis?: { field: string; label?: string; min?: number; max?: number };
  series?: { field: string; name?: string; color?: string }[];
  nameField?: string;
  valueField?: string;
  legend?: { show: boolean; position: 'top' | 'bottom' | 'left' | 'right' };
  tooltip?: { show: boolean };
  animation?: boolean;
}
```

### Table config

```typescript
interface TableConfig {
  columns: TableColumn[];
  pageSize?: number;
  sortable?: boolean;
  filterable?: boolean;
  exportable?: boolean;
  selectable?: boolean;
  condensed?: boolean;
  striped?: boolean;
}

interface TableColumn {
  field: string;
  header: string;
  width?: string;
  align?: 'left' | 'center' | 'right';
  format?: 'text' | 'number' | 'currency' | 'percent' | 'date' | 'boolean' | 'link' | 'image' | 'badge';
  sortable?: boolean;
  filterable?: boolean;
}
```

### Text config

```typescript
interface TextConfig {
  content: string;
  contentType: 'markdown' | 'html';
  align?: 'left' | 'center' | 'right';
  padding?: number;
}
```

### HTML config

```typescript
interface HTMLConfig {
  content: string;
  scripts?: boolean;   // default false
}
```

---

## Data model

The Y.js document backing each dashboard has the following top-level maps:

| Map | Type | Contents |
| --- | --- | --- |
| `meta` | `Y.Map` | Dashboard metadata and cascading visual properties |
| `widgets` | `Y.Map<string, Widget>` | Widget definitions keyed by widget ID |
| `widgetContent` | `Y.Map<string, Y.Text>` | Collaborative HTML/text content for html and text widgets |
| `layout` | `Y.Map<string, LayoutItem>` | Grid positions keyed by widget ID |
| `dataSources` | `Y.Map<string, DataSource>` | Data connection configs |
| `filters` | `Y.Map<string, FilterValue>` | Current filter state |
| `filterDefs` | `Y.Array<FilterDefinition>` | Filter definitions |
| `filterPresets` | `Y.Map<string, FilterPreset>` | Saved filter combinations |
| `interactions` | `Y.Map<string, InteractionConfig>` | Cross-widget interaction configs |
| `presentationState` | `Y.Map` | Live presenter state (synced to all viewers) |

Presence state is ephemeral — it is not in the Y.js document; it travels over
the WebSocket only.

Version snapshots are stored separately as Y.js encoded state vectors in the
`dashboard_versions` table, not embedded in the live document.
