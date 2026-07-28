---
title: API del SDK de Dashboards
description: Referencia completa de métodos para sdk.dashboards — create, open, widgets, filters, layout, presenter y más.
---

Accedé al namespace de dashboards via `sdk.dashboards`. Una sesión de dashboard
(instancia de `Dashboard`) se abre con `sdk.dashboards.open()` o
`sdk.dashboards.view()` y comunica sobre un documento CRDT Y.js en vivo.

El campo `visibility` acepta `private`, `workspace` y `public`. (`unlisted` es un
alias legacy retirado, aún aceptado en la API y tratado como `public`.)

## Nivel superior: `sdk.dashboards`

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

Abre un dashboard para editar. Requiere autenticación. Devuelve una instancia
de `Dashboard` ya conectada.

```typescript
open(id: string): Promise<Dashboard>
```

### `sdk.dashboards.view()`

Abre un dashboard en modo publicado/vista. No requiere autenticación para
dashboards `public`.

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

Devuelve `false` si no existe; lanza excepción en otros errores.

---

## Instancia de Dashboard

Devuelta por `open()` y `view()`. La conexión se establece automáticamente;
no necesitás llamar a `connect()` manualmente.

```typescript
connect(): Promise<void>    // reconectar después de un disconnect
disconnect(): void          // desconectar pero mantener el documento
destroy(): void             // limpieza completa
```

---

## `dashboard.meta`

Configuración a nivel del dashboard. Las propiedades establecidas acá se
propagan en cascada a todos los widgets, a menos que un widget especifique
un override.

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

  // Defaults visuales en cascada (heredados por widgets)
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

  // Defaults de datos
  refreshInterval: number | null;   // auto-refresh en segundos
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
  title: 'Dashboard Q4 Ventas',
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

Devuelve una función para cancelar la suscripción.

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
  transform?: string;   // expresión JavaScript de transformación
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
  x: number;     // columna de inicio (índice cero)
  y: number;     // fila de inicio
  w: number;     // ancho en columnas
  h: number;     // alto en filas
  minW?: number;
  maxW?: number;
  minH?: number;
  maxH?: number;
}
```

Formas de config por tipo — ver [KPI config](#kpi-config), [Chart config](#chart-config), [Table config](#table-config) más abajo.

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

Para widgets `html` y `text`. `getContent()` devuelve un `Y.Text` para binding
colaborativo; `setContent()` reemplaza el contenido directamente.

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

Los widgets bloqueados solo pueden editarlos su `owner`.

---

## `dashboard.layout`

Gestión de posiciones en la grilla.

```typescript
get(): LayoutItem[]
update(widgetId: string, position: Partial<LayoutItem>): void
move(widgetId: string, x: number, y: number): void
resize(widgetId: string, w: number, h: number): void
observe(handler: (layout: LayoutItem[]) => void): () => void
```

---

## `dashboard.dataSources`

```typescript
type DataSourceType = 'static' | 'api' | 'sql' | 'shareout' | 'csv' | 'websocket';

interface DataSource {
  id: string;
  name: string;
  type: DataSourceType;
  config: DataSourceConfig;
  refreshInterval?: number;
  lastRefreshed?: string;
}
```

### Métodos

```typescript
list(): DataSource[]
add(config: Omit<DataSource, 'id'>): DataSource
update(id: string, changes: Partial<DataSource>): void
delete(id: string): boolean
refresh(id: string): Promise<void>
refreshAll(): Promise<void>
getData(id: string): any[]
getFilteredData(id: string): any[]
observe(id: string, handler: (data: any[]) => void): () => void
```

```javascript
// Datos estáticos
dashboard.dataSources.add({
  name: 'Datos de Ventas',
  type: 'static',
  config: { data: salesArray },
});

// REST API con auto-refresh
dashboard.dataSources.add({
  name: 'Métricas en Vivo',
  type: 'api',
  config: {
    url: 'https://api.example.com/metrics',
    method: 'GET',
    headers: { Authorization: 'Bearer ...' },
  },
  refreshInterval: 60,
});

// Tabla de ShareOut
dashboard.dataSources.add({
  name: 'Clientes',
  type: 'shareout',
  config: { tableId: 'customers' },
});
```

---

## `dashboard.filters`

### Definiciones de filtros

```typescript
interface FilterDefinition {
  id: string;
  type: 'select' | 'multiselect' | 'daterange' | 'numberrange' | 'search';
  label: string;
  dataSource?: string;
  field?: string;
  options?: { value: string; label: string }[];
  defaultValue?: FilterValue;
  affects: string[];    // IDs de widgets o '*' para todos
}

