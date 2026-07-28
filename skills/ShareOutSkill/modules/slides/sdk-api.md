# SDK.slides API Reference

Complete API documentation for the ShareOut Slides namespace.

## Namespace Structure

```typescript
interface ShareOut {
  // Existing namespaces
  json: JsonStore;
  table(name: string): Table;
  realtime(docId: string): RealtimeDoc;
  comments: Comments;
  blobs: Blobs;
  collaborators: Collaborators;

  // Slides namespace
  slides: SlidesSDK;
}
```

---

## SlidesSDK

Top-level slides management.

### sdk.slides.create()

Create a new presentation.

```typescript
create(options: CreateOptions): Promise<CreateResult>

interface CreateOptions {
  title: string;
  description?: string;
  template?: string;              // Template ID
  aspectRatio?: '16:9' | '4:3' | '16:10';
  visibility?: 'public' | 'private';  // 'unlisted' is a retired legacy alias, still accepted and treated as 'public'
}

interface CreateResult {
  id: string;
  editorUrl: string;              // $ORIGIN_HOST/a/{slug}
  publishedUrl: string;           // $ORIGIN_HOST/p/{slug}
  editorArtifactId: string;
  publishedArtifactId: string;
}
```

**Example:**

```javascript
const result = await sdk.slides.create({
  title: 'Q4 Review',
  aspectRatio: '16:9',
  visibility: 'public'
});

console.log(result.editorUrl);    // $ORIGIN_HOST/a/q4-review
console.log(result.publishedUrl); // $ORIGIN_HOST/p/q4-review
```

### sdk.slides.open()

Open a presentation for editing (requires authentication).

```typescript
open(id: string): Promise<Presentation>
```

**Example:**

```javascript
const presentation = await sdk.slides.open('q4-review');
await presentation.connect();
```

### sdk.slides.view()

Open a presentation for viewing (published mode).

```typescript
view(id: string): Promise<Presentation>
```

### sdk.slides.list()

List all presentations for this artifact.

```typescript
list(): Promise<PresentationInfo[]>

interface PresentationInfo {
  id: string;
  title: string;
  slideCount: number;
  editorUrl: string;
  publishedUrl: string;
  visibility: 'public' | 'private';
  createdAt: string;
  updatedAt: string;
}
```

### sdk.slides.delete()

Delete a presentation.

```typescript
delete(id: string): Promise<boolean>
```

---

## Presentation Instance

Returned by `sdk.slides.open()` or `sdk.slides.view()`.

### Connection

```typescript
// Connect to realtime document
connect(): Promise<void>

// Disconnect (keeps document)
disconnect(): void

// Destroy (cleanup resources)
destroy(): void
```

---

## presentation.meta

Presentation metadata with cascading properties.

### meta.get()

```typescript
get(): PresentationMeta

interface PresentationMeta {
  title: string;
  description: string;

  // Cascading properties
  dimensions: { width: number; height: number };
  aspectRatio: '16:9' | '4:3' | '16:10';
  template: string | null;
  defaultFont: {
    heading: string;
    body: string;
    mono: string;
  };
  defaultColors: {
    background: string;
    text: string;
    accent: string;
  };
  defaultTransition: TransitionConfig;

  createdBy: string;
  updatedAt: string;
}
```

### meta.set()

```typescript
set(changes: Partial<PresentationMeta>): void
```

**Example:**

```javascript
presentation.meta.set({
  title: 'Updated Title',
  defaultFont: {
    heading: 'Playfair Display',
    body: 'Inter',
    mono: 'Fira Code'
  }
});
```

### meta.observe()

```typescript
observe(handler: (meta: PresentationMeta) => void): () => void
```

---

## presentation.slides

Slide CRUD and content management.

### slides.list()

Get all slides in order.

```typescript
list(): Slide[]

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
```

### slides.add()

Add a new slide.

```typescript
add(options?: AddSlideOptions): Slide

interface AddSlideOptions {
  afterSlideId?: string;     // Insert after this slide
  content?: string;          // Initial HTML content
}
```

**Example:**

```javascript
const slide = presentation.slides.add({
  content: '<h1>New Slide</h1>'
});
```

### slides.delete()

```typescript
delete(slideId: string): boolean
```

### slides.move()

Reorder slide position.

```typescript
move(fromIndex: number, toIndex: number): void
```

### slides.duplicate()

```typescript
duplicate(slideId: string): Slide
```

### slides.observe()

Subscribe to slide list changes.

```typescript
observe(handler: (slides: Slide[]) => void): () => void
```

### slides.getContent()

Get slide HTML as Y.Text for collaborative binding.

```typescript
getContent(slideId: string): Y.Text
```

**Example (binding to editor):**

```javascript
const content = presentation.slides.getContent('slide-1');

// Observe remote changes
content.observe(() => {
  editor.innerHTML = content.toString();
});

// Apply local changes
editor.oninput = () => {
  presentation.transact(() => {
    content.delete(0, content.length);
    content.insert(0, editor.innerHTML);
  });
};
```

