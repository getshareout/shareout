---
title: Pages, sections & navigation
description: Multi-page artifact structure using data-shareout-page, sections, tabs, and navigation links.
---

ShareOut artifacts can be single-page or multi-page SPAs. The structure is defined with
`data-shareout-*` attributes that the editor reads to build its outline panel and the SDK
reads to handle navigation.

## Hierarchy

```
data-shareout-page
└── data-shareout-section
    └── data-shareout-tabs
        └── data-shareout-tab
```

Tabs can also appear directly inside a page without an intermediate section.

## Pages

### Single page

```html
<main data-shareout-page="dashboard" data-shareout-page-title="Dashboard">
  <!-- content -->
</main>
```

### Multiple pages

Only the first page is visible by default. Hide others with the `hidden` attribute:

```html
<main data-shareout-page="dashboard" data-shareout-page-title="Dashboard">
  <!-- dashboard content -->
</main>

<main data-shareout-page="settings" data-shareout-page-title="Settings" hidden>
  <!-- settings content -->
</main>

<main data-shareout-page="reports" data-shareout-page-title="Reports" hidden>
  <!-- reports content -->
</main>
```

The SDK manages visibility when a `data-shareout-link` navigates between pages.

## Sections

Sections subdivide a page in the editor outline:

```html
<main data-shareout-page="dashboard" data-shareout-page-title="Dashboard">

  <section data-shareout-section="kpis" data-shareout-section-title="Key Metrics">
    <!-- KPI cards -->
  </section>

  <section data-shareout-section="charts" data-shareout-section-title="Analytics">
    <!-- charts -->
  </section>

  <section data-shareout-section="activity" data-shareout-section-title="Recent Activity">
    <!-- data table -->
  </section>

</main>
```

## Drag-to-reorder (visual editor)

Add `data-shareout-sortable` to any container whose direct children should be
drag-reorderable in the editor. The attribute changes the HTML order in the document;
items stay within their container.

```html
<!-- vertical stack -->
<section data-shareout-section="features" data-shareout-sortable>
  <div class="feature-card">...</div>
  <div class="feature-card">...</div>
</section>

<!-- horizontal row or grid -->
<div class="card-row" data-shareout-sortable="x">
  <div class="card">...</div>
  <div class="card">...</div>
</div>
```

| Value | Behavior |
|-------|----------|
| `data-shareout-sortable` | Reorder children vertically |
| `data-shareout-sortable="x"` | Reorder children horizontally |

## Tabs

```html
<div data-shareout-tabs="time-period">
  <div data-shareout-tab="daily" data-shareout-tab-title="Daily">
    <!-- daily content -->
  </div>
  <div data-shareout-tab="weekly" data-shareout-tab-title="Weekly">
    <!-- weekly content -->
  </div>
  <div data-shareout-tab="monthly" data-shareout-tab-title="Monthly">
    <!-- monthly content -->
  </div>
</div>
```

Tabs within a section:

```html
<section data-shareout-section="analytics" data-shareout-section-title="Analytics">
  <div data-shareout-tabs="chart-views">
    <div data-shareout-tab="revenue" data-shareout-tab-title="Revenue">...</div>
    <div data-shareout-tab="users"   data-shareout-tab-title="Users">...</div>
  </div>
</section>
```

## Navigation

Use `data-shareout-nav` on a container and `data-shareout-link` on each link. Do not use
raw `href` attributes for internal navigation — the SDK won't intercept them.

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

### Link types

| Type | Syntax | Description |
|------|--------|-------------|
| Page | `page:PAGE_ID` | Navigate to a page |
| Section | `section:SECTION_ID` | Scroll to a section |
| Tab | `tab:TAB_GROUP:TAB_ID` | Activate a tab |
| External | `external:URL` | Open an external URL |
| Modal | `modal:MODAL_ID` | Open a modal |

### Active state class

```html
<a data-shareout-link="page:dashboard"
   data-shareout-link-active-class="nav-active"
   data-shareout-link-display="Dashboard">
  Dashboard
</a>
```

### Page transitions

```html
<main data-shareout-page="dashboard"
      data-shareout-page-title="Dashboard"
      data-shareout-transition="fade"
      data-shareout-transition-duration="200">
  <!-- content -->
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

### Deep links

Sections can be bookmarked directly by adding `data-shareout-deeplink="true"`:

```html
<section id="pricing"
         data-shareout-section="pricing"
         data-shareout-section-title="Pricing"
         data-shareout-deeplink="true"
         data-shareout-deeplink-display="Pricing Section">
  <!-- shareable as #pricing -->
</section>
```

## Checklist

- At least one `data-shareout-page` element exists.
- Every page has `data-shareout-page-title`.
- Additional pages are hidden with the `hidden` attribute.
- Sections have both `data-shareout-section` and `data-shareout-section-title`.
- Containers with drag-reorderable children have `data-shareout-sortable`.
- Tabs are inside `data-shareout-tabs` containers with `data-shareout-tab-title` on each tab.
- Navigation uses `data-shareout-nav` and `data-shareout-link`.
- Link targets reference declared page, section, or tab IDs.

## Related

- [Overview](/spec/overview/) — full attribute reference and compliance checklist
- [Bindings](/spec/bindings/) — data bindings within pages and sections
- [Templates](/spec/templates/) — repeating content and charts within pages
