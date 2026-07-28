# Dashboard Design Module

Visual design guidelines for creating professional, data-driven dashboards.

## How Claude Uses This

When users create dashboards, Claude references these guidelines to:

1. **Choose appropriate widget types** based on data and intent
2. **Select color palettes** optimized for data visualization
3. **Apply layouts** that maximize information density
4. **Structure KPIs** for quick scanning
5. **Configure charts** for clarity and insight
6. **Follow accessibility** best practices

---

## Contents

| File | Purpose |
|------|---------|
| [principles.md](principles.md) | Core dashboard design principles |
| [colors.md](colors.md) | Data visualization color palettes |
| [layouts.md](layouts.md) | Grid layout patterns |
| [widgets.md](widgets.md) | Widget design guidelines |
| [charts.md](charts.md) | Chart type selection & styling |

---

## Quick Reference

### The 5-Second Rule

Users should understand the dashboard's story within 5 seconds:
- **KPIs at top** - most important numbers first
- **Left to right** - primary → secondary → detail
- **Top to bottom** - summary → trends → details

### Widget Density

| Widget Type | Recommended Size | Content Limit |
|-------------|------------------|---------------|
| KPI | 3x2 cols | 1 metric + comparison |
| Chart | 6x4 cols | 1 insight per chart |
| Table | 12x5 cols | 10 rows visible |
| Text | 3x2 cols | 50 words max |

### Color Usage

```
60% - Background (neutral)
30% - Data/content areas
10% - Accent/highlight (alerts, CTAs)
```

### Semantic Colors

| Color | Hex | Use For |
|-------|-----|---------|
| Positive | `#10b981` | Growth, success, above target |
| Negative | `#ef4444` | Decline, errors, below target |
| Warning | `#f59e0b` | Caution, approaching limits |
| Neutral | `#6b7280` | No change, baseline |

### Typography Scale

```
Dashboard Title:  24-32px  (Inter/bold)
Widget Title:     16-18px  (Inter/semibold)
KPI Value:        32-48px  (Inter/bold)
KPI Label:        12-14px  (Inter/regular)
Table Header:     12-14px  (Inter/medium)
Table Cell:       12-14px  (Inter/regular)
Axis Labels:      10-12px  (Inter/regular)
```

---

## Dashboard Archetypes

### Executive Summary
```
┌──────┬──────┬──────┬──────┐
│ KPI  │ KPI  │ KPI  │ KPI  │  ← Key metrics
├──────┴──────┼──────┴──────┤
│   Trend     │  Breakdown  │  ← Primary visuals
├─────────────┴─────────────┤
│         Details           │  ← Supporting data
└───────────────────────────┘
```

### Operational Monitor
```
┌───────────────────────────┐
│      Status Overview      │  ← Health indicators
├──────┬──────┬──────┬──────┤
│Alert │Alert │Alert │Alert │  ← Active issues
├──────┴──────┴──────┴──────┤
│       Activity Feed       │  ← Real-time events
└───────────────────────────┘
```

### Analytical Deep-Dive
```
┌───────────────────────────┐
│    Filters & Controls     │  ← User inputs
├─────────────┬─────────────┤
│  Primary    │  Secondary  │  ← Analysis views
│  Analysis   │  Context    │
├─────────────┴─────────────┤
│      Detailed Table       │  ← Raw data access
└───────────────────────────┘
```

---

## Accessibility

1. **Color contrast** - 4.5:1 minimum for text
2. **Don't rely on color alone** - Use icons, patterns, labels
3. **Readable fonts** - 12px minimum for data
4. **Clear labels** - Every chart needs axis labels
5. **Alt text** - Describe what the visualization shows

---

## Performance

1. **Limit widgets** - 8-12 per dashboard max
2. **Paginate tables** - 10-25 rows visible
3. **Lazy load** - Load below-fold widgets on scroll
4. **Cache data** - Don't refetch unchanged data
5. **Debounce filters** - 300ms delay on input

---

## Integration with SDK

```javascript
// Set dashboard theme using design principles
dashboard.meta.set({
  defaultFont: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
  defaultColors: {
    background: '#f8fafc',
    surface: '#ffffff',
    text: '#1e293b',
    textSecondary: '#64748b',
    accent: '#3b82f6',
    positive: '#10b981',
    negative: '#ef4444',
    neutral: '#6b7280'
  }
});

// Use helpers for consistent formatting
const helpers = sdk.dashboards.helpers;
helpers.formatCurrency(1234567);     // "$1,234,567"
helpers.formatPercent(0.156);        // "15.6%"
helpers.getSemanticColor('positive'); // "#10b981"
```
