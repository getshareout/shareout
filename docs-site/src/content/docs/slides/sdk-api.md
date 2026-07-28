---
title: SDK API reference
description: Complete method signatures for the sdk.slides namespace.
---

The `sdk.slides` namespace is the entry point for all presentation operations. An open `Presentation` instance exposes sub-namespaces for slides, metadata, notes, presenter controls, versions, publishing, presence, and undo.

The `visibility` field accepts `private`, `workspace`, and `public`. (`unlisted` is a retired legacy alias, still accepted on the API and treated as `public`.)

## `sdk.slides` — top-level

### `sdk.slides.create()`

Create a presentation. Returns both the editor and published artifact URLs.

```typescript
create(options: CreateOptions): Promise<CreateResult>

interface CreateOptions {
  title: string;
  description?: string;
  template?: string;                    // built-in theme name
  aspectRatio?: '16:9' | '4:3' | '16:10';
  visibility?: 'private' | 'workspace' | 'public';
  theme?: string;                       // alias for template
  slides?: SlideSpec[];                 // create with content
  fromMarkdown?: string;                // markdown outline → slides
}

interface CreateResult {
  id: string;
  editorUrl: string;                    // shareout.site/a/{slug}
  publishedUrl: string;                 // shareout.site/p/{slug}
  editorArtifactId: string;
  publishedArtifactId: string;
}
```

### `sdk.slides.open()`

Open a presentation for editing. Requires authentication with `editor` or `owner` role.

```typescript
open(id: string): Promise<Presentation>
```

### `sdk.slides.view()`

Open a presentation for viewing. No authentication needed for `public` presentations.

```typescript
view(id: string): Promise<Presentation>
```

### `sdk.slides.list()`

List all presentations associated with this artifact.

```typescript
list(): Promise<PresentationInfo[]>

interface PresentationInfo {
  id: string;
  title: string;
  slideCount: number;
  editorUrl: string;
  publishedUrl: string;
  visibility: 'private' | 'workspace' | 'public';
  createdAt: string;
  updatedAt: string;
}
```

### `sdk.slides.delete()`

```typescript
delete(id: string): Promise<boolean>
```

### `sdk.slides.generate()`

Generate a full deck from a prompt using server-side AI. Returns the same shape as `create()`.

```typescript
generate(options: {
  prompt: string;
  theme?: string;
  length?: number;           // target slide count
  title?: string;
  visibility?: 'private' | 'workspace' | 'public';
}): Promise<CreateResult>
```

Returns 503 when no AI provider is configured; 502 on invalid model output.

### `sdk.slides.helpers`

HTML generation utilities. See [Authoring decks](/slides/authoring/) for usage.

```typescript
helpers.textBlock(content: string, style?: TextStyle): string
helpers.image(blobId: string, options?: ImageOptions): string
helpers.codeBlock(code: string, language: string): string
helpers.chart(config: ChartConfig): string
helpers.embed(url: string, options?: EmbedOptions): string
helpers.video(blobId: string, options?: VideoOptions): string
helpers.fromMarkdown(md: string): SlideSpec[]

// Full-slide layouts
helpers.layout.title(slots): string
helpers.layout.section(slots): string
helpers.layout.titleContent(slots): string
helpers.layout.twoCol(slots): string
helpers.layout.imageText(slots): string
helpers.layout.fullImage(slots): string
helpers.layout.bigStat(slots): string
helpers.layout.quote(slots): string
helpers.layout.cards(slots): string
helpers.layout.chart(slots): string
helpers.layout.blank(html: string): string
```

---

## `Presentation` — connection

```typescript
connect(): Promise<void>     // connect to realtime document
disconnect(): void           // disconnect (keeps document)
destroy(): void              // disconnect and release resources
transact(fn: () => void): void  // batch changes into one undo step
```

---

## `presentation.meta`

Presentation-level metadata. Properties set here cascade to all slides unless a slide specifies an override.

