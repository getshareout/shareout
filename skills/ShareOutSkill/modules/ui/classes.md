# ShareOut UI — class reference

All classes are namespaced `so-`. Load `$ORIGIN/sdk/shareout.css` first. See [overview.md](overview.md).

> **Editor:** `.so-` classes are styling only. For the live editor, also add `data-shareout-page` to page containers and `data-shareout-binding` to any element showing dynamic data — they layer onto the same element. See [overview.md → Works with the live editor](overview.md#works-with-the-live-editor).

## Layout

```html
<div class="so-container">…</div>          <!-- centered, max 1080px -->
<div class="so-container so-container-narrow">…</div>  <!-- 640px -->
<div class="so-container so-container-wide">…</div>    <!-- 1280px -->

<main class="so-page" data-shareout-page="home" data-shareout-page-title="Home">…</main>  <!-- page padding + editor outline -->
<section class="so-section">…</section>     <!-- section spacing + divider -->

<div class="so-stack">…</div>              <!-- vertical flex, gap -->
<div class="so-row">…</div>                <!-- horizontal flex, centered -->
<div class="so-row-between">…</div>         <!-- space-between row -->

<div class="so-grid">…</div>               <!-- responsive auto-fit grid -->
<div class="so-grid so-grid-3">…</div>      <!-- fixed 2/3/4 cols (1 col on mobile) -->

<header class="so-header">
  <span class="so-header-title">My App</span>
  <button class="so-btn so-btn-primary">Publish</button>
</header>

<div class="so-empty">
  <div class="so-empty-title">No pages yet</div>
  <p class="so-empty-text">Create your first page to share.</p>
  <button class="so-btn so-btn-primary">Create page</button>
</div>
```

## Buttons

```html
<button class="so-btn so-btn-primary">Primary action</button>
<button class="so-btn so-btn-secondary">Secondary</button>
<button class="so-btn so-btn-ghost">Tertiary</button>
<button class="so-btn so-btn-icon" aria-label="Settings">⚙️</button>
<button class="so-btn so-btn-primary" disabled>Disabled</button>
```

Rule: icon + label for important actions; use `.so-btn-icon` only for minor controls (with `aria-label`).

## Inputs

```html
<div class="so-field">
  <label class="so-label" for="name">Your name</label>
  <input class="so-input" id="name" type="text" placeholder="Jane Smith">
  <span class="so-hint">This appears on your public page</span>
</div>

<div class="so-field">
  <label class="so-label" for="msg">Message</label>
  <textarea class="so-textarea" id="msg"></textarea>
</div>

<select class="so-select"><option>Option</option></select>

<!-- error state -->
<input class="so-input so-error" value="bad@">
<span class="so-error-message">Enter a valid email</span>
```

## Cards

```html
<div class="so-card">
  <h3 class="so-card-title">Revenue</h3>
  <p>Card content.</p>
</div>

<!-- clickable card with hover lift -->
<a class="so-card so-card-interactive" href="…">
  <h3 class="so-card-title">Open report →</h3>
</a>
```

## Badges

```html
<span class="so-badge">Default</span>
<span class="so-badge so-badge-primary">New</span>
<span class="so-badge so-badge-success">Live</span>
<span class="so-badge so-badge-warning">Draft</span>
<span class="so-badge so-badge-error">Failed</span>
```

## Tables

```html
<table class="so-table">
  <thead><tr><th>Name</th><th>Status</th></tr></thead>
  <tbody>
    <tr><td>Report A</td><td><span class="so-badge so-badge-success">Live</span></td></tr>
  </tbody>
</table>
```

## Stats & KPIs

```html
<div class="so-grid so-grid-3">
  <div class="so-stat">
    <!-- bind dynamic values so the editor tracks them -->
    <div class="so-stat-value" data-shareout-binding="json:totalViews">1,284</div>
    <div class="so-stat-label">Total views</div>
  </div>
</div>

<div class="so-kpi">
  <div class="so-kpi-label">Revenue</div>
  <div class="so-kpi-value" data-shareout-binding="json:revenue" data-shareout-format="currency">$12,480</div>
  <div class="so-kpi-delta so-up">▲ 12% vs last month</div>
</div>
```

## Interactive (markup styled here, behavior in shareout-ui.js)

```html
<!-- Tabs: auto-initialized. Uses the editor's spec attributes so the same markup
     drives the visual tabs AND shows up in the editor outline.
     Button declares the tab (data-shareout-tab + title); panel id matches it. -->
<div data-shareout-tabs="views">
  <div class="so-tabs">
    <button class="so-tab so-active" data-shareout-tab="t1" data-shareout-tab-title="Overview" aria-controls="t1">Overview</button>
    <button class="so-tab" data-shareout-tab="t2" data-shareout-tab-title="Details" aria-controls="t2">Details</button>
  </div>
  <div class="so-tab-panel" id="t1">Overview content</div>
  <div class="so-tab-panel" id="t2" hidden>Details content</div>
</div>

<!-- Dropdown: auto-initialized -->
<div class="so-dropdown">
  <button class="so-btn so-btn-secondary" data-so-toggle>Menu ▾</button>
  <div class="so-dropdown-menu">
    <button class="so-dropdown-item">Edit</button>
    <button class="so-dropdown-item">Delete</button>
  </div>
</div>
```

Toasts and modals are created from JS — see [components.md](components.md).
