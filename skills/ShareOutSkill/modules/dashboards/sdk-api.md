# SDK.dashboards API Reference

Complete API documentation for the ShareOut Dashboards namespace.

## Namespace Structure

```typescript
interface ShareOut {
  // Existing namespaces
  json: JsonStore;
  table(name: string): Table;
  realtime(docId: string): RealtimeDoc;
  comments: Comments;
  blobs: Blobs;
  collaborators: Collaborators;
  slides: SlidesSDK;

  // Dashboards namespace
  dashboards: DashboardsSDK;
}
```

---

## DashboardsSDK

Top-level dashboards management.

### sdk.dashboards.create()

Create a new dashboard.

```typescript
create(options: CreateOptions): Promise<CreateResult>

interface CreateOptions {
  title: string;
  description?: string;
  template?: string;              // Template ID
  layout?: 'fixed' | 'responsive';
  columns?: number;               // Default: 12
  rowHeight?: number;             // Default: 80px
  visibility?: 'public' | 'private';  // 'unlisted' is a retired legacy alias, still accepted and treated as 'public'
}

interface CreateResult {
  id: string;
  editorUrl: string;              // $ORIGIN_HOST/a/{slug}
  publishedUrl: string;           // $ORIGIN_HOST/p/{slug}
  editorArtifactId: string;
  publishedArtifactId: string;
}
```

**Example:**

```javascript
const result = await sdk.dashboards.create({
  title: 'Sales Dashboard',
  columns: 12,
  visibility: 'public'
});

console.log(result.editorUrl);    // $ORIGIN_HOST/a/sales-dashboard
console.log(result.publishedUrl); // $ORIGIN_HOST/p/sales-dashboard
```

### sdk.dashboards.open()

Open a dashboard for editing (requires authentication).

```typescript
open(id: string): Promise<Dashboard>
```

**Example:**

```javascript
const dashboard = await sdk.dashboards.open('sales-dashboard');
await dashboard.connect();
```

### sdk.dashboards.view()

Open a dashboard for viewing (published mode).

```typescript
view(id: string): Promise<Dashboard>
```

### sdk.dashboards.list()

List all dashboards for this artifact.

```typescript
list(): Promise<DashboardInfo[]>

interface DashboardInfo {
  id: string;
  title: string;
  widgetCount: number;
  editorUrl: string;
  publishedUrl: string;
  visibility: 'public' | 'private';
  createdAt: string;
  updatedAt: string;
}
```

### sdk.dashboards.delete()

Delete a dashboard.

```typescript
delete(id: string): Promise<boolean>
```

---

## Dashboard Instance

Returned by `sdk.dashboards.open()` or `sdk.dashboards.view()`.

### Connection

```typescript
// Connect to realtime document
connect(): Promise<void>

// Disconnect (keeps document)
disconnect(): void

// Destroy (cleanup resources)
destroy(): void
```

---

## dashboard.meta

Dashboard metadata with cascading properties.

### meta.get()

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

  // Cascading visual properties
  defaultFont: {
    heading: string;
    body: string;
    mono: string;
  };
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
  refreshInterval: number | null;
  timezone: string;
  dateFormat: string;
  numberFormat: { locale: string; currency?: string };

  createdBy: string;
  updatedAt: string;
}
```

### meta.set()

```typescript
set(changes: Partial<DashboardMeta>): void
```

**Example:**

```javascript
dashboard.meta.set({
  title: 'Q4 Sales Dashboard',
  defaultColors: {
    background: '#0f172a',
    surface: '#1e293b',
    text: '#f8fafc',
    accent: '#3b82f6'
  },
  refreshInterval: 300  // 5 minutes
});
```

### meta.observe()

```typescript
observe(handler: (meta: DashboardMeta) => void): () => void
```

---

## dashboard.widgets

Widget CRUD and content management.

### widgets.list()

Get all widgets.

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
```

### widgets.get()

```typescript
get(id: string): Widget | null
```

### widgets.add()

Add a new widget.

```typescript
add(type: WidgetType, config: WidgetConfig, position?: LayoutItem): Widget

interface LayoutItem {
  x: number;      // Grid column start (0-indexed)
  y: number;      // Grid row start
  w: number;      // Width in columns
  h: number;      // Height in rows
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
}
```

**Example:**

