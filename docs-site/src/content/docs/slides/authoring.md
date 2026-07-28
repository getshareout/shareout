---
title: Authoring decks
description: Layout helpers, themes, and bulk content creation for ShareOut Slides.
---

Slides stores raw HTML per slide — you have complete creative freedom. The helpers described here generate on-brand HTML snippets and full slide layouts; they don't restrict what you can write.

## Basic flow

```javascript
const presentation = await sdk.slides.open('my-deck');
await presentation.connect();

const slide = presentation.slides.add();
presentation.slides.setContent(slide.id, `
  <div style="display:flex;flex-direction:column;justify-content:center;
              align-items:center;height:100%;text-align:center;padding:48px">
    <h1 style="font-size:64px;font-weight:700">Q4 Results</h1>
    <p style="font-size:24px;color:var(--text-secondary);margin-top:16px">Annual Review 2026</p>
  </div>
`);
```

CSS variables (`--bg-primary`, `--text-primary`, `--text-secondary`, `--accent`) are injected from the presentation's `defaultColors` metadata, so slides restyle automatically when you change the theme.

## Themes

Set presentation-level defaults that cascade to every slide:

```javascript
presentation.meta.set({
  dimensions: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  defaultFont: { heading: 'Inter', body: 'Inter', mono: 'JetBrains Mono' },
  defaultColors: { background: '#0f172a', text: '#f8fafc', accent: '#3b82f6' },
});
```

Built-in theme presets:

| Name | Background | Accent | Best for |
| --- | --- | --- | --- |
| `dark-professional` | `#0f172a` | `#3b82f6` | Tech, investor decks |
| `light-minimal` | `#ffffff` | `#2563eb` | Formal, academic |
| `startup` | `#18181b` | `#f97316` | Pitch decks, demo days |
| `executive` | `#1a1a2e` | `#c9a227` | Board meetings, annual reviews |
| `technical` | `#1e1e2e` | `#89b4fa` | Developer talks, architecture |
| `creative` | `#0d0d0d` | `#ff3366` | Design portfolios, brand pitches |

Apply a preset by name when creating:

```javascript
await sdk.slides.create({ title: 'My Deck', theme: 'dark-professional', slides: [ /* … */ ] });
```

Or apply to an open presentation:

```javascript
presentation.meta.set({
  defaultFont: { heading: 'Playfair Display', body: 'Source Sans Pro', mono: 'Source Code Pro' },
  defaultColors: { background: '#1a1a2e', text: '#eaeaea', accent: '#c9a227' },
});
```

A slide can override any cascading property without affecting others:

```javascript
presentation.slides.update('slide-5', {
  overrides: {
    background: '#ffffff',
    font: { heading: 'Playfair Display' },
  },
});
```

## Layout helpers

`sdk.slides.helpers` returns HTML strings. Use them as-is or compose them with your own markup.

### Content fragments

```typescript
helpers.textBlock(content: string, style?: TextStyle): string
helpers.image(blobId: string, options?: ImageOptions): string
helpers.codeBlock(code: string, language: string): string
helpers.chart(config: ChartConfig): string
helpers.embed(url: string, options?: EmbedOptions): string
helpers.video(blobId: string, options?: VideoOptions): string
```

Example:

```javascript
const img = sdk.slides.helpers.image(blobId, {
  width: '60%',
  align: 'center',
  caption: 'Q4 revenue by region',
});
presentation.slides.setContent(slide.id, img);
```

### Full-slide layout helpers

Layout helpers return a complete positioned slide body. Each accepts a slots object — you never write flex or grid for common patterns.

```typescript
helpers.layout.title({ title, subtitle?, eyebrow?, logo? }): string
helpers.layout.section({ number?, title, subtitle? }): string
helpers.layout.titleContent({ title, body }): string
helpers.layout.twoCol({ title?, left, right }): string
helpers.layout.imageText({ image, title, body, side?: 'left' | 'right' }): string
helpers.layout.fullImage({ src, caption? }): string
helpers.layout.bigStat({ value, label, context? }): string
helpers.layout.quote({ text, author?, role? }): string
helpers.layout.cards({ title?, cards: { icon?, title, body }[] }): string
helpers.layout.chart({ title?, chart, insight? }): string
helpers.layout.blank(html: string): string
```

