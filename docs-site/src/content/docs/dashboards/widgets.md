---
title: Widgets & charts
description: Widget types, chart types, and grid layout for ShareOut dashboards.
---

Dashboards are composed of widgets placed on a 12-column responsive grid. Each
widget has a type, a data source binding, and a grid position (`x`, `y`, `w`,
`h`).

## Widget types

| Type | Purpose |
| --- | --- |
| `kpi` | Single metric with optional comparison and sparkline |
| `chart` | Data visualization (line, bar, pie, scatter, gauge, and more) |
| `table` | Sortable, paginated data table |
| `text` | Markdown or HTML labels and annotations |
| `filter` | Interactive filter control (dropdown, date picker, etc.) |
| `html` | Free-form HTML; scripts disabled by default |
| `image` | Static image from blobs |
| `embed` | iframe embed |

## KPI widget

Shows a single metric with context. The most-used widget type.

```
┌──────────────────────────────┐
│  Label                       │
│  $1,234,567      ▲ 15.2%    │
│  ▁▂▃▄▅▆▇ sparkline          │
└──────────────────────────────┘
```

```javascript
dashboard.widgets.add('kpi', {
  value: 'total_revenue',
  label: 'Total Revenue',
  format: 'currency',
  formatOptions: { notation: 'compact' },
  comparison: {
    value: 'prev_month_revenue',
    type: 'percent',
    invertColors: false,        // set true when lower is better
  },
  sparkline: { field: 'daily_revenue', type: 'area' },
  size: 'lg',                   // 'sm' | 'md' | 'lg'
}, { x: 0, y: 0, w: 4, h: 3 });
```

**Format values:** `'number'` | `'currency'` | `'percent'` | `'custom'`

**Recommended sizes:**

| Size | Grid (`w×h`) | Shows |
| --- | --- | --- |
| Small | 3×2 | Value + label |
| Medium | 3×2 | Value + label + change |
| Large | 4×3 | Value + label + change + sparkline |

## Chart widget

Visualizes data trends and comparisons.

**Chart types:** `line` | `bar` | `area` | `pie` | `donut` | `scatter` |
`heatmap` | `gauge` | `funnel` | `treemap`

### Choosing a chart type

| Question | Chart |
| --- | --- |
| How does it change over time? | `line` (continuous), `bar` (discrete periods) |
| How do things compare? | `bar` (vertical ≤7 categories, horizontal for more or long labels) |
| What's the composition? | `pie` / `donut` (≤6 slices) |
| Is there a relationship? | `scatter` |
| What's progress toward a goal? | `gauge` |
| What's the conversion flow? | `funnel` |
| Two-dimensional patterns? | `heatmap` |

```javascript
// Line chart
dashboard.widgets.add('chart', {
  chartType: 'line',
  xAxis: { field: 'date', type: 'time', label: 'Date' },
  yAxis: { field: 'revenue', label: 'Revenue ($)', min: 0 },
  series: [
    { field: 'revenue', name: 'Actual', color: '#3b82f6' },
    { field: 'target',  name: 'Target', color: '#94a3b8' },
  ],
  legend: { show: true, position: 'top' },
  animation: true,
}, { x: 0, y: 2, w: 6, h: 4 });
```

**Recommended minimum sizes:**

| Chart type | Min grid (`w×h`) | Ideal |
| --- | --- | --- |
| Line / Area | 6×3 | 6×4 |
| Bar (vertical) | 4×3 | 6×4 |
| Bar (horizontal) | 6×4 | 8×5 |
| Pie / Donut | 4×4 | 4×4 |
| Scatter | 6×4 | 6×5 |
| Gauge | 3×3 | 4×3 |

## Table widget

Sortable, filterable, paginated data table.

```javascript
dashboard.widgets.add('table', {
  columns: [
    { field: 'name',    header: 'Customer', sortable: true },
    { field: 'revenue', header: 'Revenue',  format: 'currency', align: 'right', sortable: true },
    { field: 'status',  header: 'Status',   format: 'badge' },
  ],
  pageSize: 10,
  sortable: true,
  filterable: true,
  striped: true,
}, { x: 0, y: 6, w: 12, h: 5 });
```

Column `format` options: `text` | `number` | `currency` | `percent` | `date` |
`boolean` | `link` | `image` | `badge`

Tables should generally span the full 12 columns. Show 8–12 rows without
scroll (5–6 row units); paginate at 10–25 items.

