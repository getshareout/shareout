# Dashboard Color Palettes

Color guidelines for data visualization and dashboard theming.

---

## Core Principles

1. **Accessibility first** - 4.5:1 contrast ratio minimum
2. **Semantic meaning** - Colors should communicate
3. **Consistency** - Same data type = same color
4. **Restraint** - Max 6-8 colors per dashboard

---

## Theme Palettes

### Light Theme (Default)

```typescript
const lightTheme = {
  background: '#f8fafc',      // Slate 50
  surface: '#ffffff',          // White
  surfaceAlt: '#f1f5f9',       // Slate 100
  border: '#e2e8f0',           // Slate 200

  text: '#1e293b',             // Slate 800
  textSecondary: '#64748b',    // Slate 500
  textMuted: '#94a3b8',        // Slate 400

  accent: '#3b82f6',           // Blue 500
  accentHover: '#2563eb',      // Blue 600
};
```

### Dark Theme

```typescript
const darkTheme = {
  background: '#0f172a',       // Slate 900
  surface: '#1e293b',          // Slate 800
  surfaceAlt: '#334155',       // Slate 700
  border: '#475569',           // Slate 600

  text: '#f8fafc',             // Slate 50
  textSecondary: '#94a3b8',    // Slate 400
  textMuted: '#64748b',        // Slate 500

  accent: '#60a5fa',           // Blue 400
  accentHover: '#3b82f6',      // Blue 500
};
```

---

## Semantic Colors

### Status Indicators

| Status | Light Mode | Dark Mode | Use For |
|--------|------------|-----------|---------|
| **Positive** | `#10b981` | `#34d399` | Growth, success, above target |
| **Negative** | `#ef4444` | `#f87171` | Decline, errors, below target |
| **Warning** | `#f59e0b` | `#fbbf24` | Caution, approaching limits |
| **Neutral** | `#6b7280` | `#9ca3af` | No change, baseline |
| **Info** | `#3b82f6` | `#60a5fa` | Informational highlights |

### Usage Examples

```html
<!-- KPI with positive change -->
<div class="kpi">
  <span class="value">$1.2M</span>
  <span class="change positive">▲ 15%</span>
</div>

<!-- KPI with negative change -->
<div class="kpi">
  <span class="value">$800K</span>
  <span class="change negative">▼ 8%</span>
</div>
```

---

## Data Visualization Palettes

### Categorical (Distinct Categories)

For comparing unrelated categories (regions, products, teams).

```typescript
const categorical = {
  default: [
    '#3b82f6',  // Blue
    '#10b981',  // Emerald
    '#f59e0b',  // Amber
    '#ef4444',  // Red
    '#8b5cf6',  // Violet
    '#ec4899',  // Pink
    '#06b6d4',  // Cyan
    '#84cc16',  // Lime
  ],

  // Softer variant for backgrounds/fills
  pastel: [
    '#93c5fd',  // Blue 300
    '#6ee7b7',  // Emerald 300
    '#fcd34d',  // Amber 300
    '#fca5a5',  // Red 300
    '#c4b5fd',  // Violet 300
    '#f9a8d4',  // Pink 300
    '#67e8f9',  // Cyan 300
    '#bef264',  // Lime 300
  ],
};
```

**When to use**: Bar charts comparing regions, pie charts showing market share, legends with distinct items.

### Sequential (Single Variable Intensity)

For showing magnitude from low to high.

```typescript
const sequential = {
  blue: [
    '#eff6ff',  // Blue 50
    '#bfdbfe',  // Blue 200
    '#60a5fa',  // Blue 400
    '#2563eb',  // Blue 600
    '#1e40af',  // Blue 800
  ],

  green: [
    '#f0fdf4',  // Green 50
    '#bbf7d0',  // Green 200
    '#4ade80',  // Green 400
    '#16a34a',  // Green 600
    '#166534',  // Green 800
  ],

  purple: [
    '#faf5ff',  // Purple 50
    '#e9d5ff',  // Purple 200
    '#c084fc',  // Purple 400
    '#9333ea',  // Purple 600
    '#6b21a8',  // Purple 800
  ],

  // For heatmaps
  heat: [
    '#fef3c7',  // Amber 100
    '#fcd34d',  // Amber 300
    '#f59e0b',  // Amber 500
    '#d97706',  // Amber 600
    '#92400e',  // Amber 800
  ],
};
```

