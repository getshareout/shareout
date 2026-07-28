# The stack — ShareOut's killer combo

The fixed, opinionated architecture for every new artifact. It is state-of-the-art *and* survives the platform's constraints (sandboxed CDN serving, publish-time moderation). Do not improvise a different stack — improvising is where the broken layouts and SDK errors come from. Customers can override, but this is the base.

## The combo, in one line

**Modern vanilla CSS layered on ShareOut design tokens · CSS-first motion · data through ShareOut's declarative bindings · vanilla JS glue · the ShareOut SDK.** No build step. No framework. No Tailwind.

**Default to clean, separated files** — `index.html` for structure, `styles.css` for styling, `app.js` for behavior, `assets/` for media, extra `.html` for separate pages. Standard web best practices: separation of concerns, no giant monolith. ShareOut serves them all as first-class files (see [File shape](#file-shape--single-file-or-multi-file)). Collapse to a **single self-contained HTML file only for a trivial throwaway** (a one-off note, a tiny demo). Either way the rest of the combo is identical.

## What we deliberately do NOT use by default

| Rejected | Why |
| --- | --- |
| **Tailwind** | Needs a CDN runtime (heavy, slows first paint) or a build step; utility soup fights `--so-*` tokens. |
| **React / Vue / Svelte** | Build step; overkill for an artifact; bypasses the binding layer. |
| **GSAP / Lenis / Framer Motion (CDN)** | On a **public** page, external CDN `<script>` tags outside the safety allowlist are **blocked by the sandbox CSP** and publish moderation may **force-flag `visibility=private`**; plus bloat and slower paint. Opt-in only — see [Elevated motion](#elevated-motion-opt-in). |

> **External CDNs and visibility.** On **public** pages the sandbox CSP allows scripts/styles/fonts from a broad allowlist of reputable CDNs — jsDelivr, unpkg, cdnjs, esm.sh, Skypack, Google-hosted, the Tailwind Play CDN (`cdn.tailwindcss.com`), jQuery, D3, Plotly, Highcharts, DataTables, Bootstrap and more — which covers most libraries. A CDN **outside** that list is CSP-blocked on open pages, and trying to switch such a page to public is **refused server-side with a clear message**. **Private** pages have no limit: any https CDN loads. So for a niche or self-hosted CDN, keep the artifact **private** and add collaborators individually. The no-Tailwind default above is about output quality, not a safety block.

## File shape — single-file or multi-file

An artifact is published as a **`files` array**. `/v1/publish` takes `files: [{ path, content, mime, encoding }]` with an `entrypoint` (defaults to `index.html`). Each file is stored and **served at `/a/{slug}/{path}`**, same artifact origin. The manifest auto-tracks critical `css`/`js`/`fonts`.

**Recommended structure** — clean separation of concerns:

```text
index.html        entry: structure + manifest + SDK
styles.css        all styling (token overrides + custom CSS)
app.js            behavior / SDK glue
about.html        additional pages (optional)
assets/           images, fonts, media (optional)
```

Collapse to a single `index.html` only for a trivial throwaway.

### Relative paths only — or publishing breaks

Artifacts serve under the **`/a/{slug}/` prefix**, so **every internal reference must be relative** (`styles.css`, `./app.js`, `assets/logo.png`, `about.html`). An absolute path (`/styles.css`, `/app.js`) resolves to the domain root, **not** the artifact, and 404s once published. Same for in-app links between pages — link `about.html`, never `/about.html`. This is the #1 cause of "worked locally, broke when published."

```html
<!-- index.html -->
<head>
  <script type="shareout/manifest"> … </script>   <!-- first: declares all data sources -->
  <link rel="stylesheet" href="$ORIGIN/sdk/shareout.css">  <!-- absolute OK: the SDK origin -->
  <link rel="stylesheet" href="styles.css">         <!-- RELATIVE sibling → /a/{slug}/styles.css -->
  <script src="$ORIGIN/sdk/shareout-ui.js" defer></script>
  <script src="$ORIGIN/sdk/shareout.js"></script>
  <style> :root { /* customer layer: override --so-* tokens here */ } </style>
</head>
<body>
  <!-- semantic markup, .so- classes + your CSS grid, content visible immediately -->
  <img src="assets/logo.png" alt="Logo">           <!-- RELATIVE asset -->
  <a href="about.html">About</a>                    <!-- RELATIVE page link -->
  <script src="app.js"></script>                    <!-- RELATIVE local JS (not external CDN) -->
</body>
```

The only absolute URLs that belong in an artifact are the ShareOut SDK/CSS on `$ORIGIN_HOST` and any deliberately-external resource (with the moderation caveat below).

**Local sibling files are NOT external CDN scripts** — they load from the artifact's own origin, so splitting JS/CSS into local files does **not** trigger the CSP allowlist or the moderation private-flag (those apply only to *third-party CDN* `<script>` tags and oversized inline JSON, and only on public pages — see the visibility note above). Clean separation is both best practice and moderation-safe.

Put critical content in the entrypoint markup so first paint is instant (no blank screen — see [../patterns/performance.md](../patterns/performance.md)).

**Multi-file ≠ multi-page.** Two different things, both supported and composable:
- **Multi-page** = several views inside *one* document via `data-shareout-page` (drives the editor outline + in-artifact nav). See [../core/html-spec/pages.md](../core/html-spec/pages.md).
- **Multi-file** = several physical files in the `files` array, served at sub-paths. Use for separate stylesheets/scripts, true separate HTML pages, or assets.

Full skeletons: [blueprint.md](blueprint.md). Publish payload shape: [../api/artifacts.md](../api/artifacts.md).

## Assets & egress — where each file should live

ShareOut serves bytes directly and smartly from Cloudflare. Put each asset where it belongs:

- **Static app assets** (HTML, CSS, JS, icons, small bundled images/fonts) → ship them in the `files` array. They stream from the CDN, **edge-cached immutably keyed by content version** — a new publish automatically gets a fresh cache entry, so you never invalidate by hand. Best for everything that's part of the build.
- **Heavy or user-generated media** (large images, video, PDFs, downloads, datasets) → do **not** bake into `files[]`. Store them in `sdk.blobs` and fetch with `getDownloadUrl()`, which returns a **short-lived presigned URL straight from R2** (falls back to a Worker-proxied path when direct R2 isn't configured). This keeps the published bundle lean and serves big bytes direct from Cloudflare, with range-request support. See [../sdk/blobs.md](../sdk/blobs.md).

Rule of thumb: *part of the app → `files[]`; data or big/dynamic media → `sdk.blobs`.* Don't embed multi-MB media as base64 in HTML/JS — it bloats the bundle and risks the moderation inline-blob flag. Performance guidance: [../patterns/performance.md](../patterns/performance.md).

## CSS

Modern, token-first, no preprocessor:

- **Layer on the tokens.** Build with `.so-` classes and `--so-*` CSS variables (spacing, radius, shadow, color, fonts, chart palette). Override tokens in a `:root` block for a custom look — don't hardcode hex. See [../modules/ui/overview.md](../modules/ui/overview.md), [../modules/ui/classes.md](../modules/ui/classes.md).
- **CSS Grid for layout**, Flexbox for component internals. No percentage-math columns.
- **Modern features are fair game:** container queries, `:has()`, `clamp()` for fluid type, logical properties, `text-wrap: balance`. They ship in every modern browser and the sandbox is current.
- **No CSS-in-JS, no utility framework.** A scoped `<style>` block is the whole styling surface.

## Motion (CSS-first)

Folded from premium frontend practice, kept dependency-free:

- **One orchestrated entrance**, not scattered micro-animations. A single staggered load reveal (fade + small translate, ~400–600ms, gentle `animation-delay` stagger) reads as more polished than ten hover tricks.
- **Animate `transform` and `opacity` only.** Never `width`/`height`/`top`/`left`/`margin` — they trigger layout and jank.
- **Guard it:** wrap non-trivial motion in `@media (prefers-reduced-motion: no-preference)`; wrap hover-dependent effects in `@media (hover: hover) and (pointer: fine)`.
- Dense dashboards usually want **no** motion. Motion must be motivated — see [../modules/ui/taste.md](../modules/ui/taste.md#motion).

## JS reactivity (bindings-first)

This is the single biggest bug-killer. ShareOut already ships a validated declarative reactive layer — use it instead of hand-wiring the DOM.

**Decision tree:**

1. **Declarative bindings first.** Bind data to the DOM with `data-shareout-binding`, repeating content with `data-shareout-template`, charts with `data-shareout-chart`, and declare every source in the manifest. The runtime keeps them in sync. See [../core/html-spec/bindings.md](../core/html-spec/bindings.md) and [../core/html-spec/templates.md](../core/html-spec/templates.md).
2. **Vanilla JS for glue only** — event handlers, calling SDK writes, branching. Not for re-rendering data into the DOM.
3. **Alpine.js for genuinely complex interactive state** (multi-step wizards, heavy client-side filtering/derived UI). Load it from an **allowlisted CDN**: `<script src="https://cdn.jsdelivr.net/npm/alpinejs@3" defer></script>` (jsDelivr, unpkg, cdnjs all pass the sandbox CSP and publish fine on public). Do **not** paste Alpine's minified source inline — a single long minified line trips the publish-time obfuscation heuristic and can hold the artifact private.

The anti-pattern that causes most "SDK errors":

```html
<!-- WRONG: imperative, hidden from the editor, brittle -->
<span id="rev"></span>
<script>document.getElementById('rev').textContent = await sdk.json.get('metrics.revenue')</script>

<!-- RIGHT: declarative, editor-aware, auto-synced -->
<span data-shareout-binding="json:metrics.revenue" data-shareout-format="currency">$0</span>
```

## SDK correctness (do-this-not-that)

The quick card. Depth in [../sdk/overview.md](../sdk/overview.md).

- **Init with `await ShareOut.create()`**, not `new ShareOut()` — the awaited form readies the embedded Bearer token.
- **Prefer bindings over imperative reads.** Reach for `sdk.json.get` / `sdk.table().exec()` only for logic, not for painting data onto the page.
- **Declare every store in the manifest** before you use it — `sdk.json` keys, `sdk.table()` names, `sdk.connection()` names. An undeclared store is a common runtime failure and breaks editor preview. Manifest rules: [../core/html-spec/manifest.md](../core/html-spec/manifest.md).
- **Editor / preview mode does no network.** The visual editor resolves all reads (including connector queries) from `sources.*.default`. Give every source `default` sample data so a data-gated artifact still renders and stays editable.
- **Wrap data calls in try/catch** with a graceful fallback into the error state — never let a rejected promise blank the page.
- **Don't raw-`fetch` `/v1/data/...`.** Published HTML runs sandboxed on `{hex}.shareoutcdn.site`; use SDK methods. See [../sdk/live-data.md](../sdk/live-data.md).

## Charts

- **Interactive, view-only artifact:** `<canvas>` charting (e.g. Chart.js) is fine.
- **Delivered by screenshot** (Slack / PDF / thumbnail / email): use **SVG** charts (Plotly). Server-side capture renders `<canvas>` blank. If unsure whether it'll be screenshotted, default to SVG.

## Performance budget

- Instant first paint — critical content in the initial HTML, no spinner-only screen. See [../patterns/performance.md](../patterns/performance.md).
- `shareout-ui.js` loads `defer`; defer any other non-critical script.
- Keep the file lean; avoid large inline `<script type="application/json">` data blobs (they also risk a moderation private-flag) — load data via the SDK instead.

## Elevated motion (opt-in)

If the user explicitly wants scroll-driven storytelling or physics-grade motion (a marketing site, a showcase), heavier libraries (GSAP, Lenis) are allowed. Load them from an **allowlisted CDN** (cdnjs, jsDelivr, unpkg) — those hosts pass the sandbox CSP and publish fine on public. Do **not** inline their minified source (a long minified line trips the obfuscation heuristic → held private). Never reach for this by default — bloat and slower first paint.

## Related

- [blueprint.md](blueprint.md) — skeletons that already follow this stack
- [design-choice.md](design-choice.md) — the visual layer on top
- [pre-ship.md](pre-ship.md) — verify the stack rules before publish
- [../core/html-spec/overview.md](../core/html-spec/overview.md) — full HTML spec
- [../sdk/overview.md](../sdk/overview.md) — SDK reference
- [../patterns/performance.md](../patterns/performance.md) — instant first paint
