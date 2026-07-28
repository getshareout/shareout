# Dashboard Layouts

Grid-based layout patterns for common dashboard types.

---

## Grid System

Dashboards use a 12-column responsive grid:

```
┌─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┬─┐
│1│2│3│4│5│6│7│8│9│10│11│12│
└─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┴─┘
```

### Standard Widget Sizes

| Widget | Width (cols) | Height (rows) | Notes |
|--------|-------------|---------------|-------|
| KPI Small | 3 | 2 | Single metric |
| KPI Large | 4 | 3 | Metric + sparkline |
| Chart Half | 6 | 4 | Side-by-side charts |
| Chart Full | 12 | 4-5 | Primary visualization |
| Table | 12 | 5-6 | Full-width data |
| Filter Bar | 12 | 1 | Full-width controls |

### Row Heights

Default: `80px` per row unit

- 2 rows = 160px (KPI height)
- 4 rows = 320px (Chart height)
- 5 rows = 400px (Table height)

---

## Executive Dashboard

**Purpose**: High-level overview for leadership

```
┌────────────────────────────────────────────────────────┐
│  📊 Executive Dashboard                    [Filters ▼] │
├──────────┬──────────┬──────────┬──────────────────────┤
│  Revenue │  Growth  │Customers │     Performance      │
│   $4.2M  │   +15%   │   12.4K  │    ████████░░ 82%   │
│  ▲ 12%   │  vs 10%  │   ▲ 8%   │    Target: $5M      │
├──────────┴──────────┼──────────┴──────────────────────┤
│                     │                                  │
│    Revenue Trend    │      Revenue by Region          │
│    (Line Chart)     │        (Bar Chart)              │
│                     │                                  │
├─────────────────────┴──────────────────────────────────┤
│                                                        │
│              Top Products / Customers                  │
│                    (Table)                             │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Layout Code

```typescript
const executiveLayout: LayoutItem[] = [
  // KPI Row - 4 KPIs across
  { widgetId: 'kpi-revenue', x: 0, y: 0, w: 3, h: 2 },
  { widgetId: 'kpi-growth', x: 3, y: 0, w: 3, h: 2 },
  { widgetId: 'kpi-customers', x: 6, y: 0, w: 3, h: 2 },
  { widgetId: 'kpi-performance', x: 9, y: 0, w: 3, h: 2 },

  // Charts Row - 2 charts side by side
  { widgetId: 'chart-trend', x: 0, y: 2, w: 6, h: 4 },
  { widgetId: 'chart-breakdown', x: 6, y: 2, w: 6, h: 4 },

  // Table Row - full width
  { widgetId: 'table-details', x: 0, y: 6, w: 12, h: 5 },
];
```

---

## Sales Dashboard

**Purpose**: Pipeline and performance tracking

```
┌────────────────────────────────────────────────────────┐
│  💰 Sales Dashboard             [Q4 2026 ▼] [Team ▼]  │
├──────────┬──────────┬──────────┬──────────────────────┤
│ Pipeline │  Closed  │   Win    │      Quota           │
│  $8.5M   │  $2.1M   │   32%    │   ████████░░░ 70%   │
├──────────┴──────────┴──────────┴──────────────────────┤
│                                                        │
│              Pipeline by Stage (Funnel)                │
│                                                        │
├───────────────────────────┬────────────────────────────┤
│                           │                            │
│   Deals by Rep            │    Monthly Trend           │
│   (Horizontal Bar)        │    (Area Chart)            │
│                           │                            │
├───────────────────────────┴────────────────────────────┤
│                                                        │
│              Active Deals (Table)                      │
│  Deal | Company | Value | Stage | Close Date | Owner   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

### Layout Code