### slides.setContent()

Set slide HTML content directly.

```typescript
setContent(slideId: string, html: string): void
```

### slides.update()

Update slide properties (overrides, hidden, locked).

```typescript
update(slideId: string, changes: Partial<Slide>): void
```

**Example:**

```javascript
presentation.slides.update('slide-3', {
  overrides: {
    background: '#1e293b'
  },
  hidden: false
});
```

### slides.setOwner()

Assign per-slide ownership.

```typescript
setOwner(slideId: string, userId: string | null): void
```

### slides.getOwner()

```typescript
getOwner(slideId: string): string | null
```

### slides.lock() / unlock()

Lock slide from editing except by owner.

```typescript
lock(slideId: string): void
unlock(slideId: string): void
```

### slides.isLocked()

```typescript
isLocked(slideId: string): boolean
```

---

## presentation.speakerNotes

Speaker notes per slide.

### speakerNotes.get()

Get Y.Text for collaborative binding.

```typescript
get(slideId: string): Y.Text
```

### speakerNotes.set()

Set notes directly.

```typescript
set(slideId: string, content: string): void
```

**Example:**

```javascript
presentation.speakerNotes.set('slide-1', `
# Key Points
- Revenue up 15%
- New customers: 1,200
- Remember to mention Q3 comparison
`);
```

---

## presentation.presenter

Presenter mode controls. See [presenter-mode.md](presenter-mode.md) for details.

### presenter.start()

```typescript
start(options?: StartOptions): Promise<void>

interface StartOptions {
  fromSlide?: number;
  countdown?: number;           // Seconds
  autoAdvance?: boolean;
  autoAdvanceInterval?: number;
}
```

### presenter.stop()

```typescript
stop(): void
```

### presenter.state()

```typescript
state(): PresentationState

interface PresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  presenterName: string | null;
  currentSlideIndex: number;
  totalSlides: number;
  startedAt: number | null;
  slideStartedAt: number | null;
  countdown: {
    total: number;
    remaining: number;
    paused: boolean;
  } | null;
  laser: {
    enabled: boolean;
    position: { x: number; y: number } | null;
  };
}
```

### presenter.isActive()

```typescript
isActive(): boolean
```

### presenter.isPresenter()

```typescript
isPresenter(): boolean
```

### Navigation

```typescript
next(): void
previous(): void
goToSlide(index: number): void
first(): void
last(): void
```

### presenter.timer

```typescript
timer.elapsed(): number              // Seconds since start
timer.slideElapsed(): number         // Seconds on current slide
timer.setCountdown(seconds: number): void
timer.remaining(): number | null     // Countdown remaining
timer.pause(): void
timer.resume(): void
timer.reset(): void
```

### presenter.laser

```typescript
laser.enable(): void
laser.disable(): void
laser.move(x: number, y: number): void  // Normalized 0-1
laser.isEnabled(): boolean
```

### presenter.subscribe()

```typescript
subscribe(handler: (state: PresentationState) => void): () => void
```

---

## presentation.versions

Version history. See [versions.md](versions.md) for details.

```typescript
versions.list(): Promise<Version[]>
versions.create(name: string, description?: string): Promise<Version>
versions.restore(versionId: string): Promise<void>
versions.diff(fromId: string, toId: string): Promise<VersionDiff>
versions.delete(versionId: string): Promise<boolean>
versions.subscribe(handler: (versions: Version[]) => void): () => void
```

---

## presentation.publish

Publishing controls.

### publish.getUrl()

```typescript
getUrl(): string  // $ORIGIN_HOST/p/{slug}
```

### publish.setVisibility()

```typescript
setVisibility(visibility: 'public' | 'private'): void
```

### publish.unpublish() / republish()

```typescript
unpublish(): void   // Temporarily hide published version
republish(): void   // Restore published version
```

---

## presentation.undo

Undo/redo management.

```typescript
undo.manager(): Y.UndoManager
undo.canUndo(): boolean
undo.canRedo(): boolean
undo.undo(): void
undo.redo(): void
```

---

## presentation.presence

User presence for collaboration.

### presence.set()

