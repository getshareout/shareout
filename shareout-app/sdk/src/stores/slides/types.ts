/**
 * Shared types for the ShareOut Slides SDK module.
 *
 * These mirror the worker's slides REST API and WebSocket event payloads.
 * Consumers typically interact through {@link SlidesStore} and {@link Presentation}
 * rather than importing these types directly.
 */

export interface SlidesFonts {
  heading: string;
  body: string;
  mono: string;
}

export interface SlidesColors {
  background: string;
  text: string;
  accent: string;
}

export interface SlidesTransition {
  type: string;
  duration: number;
}

/** Presentation-level metadata returned by list/get/create endpoints. */
export interface PresentationMeta {
  id: string;
  artifactId: string;
  title: string;
  description: string | null;
  width: number;
  height: number;
  aspectRatio: string;
  template: string | null;
  defaultFonts: SlidesFonts;
  defaultColors: SlidesColors;
  defaultTransition: SlidesTransition;
  publishedArtifactId: string | null;
  visibility: 'public' | 'private';
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A single slide within a presentation deck. */
export interface Slide {
  id: string;
  presentationId: string;
  position: number;
  ownerId: string | null;
  overrideBackground: string | null;
  overrideFonts: Partial<SlidesFonts> | null;
  overrideTransition: Partial<SlidesTransition> | null;
  content: string;
  hidden: boolean;
  locked: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Server-stored snapshot of a deck at a point in time. */
export interface PresentationVersion {
  id: string;
  presentationId: string;
  name: string;
  description: string | null;
  slideCount: number;
  createdById: string | null;
  createdByName: string | null;
  isAutoSave: boolean;
  createdAt: string;
}

/** Live presenter mode state (slide index, timer, laser pointer). */
export interface PresentationState {
  isPresenting: boolean;
  presenterId: string | null;
  presenterName: string | null;
  currentSlideIndex: number;
  totalSlides: number;
  startedAt: string | null;
  slideStartedAt: string | null;
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

/** Per-user collaborative presence on the slides WebSocket channel. */
export interface SlidesPresenceState {
  user: { id: string; name: string; color: string };
  viewingSlideId: string | null;
  editingSlideId: string | null;
  cursor: { x: number; y: number } | null;
  textSelection: { start: number; end: number } | null;
  laserPointer: { x: number; y: number } | null;
  mode: 'edit' | 'view' | 'present' | 'speaker';
}

/** A tracked/gated share link for a deck (Slides B2B P1). */
export interface ShareLink {
  id: string;
  url: string;
  recipientLabel: string | null;
  gate: 'none' | 'email' | 'password' | 'domain';
  expiresAt: string | null;
  maxViews: number | null;
  views: number;
  revoked: boolean;
  createdAt: string;
}

/** Options to mint a tracked link. */
export interface CreateLinkOptions {
  recipientLabel?: string;
  gate?: 'none' | 'email' | 'password' | 'domain';
  password?: string;       // required when gate = 'password'
  domains?: string[];      // required when gate = 'domain'
  expiresAt?: string;
  maxViews?: number;
}

/** Result of passing a tracked link's gate — feed sessionId to `tracker.start`. */
export interface LinkAccessResult {
  sessionId: string;
  granted: boolean;
  recipientLabel: string | null;
}

/** Owner-facing viewer-analytics readout for a deck (Slides B2B P0). */
export interface ViewAnalytics {
  summary: {
    totalViews: number;
    uniqueViewers: number;
    avgDurationMs: number;
    completionRate: number;
  };
  perSlide: Array<{
    slideIndex: number;
    views: number;
    avgDwellMs: number;
    dropOffRate: number;
  }>;
  sessions: Array<{
    id: string;
    viewerEmail: string | null;
    country: string | null;
    device: string;
    slidesSeen: number;
    durationMs: number;
    completed: boolean;
    startedAt: string;
    lastSeenAt: string;
  }>;
}

/** Structural diff between two saved versions. */
export interface VersionDiff {
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

/** WebSocket and {@link Presentation.on} event names. */
export type SlidesEventType =
  | 'slide:added'
  | 'slide:deleted'
  | 'slide:reordered'
  | 'slide:updated'
  | 'presentation:start'
  | 'presentation:end'
  | 'slide:change'
  | 'sync'
  | 'status';

export interface CreatePresentationOptions {
  title?: string;
  description?: string;
  width?: number;
  height?: number;
  aspectRatio?: string;
  template?: string;
  defaultFonts?: SlidesFonts;
  defaultColors?: SlidesColors;
  visibility?: 'public' | 'private';
}

export interface CreatePresentationResult extends PresentationMeta {
  editorUrl: string;
  publishedUrl: string;
}

/** Payload shape for {@link Presentation.subscribe} callbacks. */
export interface SlideEvent {
  type:
    | 'slide:added'
    | 'slide:updated'
    | 'slide:deleted'
    | 'slide:reordered'
    | 'presentation:updated'
    | 'presenter:changed';
  data: unknown;
}

export type SlideEventListener = (event: SlideEvent) => void;
