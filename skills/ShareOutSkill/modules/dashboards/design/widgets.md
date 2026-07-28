# Widget Design Guidelines

Best practices for designing individual dashboard widgets.

---

## KPI Widget

The most important widget type. Shows a single metric with context.

### Anatomy

```
┌──────────────────────────────┐
│  Label                       │  ← What this measures
│  $1,234,567      ▲ 15.2%    │  ← Value + Change
│  ▁▂▃▄▅▆▇ trend              │  ← Optional sparkline
│  vs $1.1M last month        │  ← Context/comparison
└──────────────────────────────┘
```

### Sizing Guidelines

| Size | Dimensions | Content |
|------|------------|---------|
| Small | 3×2 | Value + label only |
| Medium | 3×2 | Value + label + change |
| Large | 4×3 | Value + label + change + sparkline |

### Value Formatting

```typescript
// Use abbreviated numbers for large values
$1,234,567 → $1.2M
12,345 → 12.3K
0.156 → 15.6%

// Show precision based on magnitude
$1.2M (millions: 1 decimal)
$123K (thousands: 0 decimals)
$1,234 (under 10K: full number)
```

### Change Indicators

```html
<!-- Positive change -->
<span class="change positive">▲ 15.2%</span>

<!-- Negative change -->
<span class="change negative">▼ 8.3%</span>

<!-- No change -->
<span class="change neutral">― 0.0%</span>

<!-- Inverted (lower is better) -->
<span class="change positive">▼ 12%</span>  <!-- e.g., costs down -->
```

### KPI Config Example

```typescript
dashboard.widgets.add('kpi', {
  value: 'total_revenue',
  label: 'Total Revenue',
  format: 'currency',
  formatOptions: { notation: 'compact' },
  comparison: {
    value: 'prev_month_revenue',
    type: 'percent',
    invertColors: false
  },
  sparkline: {
    field: 'daily_revenue',
    type: 'area'
  },
  size: 'lg'
}, { x: 0, y: 0, w: 4, h: 3 });
```

---

## Chart Widget

Visualizes data trends and comparisons.

### Chart Type Selection

| Data Question | Chart Type | When to Use |
|---------------|------------|-------------|
| "How does it change over time?" | Line | Continuous time series |
| "How do parts compare?" | Bar | Discrete comparisons |
| "What's the composition?" | Pie/Donut | Parts of a whole (≤6 slices) |
| "What's the distribution?" | Histogram | Frequency distribution |
| "Is there correlation?" | Scatter | Two-variable relationship |
| "What's the progress?" | Gauge | Single value vs target |
| "What's the flow?" | Funnel | Sequential stages |

### Chart Anatomy

```
┌──────────────────────────────────────────┐
│  Chart Title                     Legend  │
├──────────────────────────────────────────┤
│     │                              ● A   │
│  Y  │    ╭───╮                     ○ B   │
│     │   ╱     ╲    ╭──                   │
│  A  │  ╱       ╲──╯                      │
│  x  │ ╱                                  │
│  i  │╱                                   │
│  s  ├────────────────────────────────────│
│     │        X Axis Label                │
└──────────────────────────────────────────┘
```

### Sizing by Chart Type

| Chart Type | Min Width | Min Height | Ideal |
|------------|-----------|------------|-------|
| Line/Area | 6 cols | 3 rows | 6×4 |
| Bar (Vertical) | 4 cols | 3 rows | 6×4 |
| Bar (Horizontal) | 6 cols | 4 rows | 8×5 |
| Pie/Donut | 4 cols | 4 rows | 4×4 |
| Scatter | 6 cols | 4 rows | 6×5 |
| Gauge | 3 cols | 3 rows | 4×3 |

### Best Practices

1. **One insight per chart** - Don't overload
2. **Label axes** - Always label what you're showing
3. **Start Y-axis at zero** - For bar charts (lines can be truncated)
4. **Limit series** - Max 5-7 lines/bars
5. **Use legends sparingly** - Direct labels are better

### Chart Config Example

```typescript
dashboard.widgets.add('chart', {
  chartType: 'line',
  xAxis: {
    field: 'date',
    type: 'time',
    label: 'Date'
  },
  yAxis: {
    field: 'revenue',
    label: 'Revenue ($)',
    min: 0
  },
  series: [
    { field: 'revenue', name: 'Revenue', color: '#3b82f6' },
    { field: 'target', name: 'Target', color: '#ef4444' }
  ],
  legend: { show: true, position: 'top' },
  tooltip: { show: true }
}, { x: 0, y: 2, w: 6, h: 4 });
```

---

## Table Widget

Shows detailed data with sorting and filtering.

### Anatomy

```
┌────────────────────────────────────────────────────────┐
│  Table Title                           [Filter] [↓]   │
├──────────┬────────────┬─────────┬──────────┬──────────┤
│  Name ▼  │  Revenue   │  Units  │  Status  │  Action  │
├──────────┼────────────┼─────────┼──────────┼──────────┤
│  Acme    │  $1.2M     │  1,234  │ 🟢 Active│  [View]  │
│  Beta    │  $890K     │    987  │ 🟡 Review│  [View]  │
│  Corp    │  $650K     │    543  │ 🔴 At Risk│  [View]  │
├──────────┴────────────┴─────────┴──────────┴──────────┤
│  Showing 1-10 of 156                    [<] 1 2 3 [>] │
└────────────────────────────────────────────────────────┘
```