**When to use**: Choropleth maps, heatmaps, gauges, progress indicators.

### Diverging (Two Extremes with Neutral Center)

For showing deviation from a baseline (positive/negative, above/below average).

```typescript
const diverging = {
  redGreen: [
    '#dc2626',  // Red 600 (negative)
    '#f87171',  // Red 400
    '#e5e7eb',  // Gray 200 (neutral)
    '#4ade80',  // Green 400
    '#16a34a',  // Green 600 (positive)
  ],

  blueOrange: [
    '#1d4ed8',  // Blue 700 (cold)
    '#60a5fa',  // Blue 400
    '#e5e7eb',  // Gray 200 (neutral)
    '#fb923c',  // Orange 400
    '#ea580c',  // Orange 600 (hot)
  ],

  purpleTeal: [
    '#7c3aed',  // Violet 600
    '#a78bfa',  // Violet 400
    '#e5e7eb',  // Gray 200
    '#2dd4bf',  // Teal 400
    '#0d9488',  // Teal 600
  ],
};
```

**When to use**: Performance vs target, year-over-year change, sentiment analysis.

---

## Chart-Specific Guidelines

### Bar Charts

```typescript
// Single series
const singleBar = '#3b82f6';  // Blue 500

// Multiple series (use categorical)
const multiBars = ['#3b82f6', '#10b981', '#f59e0b'];

// Highlighted bar
const highlightBar = '#f59e0b';  // Accent color
const normalBar = '#94a3b8';     // Muted
```

### Line Charts

```typescript
// Primary metric
const primaryLine = { color: '#3b82f6', width: 2 };

// Secondary metrics
const secondaryLine = { color: '#94a3b8', width: 1.5, dash: [5, 5] };

// Target/threshold line
const targetLine = { color: '#ef4444', width: 1, dash: [2, 2] };
```

### Pie/Donut Charts

```typescript
// Max 6 slices - use categorical palette
const pieColors = categorical.default.slice(0, 6);

// "Other" slice should be muted
const otherSlice = '#cbd5e1';  // Slate 300
```

### Heatmaps

```typescript
// Use sequential palette
const heatmapScale = sequential.heat;

// Or for diverging data (positive/negative)
const heatmapDiverging = diverging.redGreen;
```

---

## Accessibility

### Color Blindness Safe Palettes

```typescript
// Deuteranopia/Protanopia safe (no red-green)
const colorBlindSafe = [
  '#0077bb',  // Blue
  '#33bbee',  // Cyan
  '#009988',  // Teal
  '#ee7733',  // Orange
  '#cc3311',  // Red-Orange
  '#ee3377',  // Magenta
  '#bbbbbb',  // Gray
];

// Even safer: Use blue-orange diverging
const safeDiverging = diverging.blueOrange;
```

### Always Add Non-Color Indicators

```html
<!-- Don't rely on color alone -->
<span class="positive">▲ 15%</span>  <!-- Arrow indicates direction -->
<span class="negative">▼ 8%</span>

<!-- For charts, add patterns or labels -->
<rect fill="#10b981" data-pattern="diagonal" />
```

---

## Dark Mode Adjustments

When switching themes:

1. **Increase brightness** - Colors need to be brighter on dark backgrounds
2. **Reduce saturation** - Highly saturated colors are harsh in dark mode
3. **Flip value direction** - Dark backgrounds with light data colors

```typescript
// Light mode → Dark mode color mapping
const colorMap = {
  '#3b82f6': '#60a5fa',  // Blue: 500 → 400
  '#10b981': '#34d399',  // Emerald: 500 → 400
  '#ef4444': '#f87171',  // Red: 500 → 400
  '#f59e0b': '#fbbf24',  // Amber: 500 → 400
};
```

---

## SDK Integration

```typescript
// Get color scales
const helpers = sdk.dashboards.helpers;

// Categorical colors for bar chart
const barColors = helpers.getColorScale('categorical');

// Sequential for heatmap
const heatColors = helpers.getColorScale('sequential', 'blue');

// Diverging for performance
const perfColors = helpers.getColorScale('diverging', 'redGreen');

// Semantic colors for KPIs
const upColor = helpers.getSemanticColor('positive');    // #10b981
const downColor = helpers.getSemanticColor('negative');  // #ef4444
```