```javascript
// KPI widget
const kpi = dashboard.widgets.add('kpi', {
  value: 'total_revenue',
  label: 'Total Revenue',
  format: 'currency',
  comparison: {
    value: 'prev_month_revenue',
    type: 'percent'
  }
}, { x: 0, y: 0, w: 3, h: 2 });

// Chart widget
const chart = dashboard.widgets.add('chart', {
  chartType: 'line',
  xAxis: { field: 'date', type: 'time', label: 'Date' },
  yAxis: { field: 'revenue', label: 'Revenue ($)' },
  series: [
    { field: 'revenue', name: 'Actual', color: '#3b82f6' },
    { field: 'target', name: 'Target', color: '#94a3b8' }
  ]
}, { x: 0, y: 2, w: 6, h: 4 });
```

### widgets.update()

```typescript
update(id: string, changes: Partial<Widget>): void
```

**Example:**

```javascript
dashboard.widgets.update('kpi-revenue', {
  title: 'Total Revenue (YTD)',
  config: {
    format: 'currency',
    formatOptions: { notation: 'compact' }
  }
});
```

### widgets.delete()

```typescript
delete(id: string): boolean
```

### widgets.duplicate()

```typescript
duplicate(id: string): Widget
```

### widgets.observe()

Subscribe to widget changes.

```typescript
observe(handler: (widgets: Widget[]) => void): () => void
```

### widgets.getContent()

Get widget HTML as Y.Text for collaborative binding (html/text widgets).

```typescript
getContent(id: string): Y.Text
```

### widgets.setContent()

Set widget HTML content directly.

```typescript
setContent(id: string, html: string): void
```

### widgets.setOwner()

Assign per-widget ownership.

```typescript
setOwner(id: string, userId: string | null): void
```

### widgets.lock() / unlock()

Lock widget from editing except by owner.

```typescript
lock(id: string): void
unlock(id: string): void
```

---

## dashboard.layout

Grid layout management.

### layout.get()

```typescript
get(): LayoutItem[]
```

### layout.update()

```typescript
update(widgetId: string, position: Partial<LayoutItem>): void
```

### layout.move()

```typescript
move(widgetId: string, x: number, y: number): void
```

### layout.resize()

```typescript
resize(widgetId: string, w: number, h: number): void
```

### layout.observe()

```typescript
observe(handler: (layout: LayoutItem[]) => void): () => void
```

---

## dashboard.dataSources

Data source connections.

### dataSources.list()

```typescript
list(): DataSource[]

interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  config: DataSourceConfig;
  refreshInterval?: number;
  lastRefreshed?: string;
}

type DataSourceType = 'static' | 'api' | 'sql' | 'shareout' | 'csv' | 'websocket';
```

### dataSources.add()

```typescript
add(config: Omit<DataSource, 'id'>): DataSource
```

**Example:**

```javascript
// Static data
dashboard.dataSources.add({
  name: 'Sales Data',
  type: 'static',
  config: { data: salesData }
});

// REST API with auto-refresh
dashboard.dataSources.add({
  name: 'Live Metrics',
  type: 'api',
  config: {
    url: 'https://api.example.com/metrics',
    method: 'GET',
    headers: { 'Authorization': 'Bearer ...' }
  },
  refreshInterval: 60
});

// ShareOut table
dashboard.dataSources.add({
  name: 'Customers',
  type: 'shareout',
  config: { tableId: 'customers' }
});
```

### dataSources.update()

```typescript
update(id: string, changes: Partial<DataSource>): void
```

### dataSources.delete()

```typescript
delete(id: string): boolean
```

### dataSources.refresh()

Manually refresh a data source.

```typescript
refresh(id: string): Promise<void>
```

### dataSources.refreshAll()

Refresh all data sources.

```typescript
refreshAll(): Promise<void>
```

### dataSources.getData()

Get current data from a source.

```typescript
getData(id: string): any[]
```

### dataSources.getFilteredData()

Get data filtered by current filter state.

```typescript
getFilteredData(id: string): any[]
```

### dataSources.observe()

Subscribe to data changes.

```typescript
observe(id: string, handler: (data: any[]) => void): () => void
```

---

## dashboard.filters

Filter system for interactive filtering.

### filters.getDefinitions()

```typescript
getDefinitions(): FilterDefinition[]

interface FilterDefinition {
  id: string;
  type: 'select' | 'multiselect' | 'daterange' | 'numberrange' | 'search';
  label: string;
  dataSource?: string;
  field?: string;
  options?: { value: string; label: string }[];
  defaultValue?: FilterValue;
  affects: string[];  // Widget IDs or '*' for all
}
```

### filters.addDefinition()

