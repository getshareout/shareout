---
title: UI components overview
description: The so-c-* design system — brand fonts, tokens, and component classes for ShareOut artifacts with no custom CSS required.
---

ShareOut ships a stylesheet and a small behavior script that turn plain HTML into on-brand, accessible pages. Link the stylesheet, add `.so-` classes, and your artifact looks right without writing a single line of CSS.

## Load it

```html
<head>
  <link rel="stylesheet" href="https://shareout.site/sdk/shareout.css">
  <!-- only if you need toasts, modals, tabs, or dropdowns: -->
  <script src="https://shareout.site/sdk/shareout-ui.js" defer></script>
</head>
```

The stylesheet pulls in brand fonts (Satoshi, Source Sans 3, JetBrains Mono), design tokens as CSS custom properties, a classless base layer, and all component classes. The script exposes `window.ShareOutUI` for interactive components.

## The classless base layer

Once the stylesheet is linked, unstyled HTML already looks on-brand. Headings, body text, `code`, and links use the correct brand fonts and colors automatically. You add classes only for components.

```html
<body>
  <main class="so-container so-page">
    <h1>Quarterly Report</h1>
    <p>Plain markup is already styled.</p>
    <button class="so-btn so-btn-primary">Get started</button>
  </main>
</body>
```

## Use it with the live editor

The design system and the live editor are two separate layers on the same markup — you need both.

- **`.so-` classes** control how the artifact looks. The editor never strips external `<link>` or `<script>` tags, and classes survive every save round-trip.
- **`data-shareout-*` attributes** tell the editor what it can see and edit. A beautifully styled page with no manifest or bindings opens with empty panels and no outline.

Every artifact built with the design system must also follow the [HTML spec](/guides/html-spec/):

- `<script type="shareout/manifest">` in `<head>` declaring every data source.
- `data-shareout-page` on each page container.
- `data-shareout-binding` on every element that displays dynamic data — layer it onto the `.so-` element.

Editor-ready skeleton:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <script type="shareout/manifest">
  {
    "version": "2.0",
    "sources": {
      "json": { "revenue": { "default": 0 } }
    }
  }
  </script>

  <link rel="stylesheet" href="https://shareout.site/sdk/shareout.css">
  <script src="https://shareout.site/sdk/shareout-ui.js" defer></script>
  <script src="https://shareout.site/sdk/shareout.js"></script>
</head>
<body>
  <main class="so-container so-page"
        data-shareout-page="home"
        data-shareout-page-title="Home">
    <h1>Quarterly report</h1>

    <div class="so-grid so-grid-3">
      <div class="so-stat">
        <div class="so-stat-value"
             data-shareout-binding="json:revenue"
             data-shareout-format="currency">$0</div>
        <div class="so-stat-label">Revenue</div>
      </div>
    </div>

    <button class="so-btn so-btn-primary">Publish</button>
  </main>
</body>
</html>
```

## Design tokens

All tokens are CSS custom properties — prefer them over hardcoded values:

| Group | Examples |
|---|---|
| Color | `--so-color-primary`, `--so-color-bg`, `--so-color-text`, `--so-color-text-secondary`, `--so-color-border`, `--so-color-success`, `--so-color-warning`, `--so-color-error` |
| Spacing (8 px base) | `--so-space-1` … `--so-space-32` |
| Radius | `--so-radius-sm` (12 px) … `--so-radius-xl` (24 px), `--so-radius-full` |
| Typography | `--so-text-xs` … `--so-text-4xl`, `--so-font-display` / `-body` / `-mono`, `--so-weight-medium` / `-semibold` / `-bold` |
| Shadow | `--so-shadow-sm` … `--so-shadow-xl` |
| Charts | `--so-chart-1` … `--so-chart-8` (brand-safe series palette) |

## Rules

- **Do not invent CSS** for things the design system already covers — buttons, cards, inputs, badges, tables, stats, layout. Use `.so-` classes.
- **Do not use generic fonts** like Inter or Roboto, and do not use purple gradients or dark "AI" themes. The stylesheet ships the correct brand fonts and a warm, light palette.
- **Reference tokens, don't hardcode.** Use `var(--so-color-primary)` rather than raw hex values.
- **One primary action per screen.** Use `.so-btn-primary` once; everything else is `.so-btn-secondary` or `.so-btn-ghost`.

## When to use

Use the ShareOut design system for any HTML artifact by default. Only skip it when the user explicitly asks for a fully custom look — for instance, a customer portal that must match an external brand system.

## Next steps

- [Component & class reference](/ui/components/) — every `.so-` class with HTML examples, plus the `ShareOutUI` JavaScript API.