type FilterValue =
  | string
  | string[]
  | { from: string; to: string }
  | { min: number; max: number };
```

### Métodos

```typescript
getDefinitions(): FilterDefinition[]
addDefinition(def: Omit<FilterDefinition, 'id'>): FilterDefinition
updateDefinition(id: string, changes: Partial<FilterDefinition>): void
deleteDefinition(id: string): boolean
getState(): FilterState       // { [filterId]: FilterValue }
setValue(filterId: string, value: FilterValue): void
reset(): void                 // resetear todos a sus defaults
observe(handler: (state: FilterState) => void): () => void
```

---

## `dashboard.presets`

Combinaciones de filtros guardadas para acceso rápido.

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

Interacciones entre widgets: hacer click en uno filtra a otros.

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
    target: string | string[];    // IDs de widgets o '*'
    config: any;
  };
}
```

```typescript
define(config: InteractionConfig): string       // devuelve el ID de la interacción
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

El modo presentador sincroniza foco, puntero y ciclo automático a todos los
viewers en tiempo real.

```typescript
start(options?: PresenterOptions): Promise<void>
stop(): void
state(): DashboardPresentationState
isActive(): boolean
isPresenter(): boolean

// Foco de widgets
focusWidget(widgetId: string): void
clearFocus(): void
nextWidget(): void
previousWidget(): void

// Ciclo automático
startCycle(options?: CycleOptions): void
stopCycle(): void

// Timer
timer.elapsed(): number
timer.setCountdown(seconds: number): void
timer.remaining(): number | null
timer.pause(): void
timer.resume(): void

// Puntero
pointer.enable(): void
pointer.disable(): void
pointer.move(x: number, y: number): void

subscribe(handler: (state: DashboardPresentationState) => void): () => void
```

```javascript
await dashboard.presenter.start({ countdown: 1800 });   // timer de 30 min
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
await dashboard.versions.create('Antes de la reunión', 'Snapshot antes de ediciones en vivo');
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

Presencia efímera de usuarios sobre WebSocket (no persiste en el documento Y.js).

```typescript
set(state: Partial<DashboardPresenceState>): void
get(): Map<string, DashboardPresenceState>
subscribe(handler: (users: Map<string, DashboardPresenceState>) => void): () => void
```

---

## `dashboard.undo`

Stack de undo por usuario, limitado a los cambios propios.

```typescript
undo.manager(): Y.UndoManager
undo.canUndo(): boolean
undo.canRedo(): boolean
undo.undo(): void
undo.redo(): void
```

---

## `dashboard.transact()`

Agrupa múltiples cambios en un único paso de undo.

```typescript
transact(fn: () => void): void
```

```javascript
dashboard.transact(() => {
  const widget = dashboard.widgets.add('kpi', config, position);
  dashboard.widgets.setOwner(widget.id, currentUserId);
});
// Ambos cambios aparecen como un único paso de undo
```

---

## Eventos

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

Utilidades de formateo y datos.

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

## Tipos de config de widgets

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

## Modelo de datos

El documento Y.js que respalda cada dashboard tiene los siguientes maps de nivel
superior:

| Map | Tipo | Contenido |
| --- | --- | --- |
| `meta` | `Y.Map` | Metadata del dashboard y propiedades visuales en cascada |
| `widgets` | `Y.Map<string, Widget>` | Definiciones de widgets indexadas por widget ID |
| `widgetContent` | `Y.Map<string, Y.Text>` | Contenido HTML/text colaborativo para widgets html y text |
| `layout` | `Y.Map<string, LayoutItem>` | Posiciones en la grilla indexadas por widget ID |
| `dataSources` | `Y.Map<string, DataSource>` | Configuraciones de conexiones de datos |
| `filters` | `Y.Map<string, FilterValue>` | Estado actual de los filtros |
| `filterDefs` | `Y.Array<FilterDefinition>` | Definiciones de filtros |
| `filterPresets` | `Y.Map<string, FilterPreset>` | Combinaciones de filtros guardadas |
| `interactions` | `Y.Map<string, InteractionConfig>` | Configuraciones de interacciones entre widgets |
| `presentationState` | `Y.Map` | Estado del presentador en vivo (sincronizado a todos los viewers) |

El estado de presencia es efímero — no está en el documento Y.js; viaja solo
por el WebSocket.

Los snapshots de versiones se almacenan por separado como state vectors Y.js
codificados en la tabla `dashboard_versions`, no embebidos en el documento en
vivo.