### Column Types

| Type | Format | Alignment | Example |
|------|--------|-----------|---------|
| Text | As-is | Left | "Acme Corp" |
| Number | Formatted | Right | "1,234" |
| Currency | $X.XK/M | Right | "$1.2M" |
| Percent | XX.X% | Right | "15.2%" |
| Date | MMM DD | Left | "Jan 15" |
| Status | Badge | Center | 🟢 Active |
| Link | Clickable | Left | [View] |

### Sizing Guidelines

- **Width**: Always full width (12 cols)
- **Height**: Show 8-12 rows without scroll (5-6 row units)
- **Pagination**: 10-25 items per page

### Table Config Example

```typescript
dashboard.widgets.add('table', {
  columns: [
    { field: 'name', header: 'Customer', sortable: true },
    { field: 'revenue', header: 'Revenue', format: 'currency', align: 'right', sortable: true },
    { field: 'units', header: 'Units', format: 'number', align: 'right' },
    { field: 'status', header: 'Status', format: 'badge' },
    { field: 'actions', header: '', render: '<button>View</button>' }
  ],
  pageSize: 10,
  sortable: true,
  filterable: true,
  striped: true
}, { x: 0, y: 6, w: 12, h: 5 });
```

---

## Text Widget

Static text, labels, or documentation.

### Use Cases

- **Section headers**: "Sales Performance"
- **Annotations**: "Data as of Jan 15, 2026"
- **Instructions**: "Click a bar to filter the table"
- **Definitions**: "MQL = Marketing Qualified Lead"

### Sizing

| Content | Size | Notes |
|---------|------|-------|
| Header | 12×1 | Full width, minimal height |
| Annotation | 3×1 | Small note |
| Instructions | 6×2 | Paragraph with padding |

### Text Config Example

```typescript
// Section header
dashboard.widgets.add('text', {
  content: '## Sales Performance',
  contentType: 'markdown',
  align: 'left'
}, { x: 0, y: 0, w: 12, h: 1 });

// Annotation
dashboard.widgets.add('text', {
  content: '*Data refreshed hourly. Last update: 2:45 PM*',
  contentType: 'markdown',
  align: 'right'
}, { x: 8, y: 0, w: 4, h: 1 });
```

---

## Filter Widget

Interactive controls for filtering data.

### Filter Types

| Type | Widget | Use For |
|------|--------|---------|
| Single Select | Dropdown | Exclusive options |
| Multi Select | Checkboxes | Multiple selections |
| Date Range | Date picker | Time period |
| Number Range | Slider | Numeric bounds |
| Search | Text input | Free-text filter |

### Filter Bar Layout

```
┌────────────────────────────────────────────────────────┐
│ [Region ▼] [Product ▼] [Date: Jan 1 - Dec 31] [Reset] │
└────────────────────────────────────────────────────────┘
```

### Filter Config Example

```typescript
// Add filter definitions
dashboard.filters.addDefinition({
  type: 'select',
  label: 'Region',
  field: 'region',
  options: [
    { value: 'na', label: 'North America' },
    { value: 'eu', label: 'Europe' },
    { value: 'apac', label: 'Asia Pacific' }
  ],
  affects: '*'  // Affects all widgets
});

dashboard.filters.addDefinition({
  type: 'daterange',
  label: 'Period',
  defaultValue: { from: '2026-01-01', to: '2026-12-31' },
  affects: ['chart-revenue', 'table-details']
});
```

---

## HTML Widget

Custom free-form content (like slides).

### Use Cases

- Custom visualizations (D3, Three.js)
- Embedded content (videos, maps)
- Complex interactive elements
- Brand-specific designs

### Security Considerations

- Scripts disabled by default
- Enable only for trusted content
- Sandbox iframe embeds

### HTML Config Example

```typescript
dashboard.widgets.add('html', {
  content: `
    <div class="custom-viz" style="height: 100%;">
      <canvas id="globe"></canvas>
      <script>
        initGlobe(document.getElementById('globe'));
      </script>
    </div>
  `,
  scripts: true  // Enable if trusted
}, { x: 0, y: 0, w: 6, h: 6 });
```

---

## Widget States

All widgets should handle these states:

### Loading
```
┌──────────────────────────────┐
│  ▓▓▓▓▓▓▓░░░░░  Loading...   │
└──────────────────────────────┘
```

### Empty
```
┌──────────────────────────────┐
│  📊 No data available        │
│  Try adjusting your filters  │
└──────────────────────────────┘
```

### Error
```
┌──────────────────────────────┐
│  ⚠️ Failed to load data      │
│  [Retry]                     │
└──────────────────────────────┘
```

### Stale
```
┌──────────────────────────────┐
│  Revenue: $1.2M              │
│  ⚠️ Last updated 2 hours ago │
└──────────────────────────────┘
```