```typescript
addDefinition(def: Omit<FilterDefinition, 'id'>): FilterDefinition
```

**Example:**

```javascript
// Dropdown filter
dashboard.filters.addDefinition({
  type: 'select',
  label: 'Region',
  options: [
    { value: 'na', label: 'North America' },
    { value: 'eu', label: 'Europe' },
    { value: 'apac', label: 'Asia Pacific' }
  ],
  affects: '*'
});

// Date range filter
dashboard.filters.addDefinition({
  type: 'daterange',
  label: 'Period',
  defaultValue: { from: '2026-01-01', to: '2026-12-31' },
  affects: ['chart-revenue', 'table-details']
});
```

### filters.updateDefinition()

```typescript
updateDefinition(id: string, changes: Partial<FilterDefinition>): void
```

### filters.deleteDefinition()

```typescript
deleteDefinition(id: string): boolean
```

### filters.getState()

```typescript
getState(): FilterState

interface FilterState {
  [filterId: string]: FilterValue;
}

type FilterValue =
  | string
  | string[]
  | { from: string; to: string }
  | { min: number; max: number };
```

### filters.setValue()

```typescript
setValue(filterId: string, value: FilterValue): void
```

### filters.reset()

Reset all filters to defaults.

```typescript
reset(): void
```

### filters.observe()

```typescript
observe(handler: (state: FilterState) => void): () => void
```

---

## dashboard.presets

Filter presets (saved views).

### presets.list()

```typescript
list(): FilterPreset[]

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

### presets.create()

```typescript
create(preset: Omit<FilterPreset, 'id' | 'createdAt'>): FilterPreset
```

**Example:**

```javascript
dashboard.presets.create({
  name: 'Q4 2026',
  description: 'Fourth quarter analysis',
  icon: '📊',
  filters: dashboard.filters.getState(),
  isPinned: true,
  isShared: true
});
```

### presets.update()

```typescript
update(id: string, changes: Partial<FilterPreset>): void
```

### presets.delete()

```typescript
delete(id: string): boolean
```

### presets.apply()

Apply a preset's filters.

```typescript
apply(id: string): void
```

### presets.setDefault()

Set default preset (auto-applied on load).

```typescript
setDefault(id: string | null): void
```

### presets.getDefault()

```typescript
getDefault(): FilterPreset | null
```

### presets.pin() / unpin()

```typescript
pin(id: string): void
unpin(id: string): void
```

### presets.getPinned()

```typescript
getPinned(): FilterPreset[]
```

### presets.observe()

```typescript
observe(handler: (presets: FilterPreset[]) => void): () => void
```

---

## dashboard.interactions

Cross-widget interactions.

### interactions.define()

```typescript
define(config: InteractionConfig): string

interface InteractionConfig {
  id?: string;
  trigger: {
    widgetId: string;
    event: 'click' | 'select' | 'hover';
    field?: string;
  };
  action: {
    type: 'filter' | 'navigate' | 'highlight' | 'custom';
    target: string | string[];  // Widget IDs or '*'
    config: any;
  };
}
```

**Example:**

```javascript
// Clicking bar chart filters table
dashboard.interactions.define({
  trigger: {
    widgetId: 'sales-chart',
    event: 'click',
    field: 'region'
  },
  action: {
    type: 'filter',
    target: ['sales-table', 'kpi-revenue'],
    config: { filterField: 'region' }
  }
});
```

### interactions.remove()

```typescript
remove(id: string): void
```

### interactions.list()

```typescript
list(): InteractionConfig[]
```

### interactions.trigger()

Programmatically trigger an interaction.

```typescript
trigger(widgetId: string, event: 'click' | 'select' | 'hover', data: Record<string, unknown>): void
```

### interactions.onInteraction()

Subscribe to all interactions.

```typescript
onInteraction(handler: (event: InteractionEvent) => void): () => void
```

### interactions.onWidgetInteraction()

Subscribe to interactions for a specific widget.

```typescript
onWidgetInteraction(widgetId: string, handler: (event: InteractionEvent) => void): () => void
```

---

## dashboard.presenter

Presenter mode controls. See [presenter-mode.md](presenter-mode.md) for details.

### presenter.start()

```typescript
start(options?: PresenterOptions): Promise<void>

interface PresenterOptions {
  focusWidgetId?: string;
  countdown?: number;
  hideFilters?: boolean;
  autoRefresh?: boolean;
}
```

### presenter.stop()

```typescript
stop(): void
```

### presenter.state()

```typescript
state(): DashboardPresentationState

