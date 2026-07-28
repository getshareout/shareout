# ShareOut Page Structure

Pages, sections, tabs, and navigation for structured documents.

## Hierarchy

```
data-shareout-page (Level 0)
├── data-shareout-section (Level 1)
│   └── data-shareout-tabs (Level 2)
│       └── data-shareout-tab (Level 2)
└── data-shareout-tabs (Level 1, if no section)
    └── data-shareout-tab (Level 1)
```

## Pages

### Single Page

```html
<main data-shareout-page="dashboard" data-shareout-page-title="Dashboard">
  <h1>Dashboard</h1>
  <!-- Page content -->
</main>
```

### Multiple Pages (SPA)

```html
<main data-shareout-page="dashboard" data-shareout-page-title="Dashboard">
  <!-- Dashboard content -->
</main>

<main data-shareout-page="settings" data-shareout-page-title="Settings" hidden>
  <!-- Settings content -->
</main>

<main data-shareout-page="reports" data-shareout-page-title="Reports" hidden>
  <!-- Reports content -->
</main>
```

## Sections

```html
<main data-shareout-page="dashboard" data-shareout-page-title="Dashboard">

  <section data-shareout-section="kpis" data-shareout-section-title="Key Metrics">
    <div class="kpi-grid">
      <!-- KPI cards -->
    </div>
  </section>

  <section data-shareout-section="charts" data-shareout-section-title="Analytics">
    <!-- Charts -->
  </section>

  <section data-shareout-section="table" data-shareout-section-title="Recent Activity">
    <!-- Data table -->
  </section>

</main>
```

## Drag-to-Reorder (Visual Editor)

Mark a container with `data-shareout-sortable` to let users **drag its direct children to reorder them** in the ShareOut visual editor. Reordering happens in document flow (the HTML order actually changes) — children never become free-floating. Items stay within their container, so a nav link can't be dropped into the footer.

Add it to any wrapper whose children are meant to be rearranged: card grids, feature lists, section stacks, gallery rows.

```html
<!-- Vertical stack: children reorder top-to-bottom -->
<section data-shareout-section="features" data-shareout-sortable>
  <div class="feature-card">...</div>
  <div class="feature-card">...</div>
  <div class="feature-card">...</div>
</section>

<!-- Horizontal row or grid: reorder left-to-right -->
<div class="card-row" data-shareout-sortable="x">
  <div class="card">...</div>
  <div class="card">...</div>
</div>
```

| Value | Behavior |
|-------|----------|
| `data-shareout-sortable` | Children reorder vertically (default) |
| `data-shareout-sortable="x"` | Children reorder horizontally (flex/grid rows) |

In the editor, a selected child inside a sortable container shows a **drag handle** above its outline; dragging it shows a drop line and commits the new order on release. Without this attribute, elements can be selected and edited but not reordered.

## Tabs

### Basic Tabs

```html
<div data-shareout-tabs="time-period">
  <div data-shareout-tab="daily" data-shareout-tab-title="Daily">
    <!-- Daily view content -->
  </div>
  <div data-shareout-tab="weekly" data-shareout-tab-title="Weekly">
    <!-- Weekly view content -->
  </div>
  <div data-shareout-tab="monthly" data-shareout-tab-title="Monthly">
    <!-- Monthly view content -->
  </div>
</div>
```

### Tabs within Section

```html
<section data-shareout-section="analytics" data-shareout-section-title="Analytics">
  <div data-shareout-tabs="chart-views">
    <div data-shareout-tab="revenue" data-shareout-tab-title="Revenue">
      <!-- Revenue chart -->
    </div>
    <div data-shareout-tab="users" data-shareout-tab-title="Users">
      <!-- Users chart -->
    </div>
  </div>
</section>
```

## Navigation

### Navigation Container

```html
<nav data-shareout-nav="main"
     data-shareout-nav-title="Main Navigation">

  <a data-shareout-link="page:dashboard"
     data-shareout-link-display="Dashboard Link">
    Dashboard
  </a>

  <a data-shareout-link="page:tasks"
     data-shareout-link-display="Tasks Link">
    Tasks
  </a>

  <a data-shareout-link="page:settings"
     data-shareout-link-display="Settings Link">
    Settings
  </a>

</nav>
```

### Link Types

| Type | Syntax | Description |
|------|--------|-------------|
| Page link | `page:PAGE_ID` | Navigate to page |
| Section link | `section:SECTION_ID` | Scroll to section |
| Tab link | `tab:TAB_GROUP:TAB_ID` | Activate tab |
| External | `external:URL` | Open external URL |
| Modal | `modal:MODAL_ID` | Open modal |

### Active State

```html
<a data-shareout-link="page:dashboard"
   data-shareout-link-active-class="nav-active"
   data-shareout-link-display="Dashboard">
  Dashboard
</a>
```

### Page Transitions

```html
<main data-shareout-page="dashboard"
      data-shareout-page-title="Dashboard"
      data-shareout-transition="fade"
      data-shareout-transition-duration="200">
  <!-- Page content -->
</main>
```

| Transition | Description |
|------------|-------------|
| `none` | Instant switch |
| `fade` | Fade in/out |
| `slide-left` | Slide from right |
| `slide-right` | Slide from left |
| `slide-up` | Slide from bottom |
| `slide-down` | Slide from top |
| `zoom` | Scale in/out |

### Breadcrumb Navigation

```html
<nav data-shareout-breadcrumb="true"
     data-shareout-breadcrumb-display="Page Breadcrumb">

  <a data-shareout-link="page:home">Home</a>
  <span class="separator">/</span>
  <a data-shareout-link="page:products">Products</a>
  <span class="separator">/</span>
  <span data-shareout-breadcrumb-current>Product Details</span>

</nav>
```

### Deep Link Support

```html
<section id="pricing"
         data-shareout-section="pricing"
         data-shareout-section-title="Pricing"
         data-shareout-deeplink="true"
         data-shareout-deeplink-display="Pricing Section">
  <!-- Shareable as #pricing -->
</section>
```

## Validation Checklist

Full compliance checklist: [overview.md](overview.md#compliance-checklist). Page/section/tab/navigation-specific checks:

### Pages
- [ ] All pages have `data-shareout-page-title` for display

### Sections
- [ ] Sections have `data-shareout-section-title`
- [ ] Containers whose children should be rearranged in the editor have `data-shareout-sortable` (`="x"` for rows)

### Tabs
- [ ] Each tab has `data-shareout-tab-title`

### Navigation
- [ ] Navigation containers have `data-shareout-nav` identifier
- [ ] Links use `data-shareout-link` instead of raw `href`
- [ ] Link targets match declared pages, sections, or modals
- [ ] Active class specified via `data-shareout-link-active-class`
- [ ] Deep-linkable sections have `data-shareout-deeplink="true"`

## Related

- [Overview](overview.md) - Quick reference
- [Bindings](bindings.md) - Data bindings within pages
