# ShareOut Dashboards

Collaborative real-time dashboards with live data, interactive filtering, and presenter mode. A complete dashboard solution built on ShareOut's infrastructure.

## Why ShareOut Dashboards?

| Feature | ShareOut Dashboards | Traditional Tools |
|---------|---------------------|-------------------|
| Real-time collaboration | Y.js CRDT - conflict-free | Lock-based or last-write-wins |
| Live data | Auto-refresh + WebSocket streams | Manual refresh |
| Cross-widget interactions | Click-to-filter, linked highlighting | Isolated widgets |
| Presenter mode | Focus, cycle, timer, pointer | Basic fullscreen |
| Filter presets | Saved views with quick access | Manual filter entry |
| Version history | Named versions + auto-save + diff | Manual saves |
| Permissions | Per-widget ownership | Document-level only |
| Publishing | Dual URLs (editor + shareable) | Export required |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ShareOut Dashboards                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐          ┌─────────────────┐          │
│  │   Editor Mode   │  sync    │ Published Mode  │          │
│  │ $ORIGIN_HOST/a │ ───────► │ $ORIGIN_HOST/p │          │
│  │  (auth required)│          │  (shareable)    │          │
│  └────────┬────────┘          └────────┬────────┘          │
│           │                            │                    │
│           ▼                            ▼                    │
│  ┌─────────────────────────────────────────────────┐       │
│  │              Y.js Realtime Document              │       │
│  │  • Widgets (grid-positioned, data-bound)         │       │
│  │  • Layout (responsive grid config)               │       │
│  │  • Data Sources (connection configs)             │       │
│  │  • Filters (global + per-widget)                 │       │
│  │  • Metadata (cascading properties)               │       │
│  └─────────────────────────────────────────────────┘       │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Presence │ │ Versions │ │  Blobs   │ │ Comments │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Grid-Based Widget Layout

Dashboards use a 12-column responsive grid. Widgets are positioned and sized using grid coordinates.

```javascript
// Add a KPI widget at position (0,0), width 3, height 2
dashboard.widgets.add('kpi', {
  value: 'total_revenue',
  label: 'Total Revenue',
  format: 'currency'
}, { x: 0, y: 0, w: 3, h: 2 });

// Add a chart next to it
dashboard.widgets.add('chart', {
  chartType: 'line',
  xAxis: { field: 'date', type: 'time' },
  yAxis: { field: 'revenue' }
}, { x: 3, y: 0, w: 6, h: 4 });
```

### Widget Types

| Type | Purpose | Example |
|------|---------|---------|
| `kpi` | Single metric with context | Revenue: $1.2M ▲15% |
| `chart` | Data visualization | Line, bar, pie, scatter, gauge |
| `table` | Detailed data view | Sortable, filterable rows |
| `text` | Labels and annotations | Section headers, notes |
| `filter` | Interactive filter control | Dropdowns, date pickers |
| `html` | Free-form content | Custom visualizations |

### Editor vs Published Mode

Every dashboard has two URLs:

| Mode | URL | Purpose |
|------|-----|---------|
| **Editor** | `$ORIGIN_HOST/a/{slug}` | Authenticated editing, collaboration |
| **Published** | `$ORIGIN_HOST/p/{slug}` | Shareable link, read-only, interactive |

Changes in editor sync to published in real-time.

### Data Sources

Connect widgets to various data sources:

```javascript
// Static data
dashboard.dataSources.add({
  name: 'Sales Data',
  type: 'static',
  config: { data: salesData }
});

// REST API
dashboard.dataSources.add({
  name: 'Live Metrics',
  type: 'api',
  config: {
    url: 'https://api.example.com/metrics',
    method: 'GET'
  },
  refreshInterval: 60  // seconds
});

// ShareOut table
dashboard.dataSources.add({
  name: 'Customer List',
  type: 'shareout',
  config: { tableId: 'customers' }
});
```

### Interactive Filtering

Global filters affect multiple widgets:

```javascript
// Add filter definition
dashboard.filters.addDefinition({
  type: 'select',
  label: 'Region',
  options: [
    { value: 'na', label: 'North America' },
    { value: 'eu', label: 'Europe' },
    { value: 'apac', label: 'Asia Pacific' }
  ],
  affects: '*'  // All widgets
});

// Set filter value
dashboard.filters.setValue('region', 'na');

// Observe filter changes
dashboard.filters.observe(state => {
  console.log('Filters changed:', state);
});
```

### Filter Presets (Saved Views)

Save and quickly apply filter combinations:

```javascript
// Save current filters as preset
dashboard.presets.create({
  name: 'Q4 2026',
  icon: '📊',
  filters: dashboard.filters.getState(),
  isPinned: true
});

// Apply a preset
dashboard.presets.apply('preset-q4-2026');

// Set default view (auto-applied on load)
dashboard.presets.setDefault('preset-this-week');
```

### Cross-Widget Interactions

Clicking one widget can filter others:

```javascript
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

## Quick Start

### Create a Dashboard

```javascript
const sdk = new ShareOut();

const result = await sdk.dashboards.create({
  title: 'Sales Dashboard',
  visibility: 'public'
});

console.log(result.editorUrl);    // $ORIGIN_HOST/a/sales-dashboard
console.log(result.publishedUrl); // $ORIGIN_HOST/p/sales-dashboard
```

### Open and Build

```javascript
const dashboard = await sdk.dashboards.open('sales-dashboard');
await dashboard.connect();

// Add KPIs
dashboard.widgets.add('kpi', {
  value: 'total_revenue',
  label: 'Revenue',
  format: 'currency',
  comparison: { value: 'prev_month', type: 'percent' }
}, { x: 0, y: 0, w: 3, h: 2 });

// Add chart
dashboard.widgets.add('chart', {
  chartType: 'line',
  xAxis: { field: 'date', type: 'time', label: 'Date' },
  yAxis: { field: 'revenue', label: 'Revenue ($)' }
}, { x: 0, y: 2, w: 6, h: 4 });

// Observe changes
dashboard.widgets.observe(widgets => {
  renderDashboard(widgets);
});
```

### Start Presenting

```javascript
// Start presenter mode
await dashboard.presenter.start({
  countdown: 1800  // 30-minute timer
});

// Focus on specific widget
dashboard.presenter.focusWidget('kpi-revenue');

// Auto-cycle through widgets (TV mode)
dashboard.presenter.startCycle({
  interval: 30,  // 30 seconds per widget
  loop: true
});
```

### Manage Versions

```javascript
// Create named version
await dashboard.versions.create('Before Meeting', 'Backup before changes');

// Restore previous version
const versions = await dashboard.versions.list();
await dashboard.versions.restore(versions[2].id);
```

## Use Cases

| Scenario | Key Features |
|----------|--------------|
| **Executive dashboards** | KPIs, trend charts, filter presets |
| **Sales analytics** | Pipeline funnel, leaderboard, drill-down |
| **Operations monitoring** | Live metrics, alerts, auto-refresh |
| **Marketing analytics** | Campaign performance, conversion funnel |
| **Financial reporting** | P&L, trends, period comparisons |
| **TV displays** | Presenter mode, auto-cycling, fullscreen |

## Reference Docs

| Topic | File |
|-------|------|
| SDK API | [sdk-api.md](sdk-api.md) |
| Data Model | [data-model.md](data-model.md) |
| Presenter Mode | [presenter-mode.md](presenter-mode.md) |
| Version History | [versions.md](versions.md) |
| Permissions | [permissions.md](permissions.md) |
| Publishing | [publishing.md](publishing.md) |
| Design Guidelines | [design/README.md](design/README.md) |

## Integration with ShareOut SDK

Dashboards integrate with existing SDK features:

| SDK Feature | Dashboards Integration |
|------------|------------------------|
| `sdk.realtime()` | Underlying Y.js document |
| `sdk.blobs` | Image storage for widgets |
| `sdk.comments` | Per-widget feedback (`contextId: 'widget-{id}'`) |
| `sdk.collaborators` | Dashboard permissions |
| `sdk.table()` | Data source for widgets |
