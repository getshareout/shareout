/**
 * CSS for the viewer header (title, favorite, schedule, comments, share) and the
 * side panels it opens. Injected only when the viewer is logged in or comments are enabled.
 *
 * Each segment lives in its own file for maintainability; the barrel
 * concatenates them in DOM-order so cascade behavior is unchanged.
 *
 * @module serve/sandbox-viewer/toolbar/styles
 */
import { headerStyles } from './header.css';
import { panelsStyles } from './panels.css';
import { commentsOverlayStyles } from './comments-overlay.css';
import { scheduleModalsStyles } from './schedule-modals.css';
import { responsiveStyles } from './responsive.css';

/** Ordered CSS sections concatenated for the viewer header. */
export const TOOLBAR_STYLES = [
  headerStyles,
  panelsStyles,
  commentsOverlayStyles,
  scheduleModalsStyles,
  responsiveStyles,
].join('');
