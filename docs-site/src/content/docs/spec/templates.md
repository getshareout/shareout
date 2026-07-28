---
title: Templates, charts & realtime
description: Repeating content driven by tables or JSON arrays, chart data binding, and realtime sync regions.
---

Templates handle repeating content. Charts visualize table or JSON data. Realtime regions
sync collaboratively across viewers via Y.js.

## Templates

### Basic template

```html
<ul data-shareout-template="task-list"
    data-shareout-template-source="table:tasks">
  <li data-shareout-template-item>
    <span data-shareout-binding="table:tasks:row:$id:title"></span>
  </li>
</ul>
```

The container element carries `data-shareout-template` (a name) and
`data-shareout-template-source` (the source expression). Each child item that repeats
gets `data-shareout-template-item`.

### Template variables

| Variable | Meaning |
|----------|---------|
| `$id` | Primary key of the current table row |
| `$index` | Zero-based index of the current JSON array item |

Use `$id` for table sources and `$index` for JSON array sources.

### Complex template

```html
<div data-shareout-template="product-card"
     data-shareout-template-source="table:products">

  <div data-shareout-template-item class="card">
    <img data-shareout-binding="table:products:row:$id:image"
         data-shareout-display="Product Image">

    <h3 data-shareout-binding="table:products:row:$id:name"
        data-shareout-display="Product Name"></h3>

    <span data-shareout-binding="table:products:row:$id:price"
          data-shareout-format="currency"
          data-shareout-display="Price">$0</span>

    <input type="number"
           data-shareout-binding="table:products:row:$id:quantity"
           data-shareout-editable="true"
           data-shareout-validation="number:min=0"
           data-shareout-display="Quantity">
  </div>

</div>
```

### JSON array template

```html
<ul data-shareout-template="tag-list"
    data-shareout-template-source="json:settings.tags">
  <li data-shareout-template-item>
    <span data-shareout-binding="json:settings.tags[$index]"></span>
  </li>
</ul>
```

## Charts

### Basic chart

```html
<div data-shareout-chart='{"type":"line","title":"Revenue Trend"}'
     data-shareout-chart-data="table:sales"
     data-shareout-chart-x="date"
     data-shareout-chart-y="revenue">
</div>
```

### Chart config schema

```typescript
interface ChartConfig {
  type: "line" | "bar" | "pie" | "area" | "scatter";
  title?: string;
  subtitle?: string;
  legend?: boolean;
  stacked?: boolean;
  colors?: string[];
  height?: number;
}
```

The config JSON goes in `data-shareout-chart`. The data source, x-axis field, and y-axis
field(s) are separate attributes.

### Multi-series chart

Comma-separate multiple field names in `data-shareout-chart-y`:

```html
<div data-shareout-chart='{"type":"line","title":"Revenue vs Expenses","legend":true}'
     data-shareout-chart-data="table:financials"
     data-shareout-chart-x="month"
     data-shareout-chart-y="revenue,expenses,profit">
</div>
```

### Filtered chart

```html
<div data-shareout-chart='{"type":"bar","title":"2026 Sales by Category"}'
     data-shareout-chart-data="table:sales"
     data-shareout-chart-x="category"
     data-shareout-chart-y="amount"
     data-shareout-chart-filter="year=2026">
</div>
```

### Chart from JSON

```html
<div data-shareout-chart='{"type":"pie","title":"Distribution"}'
     data-shareout-chart-data="json:metrics.distribution"
     data-shareout-chart-x="label"
     data-shareout-chart-y="value">
</div>
```

## Realtime regions

Realtime regions sync content across all viewers using Y.js. The doc ID must be declared
in `manifest.sources.realtime`.

### Basic realtime

```html
<div data-shareout-realtime="doc-sync"
     data-shareout-realtime-key="content">
  <!-- content syncs in real time -->
</div>
```

### Realtime with named items

```html
<div data-shareout-realtime="board-sync"
     data-shareout-realtime-key="columns">
  <div data-shareout-realtime-item="todo">
    <h3>To Do</h3>
  </div>
  <div data-shareout-realtime-item="in-progress">
    <h3>In Progress</h3>
  </div>
  <div data-shareout-realtime-item="done">
    <h3>Done</h3>
  </div>
</div>
```

## Checklist

- Repeating content uses `data-shareout-template` with a `data-shareout-template-source`.
- Template item elements have `data-shareout-template-item`.
- Template bindings use `$id` (table) or `$index` (JSON array).
- Chart config in `data-shareout-chart` is valid JSON.
- `data-shareout-chart-data` points to a source declared in the manifest.
- Realtime doc IDs match entries in `manifest.sources.realtime`.

## Related

- [Bindings](/spec/bindings/) — binding syntax used inside templates
- [Manifest](/spec/manifest/) — declaring table, JSON, and realtime sources
- [Realtime](/sdk/realtime/) — `sdk.realtime()` API
