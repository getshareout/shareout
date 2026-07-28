# SDK Authoring — Implementation Spec

Concrete API for §6 of [experience-roadmap.md](./experience-roadmap.md). Phase 1 is **pure SDK, no backend change** — it extends `SlideHelpers` and `slides.create()`. Phases 2–3 add endpoints.

## What exists today (baseline)

`SlideHelpers` ([slide-helpers.ts](../../../shareout-app/sdk/src/presentation/slide-helpers.ts)) returns HTML strings, all inline-styled, some already reading CSS vars (`var(--accent)`, `var(--text-secondary)`):

```
textBlock · heading(1-3) · bulletList · image · codeBlock
bigNumber · quote · twoColumn · centered
```

Authoring flow today:
```js
const { id } = await sdk.slides.create({ title: 'Q4' });   // meta only
const p = await sdk.slides.open(id);
const s = await p.slides.add();
await p.slides.setContent(s.id, sdk.slides.helpers.centered(
  sdk.slides.helpers.heading('Q4 Results') + sdk.slides.helpers.bigNumber('+47%', 'YoY growth')
));
```

Friction: one slide at a time; raw string concatenation; layouts mixed with content; no theme awareness beyond the few helpers that happen to use CSS vars.

---

## Phase 1 — layouts, components, create-with-content (no backend)

### 1a. Full-slide layout helpers

A *layout* helper returns a complete slide body (positioned), unlike the current content fragments. Each accepts a slots object so callers never write flex/grid.

```ts
helpers.layout.title({ title, subtitle?, eyebrow?, logo? }): string
helpers.layout.section({ number?, title, subtitle? }): string         // divider
helpers.layout.titleContent({ title, body }): string                  // most common
helpers.layout.twoCol({ title?, left, right }): string
helpers.layout.imageText({ image, title, body, side?: 'left'|'right' }): string
helpers.layout.fullImage({ src, caption? }): string
helpers.layout.bigStat({ value, label, context? }): string
helpers.layout.quote({ text, author?, role? }): string
helpers.layout.cards({ title?, cards: {icon?, title, body}[] }): string   // 2-4 up
helpers.layout.chart({ title?, chart, insight? }): string
helpers.layout.blank(html: string): string
```

Each maps to a pattern already documented in [design/](./design/), so output is on-brand by construction. Slots accept either plain text or nested helper HTML.

### 1b. Data components (not images)

```ts
helpers.chart(spec: { type: 'bar'|'line'|'pie'|'area', data: …, options? }): string
helpers.table(rows: string[][], opts?: { header?: boolean }): string
helpers.metric(value: string, label: string, delta?: { value: string, dir: 'up'|'down' }): string
helpers.icon(name: string, opts?: { size?: string, color?: string }): string
helpers.embed(url: string, opts?: { aspect?: string }): string        // iframe
helpers.video(src: string, opts?: { poster?, autoplay?, loop? }): string
```

`chart` renders a self-contained `<canvas>` + inline init (Chart.js-style payload) so it works in the sandboxed `/p/` iframe with no external build step. Decision needed: bundle a tiny chart renderer vs. emit SVG directly (SVG avoids a runtime dep — preferred).

### 1c. Theme-aware rendering

Today helpers hardcode some values (`#1e293b` in `codeBlock`, fixed `64px` in `heading`). Make every helper read from a theme so a deck restyles by swapping one object.

```ts
const helpers = sdk.slides.helpers.withTheme('dark-professional');
// or a custom theme object:
sdk.slides.helpers.withTheme({ colors, fonts, scale, radius })
```

Themes live in the SDK (seeded from [design/](./design/) templates) and emit CSS-var-based output, cascading from the presentation's existing `defaultColors`/`defaultFonts`. No DB change — `withTheme` just parameterizes the HTML generator. (The unused `template` column can later persist the chosen theme name.)

### 1d. Create-with-content + bulk ops

Collapse create-then-N-adds into one call. `create()` gains an optional `slides` field; the SDK fans it out to the existing `add`/`setContent` calls (or, better, a future batch endpoint — see Phase 2).

```ts
await sdk.slides.create({
  title: 'Q4 Review',
  theme: 'dark-professional',
  slides: [
    { layout: 'title',        title: 'Q4 Review', subtitle: '2026' },
    { layout: 'bigStat',      value: '+47%', label: 'YoY growth' },
    { layout: 'cards',        cards: [ … ] },
    { html: '<custom/>' },                       // escape hatch
  ],
});
```

Also expose on an open presentation:
```ts
p.slides.addMany(slides: SlideSpec[]): Promise<Slide[]>
p.slides.replaceAll(slides: SlideSpec[]): Promise<Slide[]>
```

A `SlideSpec` is `{ layout, ...slots }` or `{ html }`, plus optional `notes`, `background`, `transition`, `hidden`. The SDK resolves `layout` → `helpers.layout.*` before writing content, so the server stays unchanged (still stores HTML).