## Text widget

Markdown or HTML static content — section headers, annotations, instructions.

```javascript
dashboard.widgets.add('text', {
  content: '## Sales Performance',
  contentType: 'markdown',   // 'markdown' | 'html'
  align: 'left',
}, { x: 0, y: 0, w: 12, h: 1 });
```

## Filter widget

Interactive filter controls are defined via `dashboard.filters.addDefinition()`
rather than `widgets.add()`. Filter types: `select` | `multiselect` |
`daterange` | `numberrange` | `search`.

```javascript
dashboard.filters.addDefinition({
  type: 'select',
  label: 'Region',
  options: [
    { value: 'na',   label: 'North America' },
    { value: 'eu',   label: 'Europe' },
    { value: 'apac', label: 'Asia Pacific' },
  ],
  affects: '*',    // '*' = all widgets; or array of widget IDs
});

dashboard.filters.addDefinition({
  type: 'daterange',
  label: 'Period',
  defaultValue: { from: '2026-01-01', to: '2026-12-31' },
  affects: ['chart-revenue', 'table-details'],
});
```

## HTML widget

Free-form HTML for custom visualizations or embedded content.

```javascript
dashboard.widgets.add('html', {
  content: '<div class="custom-viz" style="height:100%"><canvas id="globe"></canvas></div>',
  scripts: false,   // enable only for trusted content
}, { x: 0, y: 0, w: 6, h: 6 });
```

Scripts are sandboxed and disabled by default. Sandbox iframe embeds.

## Grid layout

Dashboards use a 12-column grid. Widget positions are zero-indexed column and
row coordinates.

```
┌─┬─┬─┬─┬─┬─┬─┬─┬─┬──┬──┬──┐
│0│1│2│3│4│5│6│7│8│ 9│10│11│
└─┴─┴─┴─┴─┴─┴─┴─┴─┴──┴──┴──┘
```

Default row height: 80 px per row unit.

**Standard sizes:**

| Widget | `w` | `h` |
| --- | --- | --- |
| KPI (small) | 3 | 2 |
| KPI (large) | 4 | 3 |
| Chart (half width) | 6 | 4 |
| Chart (full width) | 12 | 4–5 |
| Table | 12 | 5–6 |
| Filter bar | 12 | 1 |

### Example: executive layout

```javascript
// KPI row
dashboard.widgets.add('kpi', kpiConfig1, { x: 0, y: 0, w: 3, h: 2 });
dashboard.widgets.add('kpi', kpiConfig2, { x: 3, y: 0, w: 3, h: 2 });
dashboard.widgets.add('kpi', kpiConfig3, { x: 6, y: 0, w: 3, h: 2 });
dashboard.widgets.add('kpi', kpiConfig4, { x: 9, y: 0, w: 3, h: 2 });

// Charts row
dashboard.widgets.add('chart', trendConfig,     { x: 0, y: 2, w: 6, h: 4 });
dashboard.widgets.add('chart', breakdownConfig, { x: 6, y: 2, w: 6, h: 4 });

// Table row
dashboard.widgets.add('table', tableConfig, { x: 0, y: 6, w: 12, h: 5 });
```

### Responsive breakpoints

The `layout` field on `DashboardMeta` can be `'fixed'` or `'responsive'`. In
responsive mode the grid reflows at standard breakpoints:

| Viewport | Columns | Typical change |
| --- | --- | --- |
| Desktop ≥1280 px | 12 | Full layout |
| Tablet 768–1279 px | 8 | KPIs 2-per-row, charts stack |
| Mobile ≤767 px | 4 | KPIs 1-per-row, full-width charts |

### Layout anti-patterns

- More than 4–6 KPIs overwhelm at a glance; group related metrics.
- Keep KPIs above the fold — viewers should not scroll to see key numbers.
- Vary widget sizes to signal importance; uniform sizing reads as undifferentiated.
- Use consistent column splits (6+6, 8+4, 4+4+4); avoid awkward proportions.

## Repositioning widgets

After adding, move or resize widgets via the layout manager:

```javascript
dashboard.layout.move('kpi-revenue', 3, 0);       // move to (3, 0)
dashboard.layout.resize('chart-trend', 8, 4);      // resize to 8 cols × 4 rows
dashboard.layout.update('table-deals', { x: 0, y: 9, w: 12, h: 5 });
```