Slots accept plain text or nested helper HTML:

```javascript
presentation.slides.setContent(slide.id,
  sdk.slides.helpers.layout.titleContent({
    title: 'Key Findings',
    body: sdk.slides.helpers.textBlock('Revenue up 47% year-over-year.'),
  })
);
```

## Create with content

Pass slides directly to `sdk.slides.create()` to create a full deck in one call:

```javascript
const result = await sdk.slides.create({
  title: 'Q4 Review',
  theme: 'dark-professional',
  slides: [
    { layout: 'title',   title: 'Q4 Review', subtitle: '2026' },
    { layout: 'bigStat', value: '+47%', label: 'YoY growth' },
    { layout: 'cards',   cards: [
      { title: 'Revenue', body: '$4.2M ARR' },
      { title: 'Customers', body: '1,200 active' },
      { title: 'NPS', body: '72' },
    ]},
    { html: '<div class="custom">Custom slide</div>' },  // escape hatch
  ],
});
```

Each item in `slides` is a `SlideSpec`:

```typescript
type SlideSpec =
  | { layout: string; [slot: string]: unknown; notes?: string; hidden?: boolean }
  | { html: string; notes?: string; hidden?: boolean }
```

The SDK resolves `layout` to the corresponding `helpers.layout.*` call before writing content, so the server always receives HTML.

## Bulk operations on open presentations

```typescript
p.slides.addMany(slides: SlideSpec[]): Promise<Slide[]>
p.slides.replaceAll(slides: SlideSpec[]): Promise<Slide[]>
```

Both use the batch endpoint (`POST /data/slides/{id}/slides/batch`) — a single atomic write regardless of how many slides are provided.

```javascript
await presentation.slides.replaceAll([
  { layout: 'title', title: 'Refreshed Deck' },
  { layout: 'titleContent', title: 'Agenda', body: '...' },
]);
```

## Markdown input

Convert a Markdown outline to slide specs:

```javascript
const specs = sdk.slides.helpers.fromMarkdown(`
# Q4 Review

## Revenue
- $4.2M ARR
- Up 47% YoY

## Customers
- 1,200 active accounts
`);

await sdk.slides.create({ title: 'Q4 Review', slides: specs });
```

The transform splits on `---` or top-level headings, maps `#` to `title` layout and `##` to `titleContent`.

## AI generation

Generate a full deck from a prompt — slide layout, copy, and structure are produced by the server LLM:

```javascript
const result = await sdk.slides.generate({
  prompt: 'Investor pitch for a B2B SaaS company focused on supply chain visibility',
  theme: 'dark-professional',
  length: 12,  // target slide count (optional)
});
// Returns the same CreateResult as sdk.slides.create()
```

Returns 503 if no AI provider is configured, 502 if the model emits invalid output.

## Per-slide AI

Refine individual slides after the deck is created:

```javascript
// Rewrite slide content based on an instruction
await presentation.slides.rewrite('slide-3', 'Make it more concise — two bullet points max');

// Expand content
await presentation.slides.expand('slide-5', 'Add a comparison table');

// Generate speaker notes for a slide
const notes = await presentation.slides.generateNotes('slide-2');

// Get layout suggestions (read-only, does not apply changes)
const suggestion = await presentation.slides.suggestLayout('slide-4');
```

## Transactions and undo

Group multiple changes into one undo step:

```javascript
presentation.transact(() => {
  const slide = presentation.slides.add();
  presentation.slides.setContent(slide.id, '<h1>Title</h1>');
  presentation.speakerNotes.set(slide.id, 'Notes here');
});
// All three changes = 1 undo step

presentation.undo.undo();
presentation.undo.redo();
```

## Speaker notes

Notes are stored as Y.Text — collaborative and Markdown-rendered in the speaker view:

```javascript
presentation.speakerNotes.set('slide-1', `
# Key Points
- Revenue up 15%
- New customers: 1,200
- Mention Q3 comparison
`);

// Observe notes as collaborators edit them
const notes = presentation.speakerNotes.get('slide-3');
notes.observe(() => renderMarkdown(notes.toString()));
```
