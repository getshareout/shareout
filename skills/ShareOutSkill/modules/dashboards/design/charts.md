# Chart Design Guidelines

Best practices for data visualization in dashboards.

---

## Chart Type Selection

### Decision Tree

```
What question are you answering?
│
├─► "How does it change over time?"
│   └─► Line Chart (continuous) or Bar Chart (discrete periods)
│
├─► "How do things compare?"
│   └─► Bar Chart (horizontal for many items, vertical for few)
│
├─► "What's the composition/breakdown?"
│   └─► Pie/Donut (≤6 parts) or Stacked Bar (>6 or over time)
│
├─► "What's the distribution?"
│   └─► Histogram or Box Plot
│
├─► "Is there a relationship?"
│   └─► Scatter Plot or Bubble Chart
│
├─► "What's the progress toward a goal?"
│   └─► Gauge or Progress Bar
│
├─► "What's the flow/conversion?"
│   └─► Funnel or Sankey Diagram
│
└─► "Where is it located?"
    └─► Map (choropleth or point)
```

---

## Line Charts

**Best for**: Trends over time, continuous data

### Anatomy

```
     Revenue Over Time
  $  │
  2M │                    ╭──●
     │              ╭────╯
  1M │        ╭────╯
     │  ●────╯
   0 ├────┬────┬────┬────┬────
     Jan  Mar  May  Jul  Sep  Nov
```

### Guidelines

1. **Limit series**: Max 5-7 lines
2. **Use distinct colors**: Ensure lines are distinguishable
3. **Add markers**: For discrete data points
4. **Consider area fills**: For single series to show magnitude
5. **Truncate Y-axis carefully**: Can mislead if not noted

### Config Example

```typescript
{
  chartType: 'line',
  xAxis: { field: 'month', type: 'time', label: 'Month' },
  yAxis: { field: 'revenue', label: 'Revenue ($)', min: 0 },
  series: [
    { field: 'revenue', name: 'Actual', color: '#3b82f6' },
    { field: 'target', name: 'Target', color: '#94a3b8', dash: [5, 5] }
  ],
  legend: { show: true, position: 'top' },
  animation: true
}
```

### Variations

| Variation | Use When |
|-----------|----------|
| **Area Chart** | Emphasize magnitude, single series |
| **Stacked Area** | Show composition over time |
| **Step Line** | Discrete changes (pricing tiers) |

---

## Bar Charts

**Best for**: Comparing discrete categories

### Vertical vs Horizontal

```
Vertical (≤7 categories)     Horizontal (>7 or long labels)

│ ████                       Category A ████████████
│ ████  ████                 Category B ████████
│ ████  ████  ████           Category C ██████
├─────────────────           Category D ████
   A     B     C             Category E ██
```

### Guidelines

1. **Start at zero**: Always for bar charts
2. **Order meaningfully**: By value, alphabetically, or logically
3. **Limit categories**: Max 10-12 bars
4. **Highlight key bar**: Use accent color
5. **Add value labels**: When precision matters

### Config Example

```typescript
{
  chartType: 'bar',
  xAxis: { field: 'region', type: 'category', label: 'Region' },
  yAxis: { field: 'revenue', label: 'Revenue ($M)', min: 0 },
  series: [{ field: 'revenue', name: 'Revenue', color: '#3b82f6' }],
  tooltip: { show: true }
}
```

### Variations

| Variation | Use When |
|-----------|----------|
| **Grouped Bar** | Compare 2-3 series per category |
| **Stacked Bar** | Show composition within categories |
| **Waterfall** | Show cumulative effect (P&L) |

---

## Pie & Donut Charts

**Best for**: Part-to-whole relationships

### Guidelines

1. **Max 6 slices**: Group smaller items as "Other"
2. **Start at 12 o'clock**: Most common starting position
3. **Order by size**: Largest to smallest (clockwise)
4. **Use donut for KPI**: Center can show total
5. **Avoid 3D**: Distorts proportions

### When NOT to Use

- More than 6 categories
- Comparing values over time
- Values don't sum to a whole
- Precise comparison needed (use bar instead)

### Config Example

```typescript
{
  chartType: 'donut',
  nameField: 'category',
  valueField: 'revenue',
  legend: { show: true, position: 'right' },
  tooltip: { show: true }
}
```

---

## Scatter Plots

**Best for**: Showing correlation between two variables

### Anatomy

```
Sales vs Marketing Spend
     │
Sales│    ●
     │  ●   ●  ●
     │ ●  ●   ●
     │●  ●
     ├──────────────
        Marketing Spend
```

### Guidelines

1. **Label axes clearly**: Both X and Y need labels
2. **Add trendline**: If correlation exists
3. **Size for third variable**: Bubble chart
4. **Color for categories**: Different series
5. **Handle overplotting**: Reduce opacity for many points

