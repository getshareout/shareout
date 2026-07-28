# Data Model

ShareOut Slides uses a Y.js CRDT document for real-time collaboration. This document describes the structure.

## Document Overview

Single realtime document per presentation: `sdk.realtime('presentation-{id}')`

```
Y.Doc
├── meta (Y.Map)           → Presentation metadata, cascading properties
├── slides (Y.Array)       → Ordered slide list
├── slideContent (Y.Map)   → Slide HTML content keyed by slideId
├── speakerNotes (Y.Map)   → Speaker notes keyed by slideId
├── presentationState (Y.Map) → Live presentation state
└── timings (Y.Map)        → Per-slide timing data
```

---

## meta (Y.Map)

Presentation-level properties that cascade to all slides.

```typescript
interface PresentationMeta {
  // Identity
  id: string;
  title: string;
  description: string;

  // Cascading visual properties
  dimensions: {
    width: number;   // e.g., 1920
    height: number;  // e.g., 1080
  };
  aspectRatio: '16:9' | '4:3' | '16:10';

  template: string | null;  // Template ID if using one

  defaultFont: {
    heading: string;   // e.g., 'Inter'
    body: string;
    mono: string;
  };

  defaultColors: {
    background: string;  // e.g., '#0f172a'
    text: string;        // e.g., '#f8fafc'
    accent: string;      // e.g., '#3b82f6'
  };

  defaultTransition: TransitionConfig;

  // Ownership
  createdBy: string;      // User ID
  createdAt: string;      // ISO timestamp
  updatedAt: string;
}

interface TransitionConfig {
  type: 'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom';
  speed: 'fast' | 'default' | 'slow';
  direction?: 'left' | 'right' | 'up' | 'down';
}
```

### Cascading Behavior

Properties in `meta` are inherited by all slides unless a slide specifies an override:

```javascript
// Set presentation defaults
presentation.meta.set({
  defaultFont: { heading: 'Inter', body: 'Inter', mono: 'Fira Code' },
  defaultColors: { background: '#0f172a', text: '#f8fafc', accent: '#3b82f6' }
});

// Slide 3 overrides background
presentation.slides.update('slide-3', {
  overrides: {
    background: '#ffffff'
    // font and other properties still cascade from meta
  }
});
```

---

## slides (Y.Array)

Ordered array of slide metadata. Content stored separately in `slideContent`.

```typescript
interface Slide {
  id: string;                    // Unique slide identifier

  // Optional per-slide owner
  owner: string | null;          // userId - can edit even when locked

  // Override cascading properties (null = inherit from meta)
  overrides: SlideOverrides | null;

  // State flags
  hidden: boolean;               // Skip during presentation
  locked: boolean;               // Prevent edits except by owner
}

interface SlideOverrides {
  background?: string;
  font?: {
    heading?: string;
    body?: string;
    mono?: string;
  };
  transition?: TransitionConfig;
}
```

### Slide Ordering

Y.Array maintains order. Reordering uses Y.js array operations:

```javascript
// Move slide from index 2 to index 5
presentation.slides.move(2, 5);

// Under the hood: Y.Array delete + insert operations
// CRDT ensures consistent ordering across all clients
```

---

## slideContent (Y.Map<string, Y.Text>)

Slide HTML content. Each slide's content is a Y.Text for collaborative editing.

```
slideContent: {
  'slide-1': Y.Text('<div class="title">Hello</div>...'),
  'slide-2': Y.Text('<h1>Agenda</h1><ul>...'),
  ...
}
```

### Why Y.Text for HTML?

- **Conflict-free:** Multiple users editing same slide merge cleanly
- **Character-level sync:** See collaborator's cursor in real-time
- **Rich binding:** Works with contenteditable, Monaco, CodeMirror

### Free-Form Canvas

No restrictions on HTML content. Users build whatever they want:

```javascript
// Full creative freedom
presentation.slides.setContent('slide-1', `
  <div class="custom-layout">
    <canvas id="three-scene"></canvas>
    <div class="overlay">
      <h1>3D Visualization</h1>
    </div>
    <script>
      // Even inline scripts for interactive content
      initThreeJS();
    </script>
  </div>
`);
```

---

## speakerNotes (Y.Map<string, Y.Text>)

Markdown speaker notes per slide.

