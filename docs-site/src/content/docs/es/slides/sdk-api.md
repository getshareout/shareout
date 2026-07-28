---
title: Referencia de la API del SDK
description: Firmas completas de métodos del namespace sdk.slides.
---

El namespace `sdk.slides` es el punto de entrada para todas las operaciones de presentación. Una instancia `Presentation` abierta expone sub-namespaces para slides, metadata, notas, controles del presentador, versiones, publicación, presencia y deshacer.

El campo `visibility` acepta `private`, `workspace` y `public`. (`unlisted` es un alias legacy retirado, aún aceptado en la API y tratado como `public`.)

## `sdk.slides` — nivel superior

### `sdk.slides.create()`

Crear una presentación. Devuelve las URLs del artifact de edición y del publicado.

```typescript
create(options: CreateOptions): Promise<CreateResult>

interface CreateOptions {
  title: string;
  description?: string;
  template?: string;                    // nombre del tema incluido
  aspectRatio?: '16:9' | '4:3' | '16:10';
  visibility?: 'private' | 'workspace' | 'public';
  theme?: string;                       // alias de template
  slides?: SlideSpec[];                 // crear con contenido
  fromMarkdown?: string;                // outline Markdown → slides
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

Abrir una presentación para edición. Requiere autenticación con rol `editor` o `owner`.

```typescript
open(id: string): Promise<Presentation>
```

### `sdk.slides.view()`

Abrir una presentación para visualización. No requiere autenticación para presentaciones `public`.

```typescript
view(id: string): Promise<Presentation>
```

### `sdk.slides.list()`

Listar todas las presentaciones asociadas a este artifact.

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

Generar un deck completo desde un prompt usando IA del servidor. Devuelve la misma forma que `create()`.

```typescript
generate(options: {
  prompt: string;
  theme?: string;
  length?: number;           // cantidad objetivo de slides
  title?: string;
  visibility?: 'private' | 'workspace' | 'public';
}): Promise<CreateResult>
```

Devuelve 503 cuando no hay proveedor de IA configurado; 502 en output inválido del modelo.

### `sdk.slides.helpers`

Utilidades de generación de HTML. Ver [Creación de decks](/es/slides/authoring/) para su uso.

```typescript
helpers.textBlock(content: string, style?: TextStyle): string
helpers.image(blobId: string, options?: ImageOptions): string
helpers.codeBlock(code: string, language: string): string
helpers.chart(config: ChartConfig): string
helpers.embed(url: string, options?: EmbedOptions): string
helpers.video(blobId: string, options?: VideoOptions): string
helpers.fromMarkdown(md: string): SlideSpec[]

// Layouts completos de slide
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

## `Presentation` — conexión

```typescript
connect(): Promise<void>     // conectar al documento realtime
disconnect(): void           // desconectar (el documento se mantiene)
destroy(): void              // desconectar y liberar recursos
transact(fn: () => void): void  // agrupar cambios en un paso de deshacer
```

---

## `presentation.meta`

Metadata de la presentación. Las propiedades configuradas acá se heredan en todos los slides salvo que un slide especifique un override.

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

CRUD de slides. El contenido se almacena separado de la metadata.

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

### Contenido

```typescript
// Obtener Y.Text para binding colaborativo (p. ej. contenteditable, CodeMirror)
slides.getContent(slideId: string): Y.Text

// Establecer contenido directamente
slides.setContent(slideId: string, html: string): void

// Actualizar metadata (overrides, hidden, locked)
slides.update(slideId: string, changes: Partial<Slide>): void
```

### Operaciones masivas

```typescript
slides.addMany(slides: SlideSpec[]): Promise<Slide[]>
slides.replaceAll(slides: SlideSpec[]): Promise<Slide[]>
```

Ambas llaman a `POST /data/slides/{id}/slides/batch` — escritura atómica en el servidor.

### Propiedad y bloqueo

```typescript
slides.setOwner(slideId: string, userId: string | null): void
slides.getOwner(slideId: string): string | null
slides.lock(slideId: string): void
slides.unlock(slideId: string): void
slides.isLocked(slideId: string): boolean
```

### IA por slide

```typescript
slides.rewrite(slideId: string, instruction: string): Promise<void>
slides.expand(slideId: string, instruction: string): Promise<void>
slides.generateNotes(slideId: string): Promise<string>
slides.suggestLayout(slideId: string): Promise<string>
```

---

## `presentation.speakerNotes`

Notas Markdown por slide almacenadas como Y.Text.

```typescript
speakerNotes.get(slideId: string): Y.Text         // Y.Text para binding colaborativo
speakerNotes.set(slideId: string, content: string): void
```

---

## `presentation.presenter`

Ver [Modo presentador](/es/slides/presenter-mode/) para uso completo.

```typescript
presenter.start(options?: StartOptions): Promise<void>
presenter.stop(): void
presenter.state(): PresentationState
presenter.isActive(): boolean
presenter.isPresenter(): boolean
presenter.subscribe(handler: (state: PresentationState) => void): () => void

// Navegación
presenter.next(): void
presenter.previous(): void
presenter.goToSlide(index: number): void
presenter.first(): void
presenter.last(): void

// Blackout
presenter.blackout(enabled: boolean): void

interface StartOptions {
  fromSlide?: number;
  countdown?: number;            // segundos
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
timer.elapsed(): number            // segundos desde que empezó la presentación
timer.slideElapsed(): number       // segundos en el slide actual
timer.setCountdown(seconds: number): void
timer.remaining(): number | null   // null si no se configuró cuenta regresiva
timer.pause(): void
timer.resume(): void
timer.reset(): void
```

### `presenter.laser`

```typescript
laser.enable(): void
laser.disable(): void
laser.move(x: number, y: number): void   // coordenadas normalizadas 0–1
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

Estado efímero del usuario — no se almacena en el documento Y.js.

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

Stack de deshacer por usuario, limitado a los cambios del cliente actual.

```typescript
undo.manager(): Y.UndoManager
undo.canUndo(): boolean
undo.canRedo(): boolean
undo.undo(): void
undo.redo(): void
```

---

## Eventos

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
  | 'slide:change'          // slide actual cambió durante la presentación
  | 'sync'
  | 'status';               // estado de la conexión
```

---

## Export

```typescript
presentation.export(format: 'pdf' | 'png', slideId?: string): Promise<Blob>
presentation.exportUrl(format: 'pdf' | 'png', slideId?: string): string
```

Devuelve 503 cuando el binding `BROWSER` no está disponible.

---

## Tipos TypeScript

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
