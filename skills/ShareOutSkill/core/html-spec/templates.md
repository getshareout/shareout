# ShareOut Templates, Charts & Realtime

Templates handle repeating content. Charts visualize data. Realtime regions sync collaboratively.

## Templates

### Basic Template

```html
<ul data-shareout-template="task-list"
    data-shareout-template-source="table:tasks">
  <li data-shareout-template-item>
    <span data-shareout-binding="table:tasks:row:$id:title"></span>
  </li>
</ul>
```

### Template Variables

| Variable | Meaning | Use Case |
|----------|---------|----------|
| `$id` | Row primary key | Table row references |
| `$index` | Array index (0-based) | JSON array iteration |

### Complex Template

```html
<div data-shareout-template="product-card"
     data-shareout-template-source="table:products">

  <div data-shareout-template-item class="card">
    <img data-shareout-binding="table:products:row:$id:image"
         data-shareout-display="Product Image">

    <h3 data-shareout-binding="table:products:row:$id:name"
        data-shareout-display="Product Name"></h3>

    <p data-shareout-binding="table:products:row:$id:description"
       data-shareout-display="Description"></p>

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

### JSON Array Template

```html
<ul data-shareout-template="tag-list"
    data-shareout-template-source="json:settings.tags">
  <li data-shareout-template-item>
    <span data-shareout-binding="json:settings.tags[$index]"></span>
  </li>
</ul>
```

## Charts

### Basic Chart

```html
<div data-shareout-chart='{"type":"line","title":"Revenue Trend"}'
     data-shareout-chart-data="table:sales"
     data-shareout-chart-x="date"
     data-shareout-chart-y="revenue">
</div>
```

### Chart Config (JSON)

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

### Multi-Series Chart

```html
<div data-shareout-chart='{"type":"line","title":"Revenue vs Expenses","legend":true}'
     data-shareout-chart-data="table:financials"
     data-shareout-chart-x="month"
     data-shareout-chart-y="revenue,expenses,profit">
</div>
```

### Filtered Chart

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

## Realtime Regions

### Basic Realtime

```html
<div data-shareout-realtime="doc-sync"
     data-shareout-realtime-key="content">
  <!-- Content syncs in real-time -->
</div>
```

### Realtime with Items

```html
<div data-shareout-realtime="board-sync"
     data-shareout-realtime-key="columns">
  <div data-shareout-realtime-item="todo">
    <h3>To Do</h3>
    <!-- Column content -->
  </div>
  <div data-shareout-realtime-item="in-progress">
    <h3>In Progress</h3>
    <!-- Column content -->
  </div>
  <div data-shareout-realtime-item="done">
    <h3>Done</h3>
    <!-- Column content -->
  </div>
</div>
```

## Validation Checklist

Full compliance checklist: [overview.md](overview.md#compliance-checklist). Template/chart/realtime-specific checks:

### Templates
- [ ] Template has `data-shareout-template-source` pointing to declared source
- [ ] Template items have `data-shareout-template-item` attribute
- [ ] Template bindings use `$id` or `$index` variables

### Charts
- [ ] Chart config is valid JSON in `data-shareout-chart`
- [ ] `data-shareout-chart-data` points to declared source
- [ ] `data-shareout-chart-x` and `data-shareout-chart-y` are valid fields

### Realtime
- [ ] Realtime doc ID matches manifest `sources.realtime` entry
- [ ] Items within realtime container have `data-shareout-realtime-item`

## Related

- [Bindings](bindings.md) - Binding syntax within templates
- [Manifest](manifest.md) - Declaring template sources
