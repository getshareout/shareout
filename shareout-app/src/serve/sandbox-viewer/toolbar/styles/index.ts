/**
 * CSS for the floating viewer toolbar (favorites, comments, admin overlays).
 * Injected only when the viewer is logged in or comments are enabled.
 *
 * Each segment lives in its own file for maintainability; the barrel
 * concatenates them in DOM-order so cascade behavior is unchanged.
 *
 * @module serve/sandbox-viewer/toolbar/styles
 */
import { toolbarShellStyles } from './toolbar-shell.css';
import { backHomeStyles } from './back-home.css';
import { statsSkillsOverlayStyles } from './stats-skills-overlay.css';
import { adminOverlayStyles } from './admin-overlay.css';
import { commentsOverlayStyles } from './comments-overlay.css';
import { scheduleModalsStyles } from './schedule-modals.css';
import { responsiveStyles } from './responsive.css';

/** Ordered CSS sections concatenated for the viewer toolbar. */
export const TOOLBAR_STYLES = [
  toolbarShellStyles,
  backHomeStyles,
  statsSkillsOverlayStyles,
  adminOverlayStyles,
  commentsOverlayStyles,
  scheduleModalsStyles,
  responsiveStyles,
].join('');