```
speakerNotes: {
  'slide-1': Y.Text('# Introduction\n- Welcome audience\n- State agenda'),
  'slide-2': Y.Text('## Key Points\n- Revenue: mention 15% growth'),
  ...
}
```

### Collaborative Notes

Notes are also Y.Text for collaborative editing:

```javascript
const notes = presentation.speakerNotes.get('slide-3');

// Multiple users can edit notes simultaneously
notes.observe(() => {
  renderMarkdown(notes.toString());
});
```

---

## presentationState (Y.Map)

Live presentation state. Updates during presenter mode.

```typescript
interface PresentationState {
  isPresenting: boolean;
  presenterId: string | null;       // Who is presenting
  presenterName: string | null;
  currentSlideIndex: number;
  startedAt: number | null;         // Unix timestamp
  slideStartedAt: number | null;    // When current slide started

  countdown: {
    total: number;       // Total seconds
    remaining: number;   // Remaining seconds
    paused: boolean;
  } | null;

  laser: {
    enabled: boolean;
    position: { x: number; y: number } | null;  // Normalized 0-1
  };
}
```

### Sync Protocol

Presenter updates `presentationState`. Audience subscribes:

```javascript
// Presenter
presentation.presenter.goToSlide(5);
// → Updates presentationState.currentSlideIndex = 5

// Audience (via presence subscription)
presentation.presenter.subscribe(state => {
  if (!presentation.presenter.isPresenter()) {
    goToSlide(state.currentSlideIndex);
    renderLaser(state.laser);
  }
});
```

---

## timings (Y.Map)

Per-slide timing data.

```typescript
interface SlideTimings {
  targetDuration: number;   // Seconds - how long should this slide take
  actualDuration: number;   // Accumulated from presentations
  presentationCount: number; // How many times presented
}
```

**Example:**

```
timings: {
  'slide-1': { targetDuration: 120, actualDuration: 135, presentationCount: 3 },
  'slide-2': { targetDuration: 60, actualDuration: 45, presentationCount: 3 },
  ...
}
```

---

## Y.js Operations

### Transactions

Batch multiple changes for atomic undo/redo:

```javascript
presentation.transact(() => {
  const slide = presentation.slides.add();
  presentation.slides.setContent(slide.id, '<h1>New</h1>');
  presentation.speakerNotes.set(slide.id, 'Notes');
});
// Single undo step
```

### Observing Changes

```javascript
// Observe slide list
presentation.slides.observe(slides => {
  renderSlidePanel(slides);
});

// Observe specific slide content
const content = presentation.slides.getContent('slide-1');
content.observe(() => {
  renderSlide('slide-1', content.toString());
});

// Observe metadata
presentation.meta.observe(meta => {
  applyTheme(meta.defaultColors, meta.defaultFont);
});
```

### Undo/Redo

Per-user undo stack:

```javascript
const undoMgr = presentation.undo.manager();

// User A makes changes → A can undo
// User B makes changes → B can undo B's changes
// Undo is scoped to user's own changes
```

---

## Presence Layer

Not stored in document - ephemeral state via WebSocket.

```typescript
interface SlidesPresenceState {
  user: {
    id: string;
    name: string;
    avatar: string | null;
    color: string;           // Assigned cursor color
  };

  viewingSlideId: string | null;
  editingSlideId: string | null;
  selectedElementId: string | null;

  cursor: { x: number; y: number } | null;
  textSelection: { start: number; end: number } | null;
  laserPointer: { x: number; y: number } | null;

  mode: 'edit' | 'view' | 'present' | 'speaker';
  lastActive: number;
}
```

---

## Storage Architecture

### Live Document

Y.js document stored in ShareOut's realtime infrastructure:
- WebSocket connection to `/v1/data/{artifactId}/realtime/{docName}`
- Binary Y.js protocol (0x00, 0x01, 0x02 messages)
- Automatic persistence to durable storage

### Version Snapshots

Stored separately for efficient restoration:

```
presentation_versions table:
├── id
├── presentation_id
├── name
├── description
├── snapshot (Y.js encoded state as binary)
├── snapshot_sv (state vector for diffing)
├── slide_count
├── thumbnail_blob_id
├── created_by
├── created_at
└── is_auto_save
```

### Media

Images and videos stored via `sdk.blobs`:
- Referenced in slide HTML by blob ID or CDN URL
- Not embedded in Y.js document
- Separate storage with 50MB/file limit