interface DashboardPresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  presenterName: string | null;
  focusedWidgetId: string | null;
  startedAt: number | null;
  countdown: { total: number; remaining: number; paused: boolean } | null;
  cycling: { active: boolean; currentIndex: number; widgetIds: string[] } | null;
  pointer: { enabled: boolean; position: { x: number; y: number } | null };
}
```

### presenter.isActive()

```typescript
isActive(): boolean
```

### presenter.isPresenter()

```typescript
isPresenter(): boolean
```

### Widget Focus

```typescript
focusWidget(widgetId: string): void
clearFocus(): void
nextWidget(): void
previousWidget(): void
```

### Widget Cycling

```typescript
startCycle(options?: CycleOptions): void
stopCycle(): void

interface CycleOptions {
  widgetIds?: string[];
  interval?: number;   // Seconds per widget
  loop?: boolean;
}
```

### presenter.timer

```typescript
timer.elapsed(): number
timer.setCountdown(seconds: number): void
timer.remaining(): number | null
timer.pause(): void
timer.resume(): void
```

### presenter.pointer

```typescript
pointer.enable(): void
pointer.disable(): void
pointer.move(x: number, y: number): void
```

### presenter.subscribe()

```typescript
subscribe(handler: (state: DashboardPresentationState) => void): () => void
```

---

## dashboard.versions

Version history. See [versions.md](versions.md) for details.

```typescript
versions.list(): Promise<Version[]>
versions.create(name: string, description?: string): Promise<Version>
versions.restore(versionId: string): Promise<void>
versions.diff(fromId: string, toId: string): Promise<VersionDiff>
versions.delete(versionId: string): Promise<boolean>
versions.subscribe(handler: (versions: Version[]) => void): () => void
```

---

## dashboard.publish

Publishing controls.

### publish.getUrl()

```typescript
getUrl(): string  // $ORIGIN_HOST/p/{slug}
```

### publish.setVisibility()

```typescript
setVisibility(visibility: 'public' | 'private'): void
```

### publish.unpublish() / republish()

```typescript
unpublish(): void   // Temporarily hide published version
republish(): void   // Restore published version
```

---

## dashboard.undo

Undo/redo management.

```typescript
undo.manager(): Y.UndoManager
undo.canUndo(): boolean
undo.canRedo(): boolean
undo.undo(): void
undo.redo(): void
```

---

## dashboard.presence

User presence for collaboration.

### presence.set()

```typescript
set(state: Partial<DashboardPresenceState>): void

interface DashboardPresenceState {
  user: { id: string; name: string; color: string };
  viewingWidgetId: string | null;
  editingWidgetId: string | null;
  selectedWidgetIds: string[];
  cursor: { x: number; y: number } | null;
  pointer: { x: number; y: number } | null;
  mode: 'edit' | 'view' | 'configure' | 'present';
}
```

### presence.get()

```typescript
get(): Map<string, DashboardPresenceState>
```

### presence.subscribe()

```typescript
subscribe(handler: (users: Map<string, DashboardPresenceState>) => void): () => void
```

---

## dashboard.transact()

Batch multiple changes into one undo step.

```typescript
transact(fn: () => void): void
```

**Example:**

```javascript
dashboard.transact(() => {
  const widget = dashboard.widgets.add('kpi', config, position);
  dashboard.widgets.setOwner(widget.id, currentUserId);
});
// Both changes = 1 undo step
```

---

## sdk.dashboards.helpers

Optional helpers for formatting and visualization.

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

## Widget Config Types

### KPI Config

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
  sparkline?: {
    field: string;
    type: 'line' | 'bar' | 'area';
  };
  icon?: string;
  size?: 'sm' | 'md' | 'lg';
}
```

### Chart Config

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

### Table Config

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

### Text Config

```typescript
interface TextConfig {
  content: string;
  contentType: 'markdown' | 'html';
  align?: 'left' | 'center' | 'right';
  padding?: number;
}
```

### HTML Config

```typescript
interface HTMLConfig {
  content: string;
  scripts?: boolean;
}
```

---

## Events

```typescript
dashboard.on(event: DashboardEvent, handler: Function): void
dashboard.off(event: DashboardEvent, handler: Function): void

type DashboardEvent =
  | 'widget:added'
  | 'widget:deleted'
  | 'widget:updated'
  | 'layout:changed'
  | 'filter:changed'
  | 'data:refreshed'
  | 'presentation:start'
  | 'presentation:end'
  | 'sync'
  | 'status';
```
