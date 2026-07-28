# Dashboard Design Principles

Core principles for creating effective, scannable dashboards.

---

## 1. Information Hierarchy

**Guide the eye from most to least important.**

```
┌─────────────────────────────────────────┐
│  MOST IMPORTANT (Top)                   │
│  • KPIs, critical metrics               │
│  • What needs immediate attention       │
├─────────────────────────────────────────┤
│  CONTEXT (Middle)                       │
│  • Trends, comparisons                  │
│  • How we got here                      │
├─────────────────────────────────────────┤
│  DETAILS (Bottom)                       │
│  • Tables, drill-down data              │
│  • Supporting information               │
└─────────────────────────────────────────┘
```

### Implementation

- **Position**: Top-left = highest priority
- **Size**: Larger widgets = more important
- **Color**: Accent colors draw attention
- **Whitespace**: Important items get breathing room

---

## 2. Data Density vs Clarity

**Maximize information without overwhelming.**

### Bad: Too Sparse
```
┌────────────────────────────────┐
│                                │
│           $1.2M                │
│                                │
│                                │
└────────────────────────────────┘
```
*Wastes space, no context*

### Bad: Too Dense
```
┌────────────────────────────────┐
│ Rev: $1.2M | +15% | Q4 | YoY   │
│ Units: 847K | -3% | Proj: 900K │
│ Margin: 23% | Target: 25%      │
│ CAC: $45 | LTV: $180 | Ratio:4 │
└────────────────────────────────┘
```
*Overwhelming, hard to scan*

### Good: Balanced
```
┌────────────────────────────────┐
│  Revenue                       │
│  $1.2M          ▲ 15%         │
│  ▁▂▃▄▅▆▇ trend                │
└────────────────────────────────┘
```
*Clear primary metric, contextual comparison, visual trend*

---

## 3. Consistency

**Same data types should look the same.**

### Colors
- All revenue metrics → same blue
- All percentages → same format
- All negative values → red

### Formatting
- Currency: Always `$X.XM` or `$X,XXX`
- Percentages: Always `XX.X%`
- Dates: Always `MMM DD` or `YYYY-MM-DD`

### Layout
- KPIs: Always same height
- Charts: Consistent axis scaling
- Tables: Same column widths for same data types

---

## 4. Context Over Raw Numbers

**Numbers without context are meaningless.**

### Bad
```
Revenue: $1,234,567
```

### Good
```
Revenue: $1.2M
▲ 15% vs last month
Target: $1.5M (82% achieved)
```

### Types of Context

| Type | Example |
|------|---------|
| **Comparison** | vs last period, vs target, vs benchmark |
| **Trend** | Sparkline, direction indicator |
| **Status** | On track, at risk, critical |
| **Ranking** | #1 of 10, Top 5%, Quartile |

---

## 5. Actionable Insights

**Every widget should answer a question.**

### Questions Dashboards Answer

| Widget | Question |
|--------|----------|
| KPI | "What's the current state?" |
| Trend Line | "Where are we heading?" |
| Bar Chart | "How do things compare?" |
| Pie Chart | "What's the breakdown?" |
| Table | "What are the details?" |
| Alert | "What needs attention?" |

### Anti-pattern: Data Without Purpose

Don't include data just because it's available. Every widget should help users:
1. **Understand** the current situation
2. **Decide** what action to take
3. **Monitor** progress toward goals

---

## 6. Progressive Disclosure

**Start simple, allow drill-down.**

```
Level 1: Dashboard Overview
├── KPI cards (headline numbers)
│
Level 2: Widget Interaction
├── Hover for details
├── Click for drill-down
│
Level 3: Full Detail
└── Modal or linked view with complete data
```

### Implementation

- **Tooltips**: Show exact values on hover
- **Click-through**: Charts link to filtered views
- **Expandable tables**: Show more rows on demand
- **Filter presets**: Save complex filter combinations

---

## 7. Real-Time vs Historical

**Clearly distinguish current state from historical data.**

### Current State Indicators
- "Live" badge
- Last updated timestamp
- Pulse animation for real-time
- Green border/glow

### Historical Data Indicators
- Date range selector visible
- "As of [date]" labels
- Grayed styling for archived data

---

## 8. Error States & Empty States

**Handle missing data gracefully.**

### Loading
```
┌────────────────────────────────┐
│  ████████░░░░  Loading...     │
└────────────────────────────────┘
```

### No Data
```
┌────────────────────────────────┐
│  📊 No data for this period   │
│  Try adjusting your filters   │
└────────────────────────────────┘
```

### Error
```
┌────────────────────────────────┐
│  ⚠️ Unable to load data       │
│  [Retry] or contact support   │
└────────────────────────────────┘
```

### Stale Data
```
┌────────────────────────────────┐
│  Revenue: $1.2M               │
│  ⚠️ Data is 2 hours old       │
└────────────────────────────────┘
```

---

## 9. Mobile Responsiveness

**Dashboards should work on smaller screens.**

### Desktop → Tablet → Mobile

```
Desktop (12 columns):
┌───┬───┬───┬───┐
│KPI│KPI│KPI│KPI│
├───┴───┼───┴───┤
│ Chart │ Chart │
└───────┴───────┘

Tablet (8 columns):
┌───┬───┐
│KPI│KPI│
├───┼───┤
│KPI│KPI│
├───┴───┤
│ Chart │
├───────┤
│ Chart │
└───────┘

Mobile (4 columns):
┌───┐
│KPI│
├───┤
│KPI│
├───┤
│...│
└───┘
```

### Responsive Rules

1. **KPIs**: Stack vertically on mobile
2. **Charts**: Full width on mobile
3. **Tables**: Horizontal scroll or card view
4. **Filters**: Collapse into dropdown menu

---

## 10. Performance Perception

**Make dashboards feel fast.**

### Techniques

| Technique | Implementation |
|-----------|----------------|
| **Skeleton loading** | Show widget shapes while loading |
| **Progressive loading** | Load above-fold first |
| **Optimistic updates** | Show changes immediately |
| **Cached data** | Show stale data while refreshing |
| **Lazy loading** | Load off-screen widgets on scroll |

### Refresh Strategy

```javascript
// Good: Staggered refresh
dashboard.dataSources.forEach((ds, i) => {
  setTimeout(() => ds.refresh(), i * 500);
});

// Bad: All at once
await Promise.all(dashboard.dataSources.map(ds => ds.refresh()));
```
