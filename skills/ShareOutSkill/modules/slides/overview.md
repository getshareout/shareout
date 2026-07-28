# ShareOut Slides

Collaborative presentations with real-time editing, presenter mode, and version history. A complete slide deck solution built on ShareOut's infrastructure.

## Why ShareOut Slides?

| Feature | ShareOut Slides | Traditional Tools |
|---------|----------------|-------------------|
| Real-time collaboration | Y.js CRDT - conflict-free | Lock-based or last-write-wins |
| Presenter mode | Speaker view + audience sync | Single view only |
| Version history | Named versions + auto-save + diff | Manual saves |
| Creative freedom | Raw HTML canvas | Template-locked |
| Permissions | Per-slide ownership | Document-level only |
| Publishing | Dual URLs (editor + shareable) | Export required |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ShareOut Slides                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐          ┌─────────────────┐          │
│  │   Editor Mode   │  sync    │ Published Mode  │          │
│  │ $ORIGIN_HOST/a │ ───────► │ $ORIGIN_HOST/p │          │
│  │  (auth required)│          │  (shareable)    │          │
│  └────────┬────────┘          └────────┬────────┘          │
│           │                            │                    │
│           ▼                            ▼                    │
│  ┌─────────────────────────────────────────────────┐       │
│  │              Y.js Realtime Document              │       │
│  │  • Slides (free-form HTML)                       │       │
│  │  • Metadata (cascading properties)               │       │
│  │  • Speaker notes                                 │       │
│  │  • Presentation state                            │       │
│  └─────────────────────────────────────────────────┘       │
│                                                             │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Presence │ │ Versions │ │  Blobs   │ │ Comments │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Core Concepts

### Slides as Free-Form HTML Canvas

Each slide stores raw HTML - complete creative freedom. No restrictive element system.

```javascript
// You control the HTML
presentation.slides.setContent('slide-1', `
  <div class="title-slide">
    <h1>Q4 Results</h1>
    <p class="subtitle">Annual Review 2026</p>
    <canvas id="chart"></canvas>
  </div>
`);
```

Optional helpers generate HTML snippets but don't limit you:

```javascript
const img = sdk.slides.helpers.image(blobId, { width: '50%' });
const code = sdk.slides.helpers.codeBlock(snippet, 'typescript');
```

### Editor vs Published Mode

Every presentation has two URLs:

| Mode | URL | Purpose |
|------|-----|---------|
| **Editor** | `$ORIGIN_HOST/a/{slug}` | Authenticated editing, collaboration |
| **Published** | `$ORIGIN_HOST/p/{slug}` | Shareable link, read-only, presentation |

Changes in editor sync to published in real-time.

### Cascading Metadata

Presentation-level properties cascade to all slides:

```javascript
presentation.meta.set({
  dimensions: { width: 1920, height: 1080 },
  aspectRatio: '16:9',
  defaultFont: {
    heading: 'Inter',
    body: 'Inter',
    mono: 'JetBrains Mono'
  },
  defaultColors: {
    background: '#0f172a',
    text: '#f8fafc',
    accent: '#3b82f6'
  }
});
```

Slides inherit these unless they override:

```javascript
// This slide uses different colors
presentation.slides.update('slide-5', {
  overrides: {
    background: '#ffffff',
    font: { heading: 'Playfair Display' }
  }
});
```

### Per-Slide Ownership

Optional ownership for specific slides:

```javascript
// Alice owns this slide - only she (or presentation owner) can edit
presentation.slides.setOwner('slide-3', 'alice-user-id');
presentation.slides.lock('slide-3');
```

Useful for: assigned sections, review workflows, protected content.

## Quick Start

### Create a Presentation

```javascript
const sdk = new ShareOut();

const result = await sdk.slides.create({
  title: 'Q4 Review',
  visibility: 'public'
});

console.log(result.editorUrl);    // $ORIGIN_HOST/a/q4-review
console.log(result.publishedUrl); // $ORIGIN_HOST/p/q4-review
```

### Open and Edit

```javascript
const presentation = await sdk.slides.open('q4-review');
await presentation.connect();

// Add a slide
const slide = presentation.slides.add();
presentation.slides.setContent(slide.id, '<h1>Hello World</h1>');

// Observe changes from collaborators
presentation.slides.observe(slides => {
  renderSlideList(slides);
});
```

### Start Presenting

```javascript
// Start presenter mode
await presentation.presenter.start({
  fromSlide: 0,
  countdown: 1800  // 30 minute countdown
});

// Navigate
presentation.presenter.next();
presentation.presenter.goToSlide(5);

// Use laser pointer
presentation.presenter.laser.enable();
presentation.presenter.laser.move(0.5, 0.3);  // Normalized coordinates
```

### Manage Versions

```javascript
// Create named version
await presentation.versions.create('Final Draft', 'Ready for review');

// Restore previous version
const versions = await presentation.versions.list();
await presentation.versions.restore(versions[2].id);
```

## Use Cases

| Scenario | Key Features |
|----------|--------------|
| **Team presentations** | Real-time collab, per-slide ownership, version history |
| **Sales decks** | Published URL for sharing, Teams analytics |
| **Training materials** | Speaker notes, timer, presenter mode |
| **Interactive content** | Free-form HTML, embed anything |
| **Design portfolios** | Full creative control, custom layouts |

## Reference Docs

| Topic | File |
|-------|------|
| SDK API | [sdk-api.md](sdk-api.md) |
| Data Model | [data-model.md](data-model.md) |
| Presenter Mode | [presenter-mode.md](presenter-mode.md) |
| Version History | [versions.md](versions.md) |
| Permissions | [permissions.md](permissions.md) |
| Publishing | [publishing.md](publishing.md) |
| Design Guidelines | [design/README.md](design/README.md) |

## Integration with ShareOut SDK

Slides integrates with existing SDK features:

| SDK Feature | Slides Integration |
|------------|-------------------|
| `sdk.realtime()` | Underlying Y.js document |
| `sdk.blobs` | Media storage for images/videos |
| `sdk.comments` | Per-slide feedback (`contextId: 'slide-{id}'`) |
| `sdk.collaborators` | Presentation permissions |
| `sdk.json` | User preferences |
