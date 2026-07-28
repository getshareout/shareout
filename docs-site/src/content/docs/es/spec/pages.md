---
title: Páginas, secciones y navegación
description: Estructura de artifacts multi-página con data-shareout-page, secciones, tabs y enlaces de navegación.
---

Los artifacts de ShareOut pueden ser de una sola página o SPAs multi-página. La estructura
se define con atributos `data-shareout-*` que el editor lee para construir su panel de
esquema y el SDK lee para manejar la navegación.

## Jerarquía

```
data-shareout-page
└── data-shareout-section
    └── data-shareout-tabs
        └── data-shareout-tab
```

Los tabs también pueden aparecer directamente dentro de una página sin una sección
intermedia.

## Páginas

### Página única

```html
<main data-shareout-page="dashboard" data-shareout-page-title="Dashboard">
  <!-- contenido -->
</main>
```

### Múltiples páginas

Solo la primera página es visible por defecto. Las demás se ocultan con el atributo
`hidden`:

```html
<main data-shareout-page="dashboard" data-shareout-page-title="Dashboard">
  <!-- contenido del dashboard -->
</main>

<main data-shareout-page="settings" data-shareout-page-title="Settings" hidden>
  <!-- contenido de configuración -->
</main>

<main data-shareout-page="reports" data-shareout-page-title="Reports" hidden>
  <!-- contenido de reportes -->
</main>
```

El SDK gestiona la visibilidad cuando un `data-shareout-link` navega entre páginas.

## Secciones

Las secciones subdividen una página en el esquema del editor:

```html
<main data-shareout-page="dashboard" data-shareout-page-title="Dashboard">

  <section data-shareout-section="kpis" data-shareout-section-title="Key Metrics">
    <!-- KPI cards -->
  </section>

  <section data-shareout-section="charts" data-shareout-section-title="Analytics">
    <!-- gráficos -->
  </section>

  <section data-shareout-section="activity" data-shareout-section-title="Recent Activity">
    <!-- tabla de datos -->
  </section>

</main>
```

## Reordenamiento por arrastre (editor visual)

Agregá `data-shareout-sortable` a cualquier contenedor cuyos hijos directos deban poder
reordenarse por arrastre en el editor. El atributo cambia el orden del HTML en el
documento; los ítems permanecen dentro de su contenedor.

```html
<!-- pila vertical -->
<section data-shareout-section="features" data-shareout-sortable>
  <div class="feature-card">...</div>
  <div class="feature-card">...</div>
</section>

<!-- fila o grilla horizontal -->
<div class="card-row" data-shareout-sortable="x">
  <div class="card">...</div>
  <div class="card">...</div>
</div>
```

| Valor | Comportamiento |
|-------|----------------|
| `data-shareout-sortable` | Reordena hijos verticalmente |
| `data-shareout-sortable="x"` | Reordena hijos horizontalmente |

## Tabs

```html
<div data-shareout-tabs="time-period">
  <div data-shareout-tab="daily" data-shareout-tab-title="Daily">
    <!-- contenido diario -->
  </div>
  <div data-shareout-tab="weekly" data-shareout-tab-title="Weekly">
    <!-- contenido semanal -->
  </div>
  <div data-shareout-tab="monthly" data-shareout-tab-title="Monthly">
    <!-- contenido mensual -->
  </div>
</div>
```

Tabs dentro de una sección:

```html
<section data-shareout-section="analytics" data-shareout-section-title="Analytics">
  <div data-shareout-tabs="chart-views">
    <div data-shareout-tab="revenue" data-shareout-tab-title="Revenue">...</div>
    <div data-shareout-tab="users"   data-shareout-tab-title="Users">...</div>
  </div>
</section>
```

## Navegación

Usá `data-shareout-nav` en el contenedor y `data-shareout-link` en cada enlace. No uses
atributos `href` directos para navegación interna — el SDK no los intercepta.

```html
<nav data-shareout-nav="main" data-shareout-nav-title="Main Navigation">

  <a data-shareout-link="page:dashboard"
     data-shareout-link-display="Dashboard Link">
    Dashboard
  </a>

  <a data-shareout-link="page:settings"
     data-shareout-link-display="Settings Link">
    Settings
  </a>

</nav>
```

### Tipos de enlace

| Tipo | Sintaxis | Descripción |
|------|--------|-------------|
| Página | `page:PAGE_ID` | Navegar a una página |
| Sección | `section:SECTION_ID` | Hacer scroll a una sección |
| Tab | `tab:TAB_GROUP:TAB_ID` | Activar un tab |
| Externo | `external:URL` | Abrir una URL externa |
| Modal | `modal:MODAL_ID` | Abrir un modal |

### Clase de estado activo

```html
<a data-shareout-link="page:dashboard"
   data-shareout-link-active-class="nav-active"
   data-shareout-link-display="Dashboard">
  Dashboard
</a>
```

### Transiciones de página

```html
<main data-shareout-page="dashboard"
      data-shareout-page-title="Dashboard"
      data-shareout-transition="fade"
      data-shareout-transition-duration="200">
  <!-- contenido -->
</main>
```

| Transición | Descripción |
|------------|-------------|
| `none` | Cambio instantáneo |
| `fade` | Fade in/out |
| `slide-left` | Desliza desde la derecha |
| `slide-right` | Desliza desde la izquierda |
| `slide-up` | Desliza desde abajo |
| `slide-down` | Desliza desde arriba |
| `zoom` | Escala in/out |

### Deep links

Las secciones pueden marcarse para compartirse directamente con `data-shareout-deeplink="true"`:

```html
<section id="pricing"
         data-shareout-section="pricing"
         data-shareout-section-title="Pricing"
         data-shareout-deeplink="true"
         data-shareout-deeplink-display="Pricing Section">
  <!-- compartible como #pricing -->
</section>
```

## Checklist

- Existe al menos un elemento `data-shareout-page`.
- Cada página tiene `data-shareout-page-title`.
- Las páginas adicionales están ocultas con el atributo `hidden`.
- Las secciones tienen `data-shareout-section` y `data-shareout-section-title`.
- Los contenedores con hijos reordenables tienen `data-shareout-sortable`.
- Los tabs están dentro de contenedores `data-shareout-tabs` con `data-shareout-tab-title` en cada tab.
- La navegación usa `data-shareout-nav` y `data-shareout-link`.
- Los destinos de los enlaces referencian IDs de páginas, secciones o tabs declarados.

## Relacionado

- [Resumen](/es/spec/overview/) — referencia completa de atributos y checklist de cumplimiento
- [Bindings](/es/spec/bindings/) — bindings de datos dentro de páginas y secciones
- [Templates](/es/spec/templates/) — contenido repetitivo y gráficos dentro de páginas
