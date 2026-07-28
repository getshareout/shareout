# Blueprint — start from a known-good skeleton

Never start from a blank file. Start from a skeleton that already follows [stack.md](stack.md): correct manifest, design-system styling, declarative bindings, guarded SDK init, and all four states stubbed. Then fill in the specifics. This kills the "built from scratch → broken bindings + SDK errors" failure.

Pick the base, or an archetype that matches the *why* from [discovery.md](discovery.md).

## Recommended file layout

Publish clean, separated files (see [stack.md](stack.md#file-shape--single-file-or-multi-file)). All internal references **relative** so they resolve under `/a/{slug}/` when published:

```text
index.html    structure + manifest + SDK + links to styles.css/app.js
styles.css    token overrides + custom CSS
app.js        SDK init + behavior
assets/       images, fonts, media
```

In the `/v1/publish` payload that's a `files` array with `entrypoint: "index.html"`:

```json
{ "name": "My Artifact", "entrypoint": "index.html",
  "files": [
    { "path": "index.html", "mime": "text/html", "content": "…" },
    { "path": "styles.css", "mime": "text/css", "content": "…" },
    { "path": "app.js",     "mime": "application/javascript", "content": "…" },
    { "path": "assets/logo.png", "mime": "image/png", "encoding": "base64", "content": "…" }
  ] }
```

## Base skeleton — three files

A complete, editor-ready, moderation-safe starting point, split per best practice. All links between files are **relative** so they resolve under `/a/{slug}/` once published.

**`index.html`** — structure, manifest, SDK, relative links to the sibling files:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My Artifact</title>
  <meta name="description" content="One-line description for sharing.">

  <!-- 1. Manifest FIRST: declare every store you use, with default sample data -->
  <script type="shareout/manifest">
  { "version": "2.0", "sources": { "json": { "state": { "default": { "ready": true } } } } }
  </script>

  <!-- 2. Design system + SDK (absolute URLs to $ORIGIN_HOST are correct here) -->
  <link rel="stylesheet" href="$ORIGIN/sdk/shareout.css">
  <script src="$ORIGIN/sdk/shareout-ui.js" defer></script>
  <script src="$ORIGIN/sdk/shareout.js"></script>

  <!-- 3. Your styles — RELATIVE sibling, served at /a/{slug}/styles.css -->
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <main class="so-container">
    <!-- LOADING: visible immediately, replaced once ready -->
    <div id="loading" class="so-stack" aria-busy="true">
      <div class="ph" style="height:2rem;width:40%"></div>
      <div class="ph" style="height:8rem"></div>
    </div>

    <!-- READY: the real content -->
    <section id="content" hidden class="so-stack">
      <h1 class="reveal">My Artifact</h1>
      <p class="reveal muted">Replace with real content.</p>
      <!-- EMPTY state, shown when there's nothing to list -->
      <div id="empty" hidden class="so-empty">
        <div class="so-empty-title">Nothing here yet</div>
        <p class="so-empty-text">Here's how to start: …</p>
      </div>
    </section>

    <!-- ERROR: inline, specific, never a blank page -->
    <div id="error" hidden class="so-card" role="alert">
      <p>Couldn't load this. <button class="so-btn so-btn-ghost" onclick="location.reload()">Retry</button></p>
    </div>
  </main>

  <script src="app.js"></script>   <!-- RELATIVE sibling, not external CDN -->
</body>
</html>
```

**`styles.css`** — token overrides + custom CSS (no hardcoded hex; retheme `--so-*`):

```css
:root { /* --so-color-primary: #...; override tokens for a custom look */ }
.muted { color: var(--so-color-text-secondary); }
.ph { border-radius: var(--so-radius-md); background: var(--so-color-border); }
@media (prefers-reduced-motion: no-preference) {
  .reveal { animation: rise .5s both; }
  .reveal:nth-child(2) { animation-delay: .06s; }
  .reveal:nth-child(3) { animation-delay: .12s; }
}
@keyframes rise { from { opacity: 0; transform: translateY(8px); } }
```

**`app.js`** — guarded SDK init + behavior:

```js
(async () => {
  const show = (id) => {
    for (const el of ['loading','content','error']) {
      document.getElementById(el).hidden = (el !== id);
    }
  };
  try {
    const sdk = await ShareOut.create();   // awaited: Bearer token ready
    // ...read/write via SDK only for logic; paint data via data-shareout-binding...
    show('content');
    await sdk.ready?.();                    // signal first paint complete
  } catch (err) {
    console.error(err);
    show('error');                         // graceful fallback, page never blanks
  }
})();
```

Why each piece matters: relative links keep it working under `/a/{slug}/` after publish ([stack.md](stack.md#relative-paths-only--or-publishing-breaks)); manifest-first + per-store `default` keep the visual editor and preview working ([../core/html-spec/manifest.md](../core/html-spec/manifest.md)); `await ShareOut.create()` + try/catch prevents the blank-page-on-reject bug ([stack.md](stack.md#sdk-correctness-do-this-not-that)); the four states are stubbed so you can't forget them. For a trivial throwaway you may inline `styles.css`/`app.js` back into `index.html` — but separated is the default.

## Archetype: dashboard / report

For daily monitoring and deliverables. Data via bindings and the chart attribute — not imperative DOM. Declare the table (and any connection) in the manifest with `default` rows.

```html
<!-- KPI row: aggregate bindings, no JS -->
<div class="so-grid so-grid-3">
  <div class="so-kpi"><span class="so-kpi-label">Orders</span>
    <span class="so-kpi-value" data-shareout-binding="table:orders:count:id">0</span></div>
  <div class="so-kpi"><span class="so-kpi-label">Revenue</span>
    <span class="so-kpi-value" data-shareout-binding="table:orders:sum:amount"
          data-shareout-format="currency">$0</span></div>
  <div class="so-kpi"><span class="so-kpi-label">Avg order</span>
    <span class="so-kpi-value" data-shareout-binding="table:orders:avg:amount"
          data-shareout-format="currency">$0</span></div>
</div>

<!-- Chart: declarative. Use SVG (Plotly) if this is delivered by screenshot -->
<div data-shareout-chart='{"type":"line","title":"Revenue trend"}'
     data-shareout-chart-data="table:orders"
     data-shareout-chart-x="date" data-shareout-chart-y="amount"></div>
```

Avoid the three-equal-cards trap — vary the layout. Deeper patterns: [../patterns/dashboards.md](../patterns/dashboards.md), [../modules/dashboards/overview.md](../modules/dashboards/overview.md). Chart/screenshot rule: [stack.md](stack.md#charts).

## Archetype: form / collection

For internal tools and viewer submissions. Writes go to `sdk.table()`; the list re-renders via a template binding, not innerHTML.

```html
<form id="entry" class="so-stack">
  <div class="so-field">
    <label class="so-label" for="name">Name</label>
    <input class="so-input" id="name" name="name" required>
  </div>
  <button class="so-btn so-btn-primary" type="submit">Add</button>
</form>

<!-- Submissions render declaratively from the table -->
<ul data-shareout-template="rows" data-shareout-template-source="table:entries">
  <li data-shareout-template-item>
    <span data-shareout-binding="table:entries:row:$id:name"></span>
  </li>
</ul>

<script>
  document.getElementById('entry').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await sdk.table('entries').insert({ name: e.target.name.value });
      e.target.reset();
      ShareOutUI.toast('Added');
    } catch (err) { ShareOutUI.toast('Could not save', { type: 'error' }); }
  });
</script>
```

Label above input, errors inline, never `alert()`. Deeper: [../patterns/forms.md](../patterns/forms.md), [../sdk/table.md](../sdk/table.md).

## Archetype: client presentation

For pitches and proposals — high craft, narrative flow. Two routes:

- **Native slides module** (presenter mode, viewer analytics, tracked links): [../modules/slides/overview.md](../modules/slides/overview.md).
- **Bespoke single-page deck** (full creative control): use the base skeleton with the bespoke elevated look from [design-choice.md](design-choice.md#3-bespoke-elevated-look) — committed aesthetic, oversized type, one idea per section, motivated motion.

## Before you publish

Run [pre-ship.md](pre-ship.md). Then publish — see [Publishing](../SKILL.md#publishing).

## Related

- [stack.md](stack.md) — the architecture these skeletons follow
- [design-choice.md](design-choice.md) — the visual layer
- [../core/html-spec/bindings.md](../core/html-spec/bindings.md) · [../core/html-spec/templates.md](../core/html-spec/templates.md) — binding & template syntax
- [../patterns/overview.md](../patterns/overview.md) — the full pattern library
