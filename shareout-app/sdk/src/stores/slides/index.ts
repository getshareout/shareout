/**
 * ShareOut Slides SDK module.
 *
 * ## Architecture
 *
 * ```
 * SlidesStore              ← sdk.slides (REST + session factory)
 *   └── Presentation       ← live session (one per open/view)
 *         ├── meta           ← title, theme, dimensions
 *         ├── slides         ← deck CRUD, reorder, AI helpers
 *         ├── speakerNotes   ← per-slide presenter notes
 *         ├── presenter      ← live mode, navigation, timer, laser
 *         ├── versions       ← named snapshots + restore
 *         ├── publish        ← visibility + public URL
 *         ├── undo           ← client-side slide list undo/redo
 *         └── presence       ← collaborative cursors (WebSocket)
 * ```
 *
 * Edit sessions open a WebSocket to `/slides/ws` for realtime slide events
 * and presence. View sessions use REST only unless {@link Presentation.subscribe}
 * is called (which lazily connects the socket).
 *
 * {@link SlideHelpers} (via `sdk.slides.helpers`) provides client-side deck
 * building utilities with no server state.
 */

export { SlidesStore } from './slides-store';
export { Presentation } from './presentation';

export type {
  SlidesFonts,
  SlidesColors,
  SlidesTransition,
  PresentationMeta,
  Slide,
  PresentationVersion,
  PresentationState,
  SlidesPresenceState,
  VersionDiff,
  ViewAnalytics,
  ShareLink,
  CreateLinkOptions,
  LinkAccessResult,
  SlidesEventType,
  CreatePresentationOptions,
  CreatePresentationResult,
  SlideEvent,
  SlideEventListener,
} from './types';