```typescript
meta.get(): PresentationMeta
meta.set(changes: Partial<PresentationMeta>): void
meta.observe(handler: (meta: PresentationMeta) => void): () => void

interface PresentationMeta {
  title: string;
  description: string;
  dimensions: { width: number; height: number };
  aspectRatio: '16:9' | '4:3' | '16:10';
  template: string | null;
  defaultFont: { heading: string; body: string; mono: string };
  defaultColors: { background: string; text: string; accent: string };
  defaultTransition: TransitionConfig;
  createdBy: string;
  updatedAt: string;
}
```

---

## `presentation.slides`

Slide CRUD. Content is stored separately from metadata.

```typescript
slides.list(): Slide[]
slides.add(options?: AddSlideOptions): Slide
slides.delete(slideId: string): boolean
slides.move(fromIndex: number, toIndex: number): void
slides.duplicate(slideId: string): Slide
slides.observe(handler: (slides: Slide[]) => void): () => void

interface Slide {
  id: string;
  owner: string | null;
  overrides: SlideOverrides | null;
  hidden: boolean;
  locked: boolean;
}

interface SlideOverrides {
  background?: string;
  font?: { heading?: string; body?: string; mono?: string };
  transition?: TransitionConfig;
}

interface AddSlideOptions {
  afterSlideId?: string;
  content?: string;
}
```

### Content

```typescript
// Get Y.Text for collaborative binding (e.g. contenteditable, CodeMirror)
slides.getContent(slideId: string): Y.Text

// Set content directly
slides.setContent(slideId: string, html: string): void

// Update metadata (overrides, hidden, locked)
slides.update(slideId: string, changes: Partial<Slide>): void
```

### Bulk operations

```typescript
slides.addMany(slides: SlideSpec[]): Promise<Slide[]>
slides.replaceAll(slides: SlideSpec[]): Promise<Slide[]>
```

Both call `POST /data/slides/{id}/slides/batch` — atomic server-side write.

### Ownership and locking

```typescript
slides.setOwner(slideId: string, userId: string | null): void
slides.getOwner(slideId: string): string | null
slides.lock(slideId: string): void
slides.unlock(slideId: string): void
slides.isLocked(slideId: string): boolean
```

### Per-slide AI

```typescript
slides.rewrite(slideId: string, instruction: string): Promise<void>
slides.expand(slideId: string, instruction: string): Promise<void>
slides.generateNotes(slideId: string): Promise<string>
slides.suggestLayout(slideId: string): Promise<string>
```

---

## `presentation.speakerNotes`

Per-slide Markdown notes stored as Y.Text.

```typescript
speakerNotes.get(slideId: string): Y.Text         // Y.Text for collaborative binding
speakerNotes.set(slideId: string, content: string): void
```

---

## `presentation.presenter`

See [Presenter mode](/slides/presenter-mode/) for full usage.

```typescript
presenter.start(options?: StartOptions): Promise<void>
presenter.stop(): void
presenter.state(): PresentationState
presenter.isActive(): boolean
presenter.isPresenter(): boolean
presenter.subscribe(handler: (state: PresentationState) => void): () => void

// Navigation
presenter.next(): void
presenter.previous(): void
presenter.goToSlide(index: number): void
presenter.first(): void
presenter.last(): void

// Blackout
presenter.blackout(enabled: boolean): void

interface StartOptions {
  fromSlide?: number;
  countdown?: number;            // seconds
  autoAdvance?: boolean;
  autoAdvanceInterval?: number;
}

interface PresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  presenterName: string | null;
  currentSlideIndex: number;
  totalSlides: number;
  startedAt: number | null;
  slideStartedAt: number | null;
  countdown: { total: number; remaining: number; paused: boolean } | null;
  laser: { enabled: boolean; position: { x: number; y: number } | null };
  blackout: boolean;
}
```

### `presenter.timer`