```typescript
const salesLayout: LayoutItem[] = [
  // KPI Row
  { widgetId: 'kpi-pipeline', x: 0, y: 0, w: 3, h: 2 },
  { widgetId: 'kpi-closed', x: 3, y: 0, w: 3, h: 2 },
  { widgetId: 'kpi-winrate', x: 6, y: 0, w: 3, h: 2 },
  { widgetId: 'kpi-quota', x: 9, y: 0, w: 3, h: 2 },

  // Funnel - full width
  { widgetId: 'chart-funnel', x: 0, y: 2, w: 12, h: 3 },

  // Two charts side by side
  { widgetId: 'chart-by-rep', x: 0, y: 5, w: 6, h: 4 },
  { widgetId: 'chart-trend', x: 6, y: 5, w: 6, h: 4 },

  // Deals table
  { widgetId: 'table-deals', x: 0, y: 9, w: 12, h: 5 },
];
```

---

## Operations Monitor

**Purpose**: Real-time system health

```
┌────────────────────────────────────────────────────────┐
│  🔧 Operations Monitor                      🟢 Live    │
├──────────┬──────────┬──────────┬──────────────────────┤
│ Uptime   │Requests/s│ Errors   │    Latency           │
│  99.9%   │  12.4K   │    3     │      45ms            │
│ 🟢 OK    │ 🟢 Normal│ 🟡 Watch │   🟢 Good            │
├──────────┴──────────┴──────────┴──────────────────────┤
│                                                        │
│           Request Volume (Live Area Chart)             │
│           ▃▄▅▆▇█▇▆▅▄▃▄▅▆▇█▇▆▅▄▃▄▅▆▇█▇▆▅▄            │
├─────────────────────┬──────────────────────────────────┤
│                     │                                  │
│   Error Breakdown   │      Service Status              │
│   (Donut)           │      (Status Grid)               │
│                     │  🟢API 🟢DB 🟢Cache 🟡Queue     │
├─────────────────────┴──────────────────────────────────┤
│  Recent Events                                         │
│  🔴 14:23 - Payment service timeout                   │
│  🟡 14:21 - Queue depth exceeded threshold            │
│  🟢 14:15 - Deployment completed                      │
└────────────────────────────────────────────────────────┘
```

### Layout Code

```typescript
const opsLayout: LayoutItem[] = [
  // Status KPIs with indicators
  { widgetId: 'kpi-uptime', x: 0, y: 0, w: 3, h: 2 },
  { widgetId: 'kpi-requests', x: 3, y: 0, w: 3, h: 2 },
  { widgetId: 'kpi-errors', x: 6, y: 0, w: 3, h: 2 },
  { widgetId: 'kpi-latency', x: 9, y: 0, w: 3, h: 2 },

  // Live chart
  { widgetId: 'chart-requests', x: 0, y: 2, w: 12, h: 3 },

  // Error breakdown + Status grid
  { widgetId: 'chart-errors', x: 0, y: 5, w: 5, h: 4 },
  { widgetId: 'status-grid', x: 5, y: 5, w: 7, h: 4 },

  // Event feed
  { widgetId: 'event-feed', x: 0, y: 9, w: 12, h: 4 },
];
```

---

## Marketing Analytics

**Purpose**: Campaign performance and funnel analysis

