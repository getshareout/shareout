---
title: Widgets y gráficos
description: Tipos de widgets, tipos de gráficos y layout de grilla para dashboards de ShareOut.
---

Los dashboards están compuestos de widgets ubicados en una grilla responsive de
12 columnas. Cada widget tiene un tipo, un binding a una fuente de datos y una
posición en la grilla (`x`, `y`, `w`, `h`).

## Tipos de widgets

| Tipo | Propósito |
| --- | --- |
| `kpi` | Métrica única con comparación opcional y sparkline |
| `chart` | Visualización de datos (line, bar, pie, scatter, gauge, y más) |
| `table` | Tabla de datos ordenable y paginada |
| `text` | Labels y anotaciones en Markdown o HTML |
| `filter` | Control de filtro interactivo (dropdown, date picker, etc.) |
| `html` | HTML libre; scripts deshabilitados por defecto |
| `image` | Imagen estática desde blobs |
| `embed` | Embed por iframe |

## Widget KPI

Muestra una única métrica con contexto. Es el tipo de widget más usado.

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
  label: 'Ingresos Totales',
  format: 'currency',
  formatOptions: { notation: 'compact' },
  comparison: {
    value: 'prev_month_revenue',
    type: 'percent',
    invertColors: false,        // true cuando menor es mejor
  },
  sparkline: { field: 'daily_revenue', type: 'area' },
  size: 'lg',                   // 'sm' | 'md' | 'lg'
}, { x: 0, y: 0, w: 4, h: 3 });
```

**Valores de `format`:** `'number'` | `'currency'` | `'percent'` | `'custom'`

**Tamaños recomendados:**

| Tamaño | Grilla (`w×h`) | Muestra |
| --- | --- | --- |
| Chico | 3×2 | Valor + label |
| Mediano | 3×2 | Valor + label + cambio |
| Grande | 4×3 | Valor + label + cambio + sparkline |

## Widget Chart

Visualiza tendencias y comparaciones de datos.

**Tipos de gráfico:** `line` | `bar` | `area` | `pie` | `donut` | `scatter` |
`heatmap` | `gauge` | `funnel` | `treemap`

### Elegir el tipo de gráfico

| Pregunta | Gráfico |
| --- | --- |
| ¿Cómo cambia en el tiempo? | `line` (continuo), `bar` (períodos discretos) |
| ¿Cómo se comparan las categorías? | `bar` (vertical ≤7 categorías, horizontal para más o labels largos) |
| ¿Cuál es la composición? | `pie` / `donut` (≤6 partes) |
| ¿Existe correlación? | `scatter` |
| ¿Cuál es el avance hacia una meta? | `gauge` |
| ¿Cuál es el flujo de conversión? | `funnel` |
| ¿Patrones en dos dimensiones? | `heatmap` |

```javascript
// Gráfico de líneas
dashboard.widgets.add('chart', {
  chartType: 'line',
  xAxis: { field: 'date', type: 'time', label: 'Fecha' },
  yAxis: { field: 'revenue', label: 'Ingresos ($)', min: 0 },
  series: [
    { field: 'revenue', name: 'Real',   color: '#3b82f6' },
    { field: 'target',  name: 'Objetivo', color: '#94a3b8' },
  ],
  legend: { show: true, position: 'top' },
  animation: true,
}, { x: 0, y: 2, w: 6, h: 4 });
```

**Tamaños mínimos recomendados:**

| Tipo de gráfico | Mínimo (`w×h`) | Ideal |
| --- | --- | --- |
| Line / Area | 6×3 | 6×4 |
| Bar (vertical) | 4×3 | 6×4 |
| Bar (horizontal) | 6×4 | 8×5 |
| Pie / Donut | 4×4 | 4×4 |
| Scatter | 6×4 | 6×5 |
| Gauge | 3×3 | 4×3 |

## Widget Table

Tabla de datos ordenable, filtrable y paginada.

```javascript
dashboard.widgets.add('table', {
  columns: [
    { field: 'name',    header: 'Cliente',  sortable: true },
    { field: 'revenue', header: 'Ingresos', format: 'currency', align: 'right', sortable: true },
    { field: 'status',  header: 'Estado',   format: 'badge' },
  ],
  pageSize: 10,
  sortable: true,
  filterable: true,
  striped: true,
}, { x: 0, y: 6, w: 12, h: 5 });
```

Opciones de `format` para columnas: `text` | `number` | `currency` | `percent` |
`date` | `boolean` | `link` | `image` | `badge`

Las tablas generalmente ocupan las 12 columnas completas. Mostrá 8–12 filas
sin scroll (5–6 unidades de fila); paginá a 10–25 ítems.

## Widget Text

Contenido estático en Markdown o HTML — encabezados de sección, anotaciones,
instrucciones.

```javascript
dashboard.widgets.add('text', {
  content: '## Rendimiento de Ventas',
  contentType: 'markdown',   // 'markdown' | 'html'
  align: 'left',
}, { x: 0, y: 0, w: 12, h: 1 });
```

## Widget Filter

Los controles de filtro interactivos se definen via
`dashboard.filters.addDefinition()`, no via `widgets.add()`. Tipos de filtro:
`select` | `multiselect` | `daterange` | `numberrange` | `search`.

```javascript
dashboard.filters.addDefinition({
  type: 'select',
  label: 'Región',
  options: [
    { value: 'na',   label: 'Norteamérica' },
    { value: 'eu',   label: 'Europa' },
    { value: 'apac', label: 'Asia Pacífico' },
  ],
  affects: '*',    // '*' = todos los widgets; o array de IDs
});

