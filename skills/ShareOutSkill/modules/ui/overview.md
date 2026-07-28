# ShareOut UI — brand styling for artifacts

The ShareOut design system, served as a stylesheet + behavior layer. Link it and use `.so-` classes instead of writing CSS from scratch. Every artifact gets on-brand, accessible UI with almost no authored CSS.

## When to use

**Default for any HTML artifact.** Unless the user explicitly wants a custom look, link the ShareOut stylesheet and build with `.so-` classes. This keeps artifacts consistent with the ShareOut brand and saves you from hand-writing CSS.

> This file is the *mechanics* (how to load and use the system). For the *taste* — layout, hierarchy, color restraint, motion, and the anti-slop ban list that make an artifact look designed rather than auto-generated — read [taste.md](taste.md).

## Load it

```html
<head>
  <link rel="stylesheet" href="$ORIGIN/sdk/shareout.css">
  <!-- only if you need toasts / modals / tabs / dropdowns: -->
  <script src="$ORIGIN/sdk/shareout-ui.js" defer></script>
</head>
```

- One `<link>` pulls the brand fonts (Satoshi, Source Sans 3, JetBrains Mono), design tokens as CSS variables, a light base layer, and all component classes.
- The optional script exposes `window.ShareOutUI` for interactive components. See [components.md](components.md).

## The base layer is classless

Once the stylesheet is linked, plain HTML already looks on-brand — `body`, headings, `p`, `a`, `code` use brand fonts and colors. You only add classes for components (buttons, cards, inputs, etc.).

```html
<body>
  <main class="so-container so-page">
    <h1>Quarterly Report</h1>
    <p>Plain markup is already styled. Add classes for components.</p>
    <button class="so-btn so-btn-primary">Get started</button>
  </main>
</body>
```

## Works with the live editor

Styling and the live editor are **two separate layers on the same markup** — you need both:

- **`.so-` classes** = how it looks. Safe in the editor: the canvas never strips external `<link>`/`<script>` tags, and your classes/inline styles survive every save round-trip untouched.
- **`data-shareout-*` attributes** = what the editor can see and edit (data panel, outline, autocomplete). Styling alone gives the editor **nothing** to work with — a beautiful page with no manifest/bindings opens with empty panels and no outline.

So an artifact built with the design system must **also** follow the [HTML spec](../../core/html-spec/overview.md):

- `<script type="shareout/manifest">` in `<head>` declaring every `sdk.json` key and `sdk.table()` name
- `data-shareout-page` on each page container (outline navigation)
- `data-shareout-binding` on every element that shows dynamic data — layer it onto the `.so-` element, e.g. `<div class="so-stat-value" data-shareout-binding="json:revenue">$0</div>`

### Editor-ready skeleton (copy this)

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">

  <!-- 1. Manifest: declare data sources so the editor's data panel works -->
  <script type="shareout/manifest">
  {
    "version": "2.0",
    "sources": {
      "json": { "revenue": { "default": 0 } },
      "tables": { "pages": { "schema": [
        { "name": "id", "type": "string", "primary": true },
        { "name": "name", "type": "string" },
        { "name": "status", "type": "string" }
      ] } }
    }
  }
  </script>

  <!-- 2. Design system: brand styling + behavior -->
  <link rel="stylesheet" href="$ORIGIN/sdk/shareout.css">
  <script src="$ORIGIN/sdk/shareout-ui.js" defer></script>

  <!-- 3. Data SDK -->
  <script src="$ORIGIN/sdk/shareout.js"></script>
</head>
<body>
  <!-- data-shareout-page → editor outline; .so- classes → styling -->
  <main class="so-container so-page" data-shareout-page="home" data-shareout-page-title="Home">
    <h1>Quarterly report</h1>

    <div class="so-grid so-grid-3">
      <!-- styling AND a binding on the same element -->
      <div class="so-stat">
        <div class="so-stat-value" data-shareout-binding="json:revenue" data-shareout-format="currency">$0</div>
        <div class="so-stat-label">Revenue</div>
      </div>
    </div>

    <button class="so-btn so-btn-primary">Publish</button>
  </main>
</body>
</html>
```

> **Tabs use the spec attributes directly** — one markup serves both the visual tabs *and* the editor outline. Put `data-shareout-tabs` on the group and `data-shareout-tab` + `data-shareout-tab-title` on each `.so-tab` button; link each `.so-tab-panel` by matching `id`. `shareout-ui.js` wires the switching; the editor reads the same attributes for the outline. (Dropdowns/toasts/modals have no editor equivalent and use `data-so-*`.) Full markup in [classes.md](classes.md#interactive-markup-styled-here-behavior-in-shareout-uijs).

Full editor requirements and the compliance checklist: [core/html-spec/overview.md](../../core/html-spec/overview.md).

## Rules (important)

- **Do NOT invent CSS** for things the design system already covers (buttons, cards, inputs, badges, tables, stats, layout). Use the `.so-` classes — see [classes.md](classes.md).
- **Do NOT use generic fonts** like Inter or Roboto, and **do NOT use purple gradients or dark "AI" themes**. The stylesheet ships the correct brand fonts and a warm, light palette.
- **Reference tokens, don't hardcode.** If you need a custom value, use the CSS variables (`var(--so-color-primary)`, `var(--so-space-4)`, `var(--so-radius-md)`) rather than raw hex/px.
- **One primary action per screen.** Use `.so-btn-primary` once; everything else is `.so-btn-secondary` or `.so-btn-ghost`.

## Tokens available as CSS variables

| Group | Examples |
|-------|----------|
| Color | `--so-color-primary`, `--so-color-bg`, `--so-color-text`, `--so-color-text-secondary`, `--so-color-border`, `--so-color-success`/`-warning`/`-error` |
| Spacing (8px base) | `--so-space-1`…`--so-space-32` |
| Radius | `--so-radius-sm` (12px) … `--so-radius-xl` (24px), `--so-radius-full` |
| Type | `--so-text-xs`…`--so-text-4xl`, `--so-font-display`/`-body`/`-mono`, `--so-weight-medium`/`-semibold`/`-bold` |
| Shadow | `--so-shadow-sm`…`--so-shadow-xl` |
| Charts | `--so-chart-1`…`--so-chart-8` (brand-safe series palette) |

## Full reference

- [taste.md](taste.md) — design taste: restraint, hierarchy, motion, the anti-slop ban list, pre-ship checklist
- [classes.md](classes.md) — every component class with HTML examples
- [components.md](components.md) — `ShareOutUI` JavaScript API (toast, modal, tabs, dropdown, copy, chartColors)