### 1e. Markdown / outline input

```ts
helpers.fromMarkdown(md: string): SlideSpec[]   // --- splits slides, # → title layout, etc.
sdk.slides.create({ title, fromMarkdown: md })
```

Pure client transform → `SlideSpec[]` → reuses 1d. Lowest-effort path to "type an outline, get a deck."

---

## Phase 2 — backend support (batch + export)

- **Batch slide write** — ✅ **implemented**: `POST /data/slides/{id}/slides/batch` with `{ slides: [{content, hidden?, notes?}], replace? }` inserts/replaces many slides + notes in one atomic D1 `batch()`. `addMany`/`replaceAll` now call it (was N+1). See [slides.ts](../../../shareout-app/src/data/slides/slides.ts) `batchSlides`.
- **Export endpoints** — ✅ **implemented**: `GET /data/slides/{id}/export?format=pdf` (whole deck) and `?format=png&slide={slideId}` (single slide). Renders slide HTML via the `BROWSER` binding (`@cloudflare/puppeteer`, `page.setContent` → `page.pdf`/`screenshot`), sized to the deck's dimensions/colors. SDK: `presentation.export(format, slideId?)` → `Blob`, `presentation.exportUrl(...)`. HTML builders are pure/unit-tested; returns 503 when `BROWSER` is unbound. See [export.ts](../../../shareout-app/src/data/slides/export.ts). PNG also unblocks navigator thumbnails ([experience-roadmap.md §1](./experience-roadmap.md)) and analytics ([b2b-expansion.md](./b2b-expansion.md)).

## Phase 3 — import + AI

- **AI deck generation** — ✅ **implemented**: `sdk.slides.generate({ prompt, theme, length?, ...meta })`. The worker endpoint `POST /data/slides/generate` ([generate.ts](../../../shareout-app/src/data/slides/generate.ts)) calls the existing build-agent LLM (`chat` + `getBuildConfig` from [agent/anthropic.ts](../../../shareout-app/src/data/agent/anthropic.ts)), prompts the model to emit a JSON outline in our layout vocabulary, **validates/sanitizes** (drops unknown layouts), and returns `{ title, slides }`. The SDK renders the outline with the chosen theme and creates the deck via `createDeck`. Design split: **AI on the server** (keys stay there), **rendering in the SDK** (helpers are the single source of truth). Returns 503 if no AI provider is configured, 502 on bad model output.
- **Markdown / JSON import** — ✅ via `helpers.fromMarkdown` (Phase 1) + `createDeck({ fromMarkdown })`, and JSON `SlideSpec[]` via `createDeck({ slides })` / `replaceAll`.
- **Per-slide AI** — ✅ **implemented**: `POST /data/slides/{id}/slides/{slideId}/ai` with `{ action, instruction? }` for `rewrite` / `expand` (apply new content), `generateNotes` (save + return notes), `suggestLayout` (read-only advice). SDK: `slides.rewrite/expand/generateNotes/suggestLayout`. See [slide-ai.ts](../../../shareout-app/src/data/slides/slide-ai.ts).
- **PPTX/PDF import — deliberate non-goal.** Parsing PowerPoint (zip + OOXML) or PDF in a Worker requires heavy bundled deps (zip/XML or pdf.js) and yields only low-fidelity text — PPTX's absolute-positioned shapes don't map onto our semantic layouts. The markdown / JSON-spec / AI-generate paths cover practical import needs without the dependency cost. Revisit only with concrete demand and a fidelity target.

---

## Build order & rationale

1. **1a + 1b + 1c** — layouts, components, themes. Pure additive helpers, fully testable in isolation, zero risk to existing API.
2. **1d + 1e** — create-with-content + markdown. Wraps 1a–1c; instantly makes agent/programmatic authoring one call.
3. **Phase 2 batch** — ✅ done (`addMany`/`replaceAll` are now single-request).
4. **Phase 3 AI generate + markdown import** — ✅ done. **Phase 2 export** (PDF/PNG) and **PPTX/PDF import** remain, each gated on a supporting endpoint.

Phase 1 ships value with no migration, no endpoint, no risk to the live `/p/` path — it's strictly new surface on `SlideHelpers` + an optional `create()` field.

## Open decisions

- **Chart rendering**: emit inline SVG (no runtime dep, preferred) vs. bundle a canvas charting lib.
- **Structured blocks?** — these helpers keep the raw-HTML model (max flexibility). If we ever want round-trip editing / reliable export / AI mutation of existing slides, a structured block model would help — but it's a bigger commitment. Recommend deferring until export (Phase 2) forces the question.
- **Theme source of truth** — SDK-embedded vs. fetched from the worker so themes update without an SDK rebuild.