dashboard.filters.addDefinition({
  type: 'daterange',
  label: 'Período',
  defaultValue: { from: '2026-01-01', to: '2026-12-31' },
  affects: ['chart-revenue', 'table-details'],
});
```

## Widget HTML

HTML libre para visualizaciones personalizadas o contenido embebido.

```javascript
dashboard.widgets.add('html', {
  content: '<div class="custom-viz" style="height:100%"><canvas id="globe"></canvas></div>',
  scripts: false,   // habilitá solo para contenido de confianza
}, { x: 0, y: 0, w: 6, h: 6 });
```

Los scripts están en sandbox y deshabilitados por defecto. Sandboxeá los
iframes embebidos.

## Layout de grilla

Los dashboards usan una grilla de 12 columnas. Las posiciones de los widgets
son coordenadas de columna y fila con índice cero.

```
┌─┬─┬─┬─┬─┬─┬─┬─┬─┬──┬──┬──┐
│0│1│2│3│4│5│6│7│8│ 9│10│11│
└─┴─┴─┴─┴─┴─┴─┴─┴─┴──┴──┴──┘
```

Altura de fila por defecto: 80 px por unidad de fila.

**Tamaños estándar:**

| Widget | `w` | `h` |
| --- | --- | --- |
| KPI (chico) | 3 | 2 |
| KPI (grande) | 4 | 3 |
| Chart (mitad del ancho) | 6 | 4 |
| Chart (ancho completo) | 12 | 4–5 |
| Table | 12 | 5–6 |
| Barra de filtros | 12 | 1 |

### Ejemplo: layout ejecutivo

```javascript
// Fila de KPIs
dashboard.widgets.add('kpi', kpiConfig1, { x: 0, y: 0, w: 3, h: 2 });
dashboard.widgets.add('kpi', kpiConfig2, { x: 3, y: 0, w: 3, h: 2 });
dashboard.widgets.add('kpi', kpiConfig3, { x: 6, y: 0, w: 3, h: 2 });
dashboard.widgets.add('kpi', kpiConfig4, { x: 9, y: 0, w: 3, h: 2 });

// Fila de gráficos
dashboard.widgets.add('chart', trendConfig,     { x: 0, y: 2, w: 6, h: 4 });
dashboard.widgets.add('chart', breakdownConfig, { x: 6, y: 2, w: 6, h: 4 });

// Fila de tabla
dashboard.widgets.add('table', tableConfig, { x: 0, y: 6, w: 12, h: 5 });
```

### Breakpoints responsive

El campo `layout` en `DashboardMeta` puede ser `'fixed'` o `'responsive'`. En
modo responsive la grilla se reorganiza en los breakpoints estándar:

| Viewport | Columnas | Cambio típico |
| --- | --- | --- |
| Desktop ≥1280 px | 12 | Layout completo |
| Tablet 768–1279 px | 8 | KPIs de a 2, gráficos apilados |
| Mobile ≤767 px | 4 | KPIs de a 1, gráficos a ancho completo |

### Anti-patrones de layout

- Más de 4–6 KPIs saturan la vista de un vistazo; agrupá métricas relacionadas.
- Los KPIs deben estar siempre sobre el fold — los viewers no deberían tener que
  hacer scroll para ver los números clave.
- Variá los tamaños de los widgets para señalar importancia; tamaños uniformes
  hacen que todo parezca igual de importante.
- Usá splits de columnas consistentes (6+6, 8+4, 4+4+4); evitá proporciones
  incómodas.

## Reposicionar widgets

Después de agregar un widget, podés moverlo o redimensionarlo vía el layout manager:

```javascript
dashboard.layout.move('kpi-revenue', 3, 0);       // mover a (3, 0)
dashboard.layout.resize('chart-trend', 8, 4);      // redimensionar a 8 cols × 4 filas
dashboard.layout.update('table-deals', { x: 0, y: 9, w: 12, h: 5 });
```