```
┌────────────────────────────────────────────────────────┐
│  📈 Marketing Analytics        [Channel ▼] [Date ▼]   │
├──────────┬──────────┬──────────┬──────────────────────┤
│ Visitors │  Leads   │   MQLs   │      CAC             │
│  45.2K   │  2,340   │   892    │      $127            │
│  ▲ 23%   │  ▲ 15%   │  ▲ 18%   │     ▼ 12%           │
├──────────┴──────────┴──────────┴──────────────────────┤
│                                                        │
│         Conversion Funnel (Horizontal Funnel)          │
│  Visitors ▶ Leads ▶ MQLs ▶ SQLs ▶ Opportunities       │
│                                                        │
├───────────────────────────┬────────────────────────────┤
│                           │                            │
│   Traffic by Channel      │    Campaign Performance    │
│   (Stacked Bar)           │    (Table)                 │
│                           │                            │
├───────────────────────────┴────────────────────────────┤
│                                                        │
│              Conversion Rate Over Time (Line)          │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## Financial Report

**Purpose**: P&L and financial metrics

```
┌────────────────────────────────────────────────────────┐
│  💵 Financial Report              [FY2026 ▼] [Q4 ▼]   │
├──────────┬──────────┬──────────┬──────────────────────┤
│ Revenue  │  Costs   │  Profit  │     Margin           │
│  $12.4M  │  $8.2M   │  $4.2M   │      34%             │
│ vs $11M  │ vs $7.8M │ vs $3.2M │    vs 29%            │
├──────────┴──────────┴──────────┼──────────────────────┤
│                                │                       │
│   Revenue vs Costs (Bar)       │    Profit Trend       │
│                                │    (Line + Target)    │
│                                │                       │
├────────────────────────────────┴──────────────────────┤
│                                                        │
│            P&L Breakdown (Waterfall Chart)             │
│                                                        │
├────────────────────────────────────────────────────────┤
│                                                        │
│         Expense Categories (Table)                     │
│  Category | Budget | Actual | Variance | % of Total   │
│                                                        │
└────────────────────────────────────────────────────────┘
```

---

## Responsive Breakpoints

### Desktop (≥1280px) - 12 columns
Full layout as designed

### Tablet (768-1279px) - 8 columns
- KPIs: 2 per row instead of 4
- Charts: Stack vertically
- Tables: Full width

### Mobile (≤767px) - 4 columns
- KPIs: 1 per row
- Charts: Full width, reduced height
- Tables: Card view or horizontal scroll

### Responsive Layout Example

```typescript
const responsiveLayout = {
  desktop: [
    { widgetId: 'kpi-1', x: 0, y: 0, w: 3, h: 2 },
    { widgetId: 'kpi-2', x: 3, y: 0, w: 3, h: 2 },
    { widgetId: 'kpi-3', x: 6, y: 0, w: 3, h: 2 },
    { widgetId: 'kpi-4', x: 9, y: 0, w: 3, h: 2 },
  ],
  tablet: [
    { widgetId: 'kpi-1', x: 0, y: 0, w: 4, h: 2 },
    { widgetId: 'kpi-2', x: 4, y: 0, w: 4, h: 2 },
    { widgetId: 'kpi-3', x: 0, y: 2, w: 4, h: 2 },
    { widgetId: 'kpi-4', x: 4, y: 2, w: 4, h: 2 },
  ],
  mobile: [
    { widgetId: 'kpi-1', x: 0, y: 0, w: 4, h: 2 },
    { widgetId: 'kpi-2', x: 0, y: 2, w: 4, h: 2 },
    { widgetId: 'kpi-3', x: 0, y: 4, w: 4, h: 2 },
    { widgetId: 'kpi-4', x: 0, y: 6, w: 4, h: 2 },
  ],
};
```

---

## Layout Anti-Patterns

### ❌ Too Many KPIs
```
┌──┬──┬──┬──┬──┬──┬──┬──┐
│K1│K2│K3│K4│K5│K6│K7│K8│  ← Overwhelming
└──┴──┴──┴──┴──┴──┴──┴──┘
```
**Fix**: Max 4-6 KPIs, group related metrics

### ❌ Unbalanced Columns
```
┌─────────────────┬───┐
│                 │   │  ← Awkward proportions
│    Too Wide     │Sm │
│                 │   │
└─────────────────┴───┘
```
**Fix**: Use consistent column widths (6+6, 8+4, 4+4+4)

### ❌ No Hierarchy
```
┌────┬────┬────┐
│ A  │ B  │ C  │  ← Everything same size
├────┼────┼────┤      = nothing important
│ D  │ E  │ F  │
└────┴────┴────┘
```
**Fix**: Vary sizes to show importance

### ❌ Scroll Required for Key Info
```
┌────────────────────┐
│   Charts only      │  ← Have to scroll
│   visible          │     to see KPIs
└────────────────────┘
  ↓ scroll ↓
┌────────────────────┐
│   KPIs hidden      │
└────────────────────┘
```
**Fix**: KPIs always above the fold
