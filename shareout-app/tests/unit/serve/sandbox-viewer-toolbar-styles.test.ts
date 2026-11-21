// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TOOLBAR_STYLES } from '../../../src/serve/sandbox-viewer/toolbar/styles/index';
import { headerStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/header.css';
import { panelsStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/panels.css';
import { commentsOverlayStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/comments-overlay.css';
import { scheduleModalsStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/schedule-modals.css';
import { responsiveStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/responsive.css';

const SECTION_EXPORTS = [
  ['header', headerStyles],
  ['panels', panelsStyles],
  ['comments-overlay', commentsOverlayStyles],
  ['schedule-modals', scheduleModalsStyles],
  ['responsive', responsiveStyles],
] as const;

describe('sandbox viewer header styles', () => {
  it('concatenates the sections in DOM order', () => {
    expect(TOOLBAR_STYLES).toBe(SECTION_EXPORTS.map(([, css]) => css).join(''));
  });

  it('includes the header, side panels, schedule modal and phone layout', () => {
    expect(TOOLBAR_STYLES).toContain('#so-header');
    expect(TOOLBAR_STYLES).toContain('.so-hd__menu');
    expect(TOOLBAR_STYLES).toContain('.so-side');
    expect(TOOLBAR_STYLES).toContain('#so-comments-overlay.open');
    expect(TOOLBAR_STYLES).toContain('.so-sched-dest-grid');
    expect(TOOLBAR_STYLES).toContain('@media (max-width: 640px)');
  });

  it('drops the floating logo menu, its drag corners and the back-home pill', () => {
    expect(TOOLBAR_STYLES).not.toContain('#shareout-admin-toolbar');
    expect(TOOLBAR_STYLES).not.toContain('so-pos-br');
    expect(TOOLBAR_STYLES).not.toContain('#so-back-home');
    expect(TOOLBAR_STYLES).not.toContain('#so-admin-panel');
  });

  it('decomposes into focused section modules, each under 1000 lines of source', () => {
    for (const [name, section] of SECTION_EXPORTS) {
      expect(section.length, `${name} should export CSS`).toBeGreaterThan(20);
      expect(section.split('\n').length, `${name} section source`).toBeLessThanOrEqual(1000);
    }
  });
});