```typescript
timer.elapsed(): number            // seconds since presentation started
timer.slideElapsed(): number       // seconds on current slide
timer.setCountdown(seconds: number): void
timer.remaining(): number | null   // null if no countdown set
timer.pause(): void
timer.resume(): void
timer.reset(): void
```

### `presenter.laser`

```typescript
laser.enable(): void
laser.disable(): void
laser.move(x: number, y: number): void   // normalized 0–1
laser.isEnabled(): boolean
```

---

## `presentation.versions`

```typescript
versions.list(): Promise<Version[]>
versions.create(name: string, description?: string): Promise<Version>
versions.restore(versionId: string): Promise<void>
versions.diff(fromId: string, toId: string): Promise<VersionDiff>
versions.delete(versionId: string): Promise<boolean>
versions.subscribe(handler: (versions: Version[]) => void): () => void

interface Version {
  id: string;
  presentationId: string;
  name: string;
  description: string | null;
  slideCount: number;
  createdAt: string;
  createdBy: { id: string; name: string; email: string };
  isAutoSave: boolean;
  thumbnail: string | null;
}

interface VersionDiff {
  slides: { added: string[]; removed: string[]; modified: string[]; reordered: boolean };
  metadata: { changed: string[] };
}
```

---

## `presentation.publish`

```typescript
publish.getUrl(): string                                              // shareout.site/p/{slug}
publish.setVisibility(v: 'private' | 'workspace' | 'public'): void
publish.unpublish(): void
publish.republish(): void
```

---

## `presentation.presence`

Ephemeral user state — not stored in the Y.js document.

```typescript
presence.set(state: Partial<SlidesPresenceState>): void
presence.get(): Map<string, SlidesPresenceState>
presence.subscribe(handler: (users: Map<string, SlidesPresenceState>) => void): () => void
presence.getEditorsOnSlide(slideId: string): SlidesPresenceState[]

interface SlidesPresenceState {
  user: { id: string; name: string; color: string };
  viewingSlideId: string | null;
  editingSlideId: string | null;
  cursor: { x: number; y: number } | null;
  textSelection: { start: number; end: number } | null;
  laserPointer: { x: number; y: number } | null;
  mode: 'edit' | 'view' | 'present' | 'speaker';
}
```

---

## `presentation.undo`

Per-user undo stack scoped to the current client's changes.

```typescript
undo.manager(): Y.UndoManager
undo.canUndo(): boolean
undo.canRedo(): boolean
undo.undo(): void
undo.redo(): void
```

---

## Events

```typescript
presentation.on(event: SlidesEvent, handler: Function): void
presentation.off(event: SlidesEvent, handler: Function): void

type SlidesEvent =
  | 'slide:added'
  | 'slide:deleted'
  | 'slide:reordered'
  | 'slide:updated'
  | 'presentation:start'
  | 'presentation:end'
  | 'slide:change'          // current slide changed during presentation
  | 'sync'
  | 'status';               // connection status
```

---

## Export

```typescript
presentation.export(format: 'pdf' | 'png', slideId?: string): Promise<Blob>
presentation.exportUrl(format: 'pdf' | 'png', slideId?: string): string
```

Returns 503 when the `BROWSER` binding is unavailable.

---

## TypeScript types

```typescript
interface TransitionConfig {
  type: 'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom';
  speed: 'fast' | 'default' | 'slow';
  direction?: 'left' | 'right' | 'up' | 'down';
}

interface TextStyle {
  fontSize?: number;
  fontFamily?: string;
  fontWeight?: 'normal' | 'bold';
  color?: string;
  textAlign?: 'left' | 'center' | 'right';
}

interface ImageOptions {
  width?: string;
  height?: string;
  align?: 'left' | 'center' | 'right';
  caption?: string;
  alt?: string;
}

interface EmbedOptions {
  width?: string;
  height?: string;
  allowFullscreen?: boolean;
}

type SlideSpec =
  | { layout: string; [slot: string]: unknown; notes?: string; hidden?: boolean }
  | { html: string; notes?: string; hidden?: boolean }
```
