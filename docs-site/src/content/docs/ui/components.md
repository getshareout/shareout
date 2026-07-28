---
title: Components & class reference
description: Every so-* CSS class and the ShareOutUI JavaScript API for toasts, modals, tabs, dropdowns, and chart colors.
---

All classes are namespaced `so-`. Load `shareout.css` first. For interactive components (tabs, dropdowns, toasts, modals), also load `shareout-ui.js`.

```html
<link rel="stylesheet" href="https://shareout.site/sdk/shareout.css">
<script src="https://shareout.site/sdk/shareout-ui.js" defer></script>
```

See [UI overview](/ui/overview/) for the full design system context and editor integration rules.

---

## Layout

```html
<div class="so-container">…</div>                  <!-- centered, max 1080 px -->
<div class="so-container so-container-narrow">…</div>  <!-- 640 px -->
<div class="so-container so-container-wide">…</div>    <!-- 1280 px -->

<main class="so-page"
      data-shareout-page="home"
      data-shareout-page-title="Home">…</main>     <!-- page padding + editor outline -->
<section class="so-section">…</section>            <!-- section spacing + divider -->

<div class="so-stack">…</div>                      <!-- vertical flex, gap -->
<div class="so-row">…</div>                        <!-- horizontal flex, centered -->
<div class="so-row-between">…</div>                <!-- space-between row -->

<div class="so-grid">…</div>                       <!-- responsive auto-fit grid -->
<div class="so-grid so-grid-3">…</div>             <!-- fixed 2/3/4 cols, 1 col on mobile -->

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

---

## Buttons

```html
<button class="so-btn so-btn-primary">Primary action</button>
<button class="so-btn so-btn-secondary">Secondary</button>
<button class="so-btn so-btn-ghost">Tertiary</button>
<button class="so-btn so-btn-icon" aria-label="Settings">⚙️</button>
<button class="so-btn so-btn-primary" disabled>Disabled</button>
```

Use `.so-btn-icon` only for minor controls — always add `aria-label`. One `.so-btn-primary` per screen.

---

## Inputs

```html
<div class="so-field">
  <label class="so-label" for="name">Your name</label>
  <input class="so-input" id="name" type="text" placeholder="Jane Smith">
  <span class="so-hint">Appears on your public page</span>
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

---

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

---

## Badges

```html
<span class="so-badge">Default</span>
<span class="so-badge so-badge-primary">New</span>
<span class="so-badge so-badge-success">Live</span>
<span class="so-badge so-badge-warning">Draft</span>
<span class="so-badge so-badge-error">Failed</span>
```

---

## Tables

```html
<table class="so-table">
  <thead>
    <tr><th>Name</th><th>Status</th></tr>
  </thead>
  <tbody>
    <tr>
      <td>Report A</td>
      <td><span class="so-badge so-badge-success">Live</span></td>
    </tr>
  </tbody>
</table>
```

---

## Stats & KPIs

```html
<div class="so-grid so-grid-3">
  <div class="so-stat">
    <div class="so-stat-value"
         data-shareout-binding="json:totalViews">1,284</div>
    <div class="so-stat-label">Total views</div>
  </div>
</div>

<div class="so-kpi">
  <div class="so-kpi-label">Revenue</div>
  <div class="so-kpi-value"
       data-shareout-binding="json:revenue"
       data-shareout-format="currency">$12,480</div>
  <div class="so-kpi-delta so-up">▲ 12% vs last month</div>
</div>
```

Add `data-shareout-binding` so the editor's data panel tracks these values.

---

## Interactive markup (styled here, behavior in shareout-ui.js)

Tabs and dropdowns auto-initialize on page load. Use `data-so-*` for dropdowns/toasts/modals; use `data-shareout-*` for tabs (same attributes drive the editor outline).

### Tabs

```html
<div data-shareout-tabs="views">
  <div class="so-tabs">
    <button class="so-tab so-active"
            data-shareout-tab="t1"
            data-shareout-tab-title="Overview"
            aria-controls="t1">Overview</button>
    <button class="so-tab"
            data-shareout-tab="t2"
            data-shareout-tab-title="Details"
            aria-controls="t2">Details</button>
  </div>
  <div class="so-tab-panel" id="t1">Overview content</div>
  <div class="so-tab-panel" id="t2" hidden>Details content</div>
</div>
```

The `data-shareout-tab` attributes serve double duty: `shareout-ui.js` wires tab switching, and the editor uses the same attributes for the page outline.

### Dropdown

```html
<div class="so-dropdown">
  <button class="so-btn so-btn-secondary" data-so-toggle>Menu ▾</button>
  <div class="so-dropdown-menu">
    <button class="so-dropdown-item">Edit</button>
    <button class="so-dropdown-item">Delete</button>
  </div>
</div>
```

---

## ShareOutUI JavaScript API

Everything lives on `window.ShareOutUI`. No build step, no dependencies.

### Toast

```javascript
ShareOutUI.toast('Saved!');
ShareOutUI.toast('Could not save', { type: 'error' });
ShareOutUI.toast('Heads up', { type: 'warning', duration: 5000 });
```

Types: `success` | `warning` | `error`. Toasts stack bottom-center and auto-dismiss after 3 s.

### Modal

```javascript
ShareOutUI.modal(
  '<h3 class="so-card-title">Confirm</h3><p>Delete this page?</p>' +
  '<div class="so-row">' +
    '<button class="so-btn so-btn-secondary" onclick="ShareOutUI.closeModal()">Cancel</button>' +
    '<button class="so-btn so-btn-primary">Delete</button>' +
  '</div>'
);

ShareOutUI.closeModal(); // also closes on backdrop click or Escape
```

Pass an HTML string or a DOM node.

### Copy to clipboard

```javascript
const ok = await ShareOutUI.copy('https://shareout.site/a/my-page');
if (ok) ShareOutUI.toast('Link copied');
```

### Chart colors

Returns the brand-safe series palette (`--so-chart-1` … `8`) for any chart library:

```javascript
const colors = ShareOutUI.chartColors(); // ['#2563eb', '#16a34a', ...]

new Chart(ctx, {
  type: 'bar',
  data: { labels, datasets: [{ data, backgroundColor: colors }] }
});
```

### Re-initialize after dynamic DOM changes

```javascript
container.innerHTML = newMarkup;
ShareOutUI.init(container); // or ShareOutUI.init() for the whole document
```

Call this after injecting tabs or dropdowns via JavaScript.

### API summary

| Method | Purpose |
|---|---|
| `ShareOutUI.toast(msg, opts?)` | Transient notification |
| `ShareOutUI.modal(htmlOrNode)` | Open a modal dialog |
| `ShareOutUI.closeModal()` | Close the open modal |
| `ShareOutUI.copy(text)` | Copy to clipboard → `Promise<boolean>` |
| `ShareOutUI.chartColors()` | Brand chart palette → `string[]` |
| `ShareOutUI.init(root?)` | (Re)initialize tabs and dropdowns |