### Config Example

```typescript
{
  chartType: 'scatter',
  xAxis: { field: 'marketing_spend', label: 'Marketing Spend ($K)' },
  yAxis: { field: 'sales', label: 'Sales ($K)' },
  series: [{ field: 'region', name: 'Region' }]
}
```

---

## Gauges

**Best for**: Single value against a target/range

### Anatomy

```
       ╭───────╮
     ╱   85%    ╲
    │   Target   │
    │    100%    │
     ╲          ╱
       ╰───────╯
```

### Guidelines

1. **Clear target line**: Show where success is
2. **Color zones**: Red/yellow/green ranges
3. **Show actual value**: Prominently in center
4. **Limit use**: 1-2 per dashboard

### Config Example

```typescript
{
  chartType: 'gauge',
  valueField: 'completion',
  max: 100,
  zones: [
    { min: 0, max: 50, color: '#ef4444' },
    { min: 50, max: 80, color: '#f59e0b' },
    { min: 80, max: 100, color: '#10b981' }
  ],
  target: 85
}
```

---

## Funnels

**Best for**: Conversion or sequential processes

### Anatomy

```
     Visitors (10,000)
    ████████████████████
      Leads (2,500)
     ██████████████
       MQLs (800)
        ████████
       SQLs (200)
         ████
       Wins (50)
          ██
```

### Guidelines

1. **Show conversion rates**: Between each stage
2. **Order by process**: Not by size
3. **Use consistent colors**: Or gradient
4. **Add absolute numbers**: Not just percentages

### Config Example

```typescript
{
  chartType: 'funnel',
  stages: [
    { name: 'Visitors', value: 10000 },
    { name: 'Leads', value: 2500 },
    { name: 'MQLs', value: 800 },
    { name: 'SQLs', value: 200 },
    { name: 'Wins', value: 50 }
  ],
  showConversionRate: true
}
```

---

## Heatmaps

**Best for**: Two-dimensional patterns, correlation matrices

### Anatomy

```
        Mon  Tue  Wed  Thu  Fri
 9 AM   ░░░  ▒▒▒  ▓▓▓  ▒▒▒  ░░░
10 AM   ▒▒▒  ▓▓▓  ███  ▓▓▓  ▒▒▒
11 AM   ▓▓▓  ███  ███  ███  ▓▓▓
12 PM   ▒▒▒  ▓▓▓  ▓▓▓  ▓▓▓  ▒▒▒
 1 PM   ░░░  ▒▒▒  ▒▒▒  ▒▒▒  ░░░
```

### Guidelines

1. **Use sequential colors**: Light to dark for intensity
2. **Add color legend**: Show what values mean
3. **Sort meaningfully**: Group related items
4. **Consider diverging palette**: For positive/negative

### Config Example

```typescript
{
  chartType: 'heatmap',
  xAxis: { field: 'day_of_week', type: 'category' },
  yAxis: { field: 'hour', type: 'category' },
  valueField: 'activity_count',
  colorScale: 'sequential.blue'
}
```

---

## Common Mistakes

### ❌ Chart Junk
- 3D effects that distort data
- Unnecessary gridlines
- Decorative elements
- Dual Y-axes (usually)

### ❌ Misleading Axes
- Not starting at zero (bar charts)
- Inconsistent intervals
- Missing labels

### ❌ Too Much Data
- 20+ series on one chart
- Every data point labeled
- No aggregation

### ❌ Wrong Chart Type
- Pie chart for 15 categories
- Line chart for categorical data
- Stacked bar with negative values

---

## Accessibility

### Color Blindness

```typescript
// Use colorblind-safe palette
const colorBlindSafe = [
  '#0077bb',  // Blue
  '#33bbee',  // Cyan
  '#009988',  // Teal
  '#ee7733',  // Orange
  '#cc3311',  // Red-Orange
];
```

### Additional Indicators

- Add patterns/textures to fills
- Use line styles (solid, dashed, dotted)
- Include data labels
- Provide alt text descriptions

### Minimum Text Size

- Axis labels: 10px minimum
- Legends: 12px minimum
- Titles: 14px minimum

---

## Animation Guidelines

### When to Animate

- Initial load
- Data updates
- User interaction (hover, click)

### When NOT to Animate

- Real-time data (>1 update/sec)
- Print/export mode
- User has motion preferences

### Animation Duration

| Animation Type | Duration |
|----------------|----------|
| Initial load | 500-800ms |
| Data update | 300-500ms |
| Hover tooltip | 100-200ms |
| Transition | 200-400ms |

```typescript
{
  animation: {
    enabled: true,
    duration: 500,
    easing: 'easeOutQuart'
  }
}
```