```typescript
set(state: Partial<SlidesPresenceState>): void

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

### presence.get()

```typescript
get(): Map<string, SlidesPresenceState>
```

### presence.subscribe()

```typescript
subscribe(handler: (users: Map<string, SlidesPresenceState>) => void): () => void
```

### presence.getEditorsOnSlide()

```typescript
getEditorsOnSlide(slideId: string): SlidesPresenceState[]
```

---

## Viewer analytics — automatic (B2B)

`so.slides.view(id)` **auto-starts engagement capture** — every deck flows analytics with no template changes. On view it begins a session, heartbeats (~10s), tracks visibility, and flushes via `sendBeacon` on page hide. If the URL carries a tracked link (`?l=lnk_...`) with an **open** gate, the session is auto-attributed to that recipient.

```javascript
const deck = await so.slides.view('pres_...');   // capture is now ON
// ...render slides...
deck.trackSlide(index);                          // call on each navigation → per-slide dwell + drop-off
```

- **`deck.trackSlide(index)`** — record a slide change. Without it you still get session-level metrics (views, unique viewers, duration, device/country); with it you also get per-slide dwell, drop-off, and completion.
- **Opt out:** `so.slides.view(id, { track: false })`.
- **Challenge gates (email/password):** auto-attribution only covers open links. For gated links, run the gate UI yourself, then start an attributed session:

```javascript
const deck = await so.slides.view('pres_...', { track: false });
const { sessionId } = await deck.links.access('lnk_...', { email });  // or { password }
await deck.startTracking(sessionId);
```

Low-level escape hatch — `deck.tracker.start(total, index, slideId, sessionId?)` / `deck.tracker.enter(index, slideId)` / `deck.tracker.stop()`.

Privacy: IP is hashed (never stored raw), `DNT: 1` suppresses IP/user-agent/country, and only an email the viewer gives via a tracked link is retained.

## presentation.analytics() — owner readout

Owner-only engagement readout. Returns a summary, per-slide drop-off (heatmap-ready), and recent sessions.

```typescript
analytics(): Promise<ViewAnalytics>
// {
//   summary:  { totalViews, uniqueViewers, avgDurationMs, completionRate },
//   perSlide: [{ slideIndex, views, avgDwellMs, dropOffRate }],
//   sessions: [{ id, viewerEmail, country, device, slidesSeen, durationMs, completed, startedAt, lastSeenAt }]
// }
```

---

## presentation.links — tracked & gated links (B2B)

Turn a share into a *tracked* link, optionally *gated*. Each link attributes view sessions to a named recipient and can require an email, password, or domain before access. This is what turns anonymous analytics into **named** analytics ("Acme viewed 6 of 8 slides").

```typescript
// Owner
links.create(options?: CreateLinkOptions): Promise<ShareLink>
links.list(): Promise<ShareLink[]>          // includes live view counts
links.revoke(linkId: string): Promise<void>

// Public viewer side
links.gate(linkId: string): Promise<{ gate; recipientLabel; revoked; expired }>
links.access(linkId, { email?, password? }): Promise<{ sessionId; granted; recipientLabel }>

interface CreateLinkOptions {
  recipientLabel?: string;                        // "Acme Corp"
  gate?: 'none' | 'email' | 'password' | 'domain';
  password?: string;                              // gate = 'password'
  domains?: string[];                             // gate = 'domain', e.g. ['acme.com']
  expiresAt?: string;                             // ISO; link 410s after
  maxViews?: number;                              // cap on attributed sessions
}
```

**Owner — mint a per-recipient gated link:**

```javascript
const link = await deck.links.create({
  recipientLabel: 'Acme Corp',
  gate: 'email',
  maxViews: 25,
});
// share link.url  →  $ORIGIN/p/<deck>?l=lnk_...
```

**Viewer — pass the gate, then attribute the session:**

```javascript
const { sessionId } = await deck.links.access('lnk_...', { email: 'jane@acme.com' });
deck.tracker.start(slides.length, 0, slides[0]?.id, sessionId); // session now named
```

Gate validation, expiry, revocation, and the view cap are enforced server-side. `gate_value` (password hash / allowed domains) is never returned.

---

## presentation.transact()

Batch multiple changes into one undo step.

```typescript
transact(fn: () => void): void
```

**Example:**

```javascript
presentation.transact(() => {
  const slide = presentation.slides.add();
  presentation.slides.setContent(slide.id, '<h1>Title</h1>');
  presentation.speakerNotes.set(slide.id, 'Notes here');
});
// All three changes = 1 undo step
```

---

## sdk.slides.helpers

Optional HTML generation helpers. Do not restrict - just convenience.

```typescript
helpers.textBlock(content: string, style?: TextStyle): string
helpers.image(blobId: string, options?: ImageOptions): string
helpers.codeBlock(code: string, language: string): string
helpers.chart(config: ChartConfig): string
helpers.embed(url: string, options?: EmbedOptions): string
helpers.video(blobId: string, options?: VideoOptions): string
```

**Example:**

```javascript
const html = sdk.slides.helpers.image(blobId, {
  width: '60%',
  align: 'center',
  caption: 'Q4 Results Chart'
});

presentation.slides.setContent('slide-2', html);
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
  | 'slide:change'        // Current slide changed during presentation
  | 'sync'
  | 'status';             // Connection status
```

---

## TypeScript Types

Full type definitions:

```typescript
interface TransitionConfig {
  type: 'none' | 'fade' | 'slide' | 'convex' | 'concave' | 'zoom';
  speed: 'fast' | 'default' | 'slow';
  direction?: 'left' | 'right' | 'up' | 'down';
}

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
  slides: {
    added: string[];
    removed: string[];
    modified: string[];
    reordered: boolean;
  };
  metadata: {
    changed: string[];
  };
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
```
