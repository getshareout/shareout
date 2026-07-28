---
title: Templates, gráficos y realtime
description: Contenido repetitivo impulsado por tablas o arrays JSON, binding de datos en gráficos y regiones de sincronización realtime.
---

Los templates manejan contenido repetitivo. Los gráficos visualizan datos de tablas o
JSON. Las regiones realtime sincronizan contenido colaborativamente entre visitantes vía
Y.js.

## Templates

### Template básico

```html
<ul data-shareout-template="task-list"
    data-shareout-template-source="table:tasks">
  <li data-shareout-template-item>
    <span data-shareout-binding="table:tasks:row:$id:title"></span>
  </li>
</ul>
```

El elemento contenedor lleva `data-shareout-template` (un nombre) y
`data-shareout-template-source` (la expresión de source). Cada ítem hijo que se repite
recibe `data-shareout-template-item`.

### Variables de template

| Variable | Significado |
|----------|-------------|
| `$id` | Clave primaria de la fila de tabla actual |
| `$index` | Índice base cero del ítem actual del array JSON |

Usá `$id` para sources de tabla e `$index` para sources de array JSON.

### Template complejo

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

### Template de array JSON

```html
<ul data-shareout-template="tag-list"
    data-shareout-template-source="json:settings.tags">
  <li data-shareout-template-item>
    <span data-shareout-binding="json:settings.tags[$index]"></span>
  </li>
</ul>
```

## Gráficos

### Gráfico básico

```html
<div data-shareout-chart='{"type":"line","title":"Revenue Trend"}'
     data-shareout-chart-data="table:sales"
     data-shareout-chart-x="date"
     data-shareout-chart-y="revenue">
</div>
```

### Esquema de configuración del gráfico

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

El JSON de configuración va en `data-shareout-chart`. La fuente de datos, el campo del
eje x y el/los campo(s) del eje y son atributos separados.

### Gráfico multi-serie

Separar múltiples nombres de campo con coma en `data-shareout-chart-y`:

```html
<div data-shareout-chart='{"type":"line","title":"Revenue vs Expenses","legend":true}'
     data-shareout-chart-data="table:financials"
     data-shareout-chart-x="month"
     data-shareout-chart-y="revenue,expenses,profit">
</div>
```

### Gráfico filtrado

```html
<div data-shareout-chart='{"type":"bar","title":"2026 Sales by Category"}'
     data-shareout-chart-data="table:sales"
     data-shareout-chart-x="category"
     data-shareout-chart-y="amount"
     data-shareout-chart-filter="year=2026">
</div>
```

### Gráfico desde JSON

```html
<div data-shareout-chart='{"type":"pie","title":"Distribution"}'
     data-shareout-chart-data="json:metrics.distribution"
     data-shareout-chart-x="label"
     data-shareout-chart-y="value">
</div>
```

## Regiones realtime

Las regiones realtime sincronizan contenido entre todos los visitantes usando Y.js. El ID
del doc debe estar declarado en `manifest.sources.realtime`.

### Realtime básico

```html
<div data-shareout-realtime="doc-sync"
     data-shareout-realtime-key="content">
  <!-- el contenido se sincroniza en tiempo real -->
</div>
```

### Realtime con ítems nombrados

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

- El contenido repetitivo usa `data-shareout-template` con `data-shareout-template-source`.
- Los elementos de ítem del template tienen `data-shareout-template-item`.
- Los bindings del template usan `$id` (tabla) o `$index` (array JSON).
- La configuración del gráfico en `data-shareout-chart` es JSON válido.
- `data-shareout-chart-data` apunta a una source declarada en el manifest.
- Los IDs de docs realtime coinciden con entradas en `manifest.sources.realtime`.

## Relacionado

- [Bindings](/es/spec/bindings/) — sintaxis de binding usada dentro de templates
- [Manifest](/es/spec/manifest/) — declarar sources de tabla, JSON y realtime
- [Realtime](/es/sdk/realtime/) — API de `sdk.realtime()`
