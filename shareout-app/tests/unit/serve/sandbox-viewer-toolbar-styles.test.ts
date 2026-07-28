// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { TOOLBAR_STYLES } from '../../../src/serve/sandbox-viewer/toolbar/styles/index';
import { toolbarShellStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/toolbar-shell.css';
import { backHomeStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/back-home.css';
import { statsSkillsOverlayStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/stats-skills-overlay.css';
import { adminOverlayStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/admin-overlay.css';
import { commentsOverlayStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/comments-overlay.css';
import { scheduleModalsStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/schedule-modals.css';
import { responsiveStyles } from '../../../src/serve/sandbox-viewer/toolbar/styles/responsive.css';

/** Byte length of the monolithic toolbar stylesheet at decomposition time. */
const ORIGINAL_STYLE_BYTE_LENGTH = 38_027;

/** SHA-256 of the concatenated CSS body (regression guard). */
const ORIGINAL_STYLE_SHA256 =
  '3e421794199e82bf9caddb467457c708b5bfd71a86989a7dce88330931d6a9ef';

const SECTION_EXPORTS = [
  ['toolbar-shell', toolbarShellStyles],
  ['back-home', backHomeStyles],
  ['stats-skills', statsSkillsOverlayStyles],
  ['admin-overlay', adminOverlayStyles],
  ['comments-overlay', commentsOverlayStyles],
  ['schedule-modals', scheduleModalsStyles],
  ['responsive', responsiveStyles],
] as const;

async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

describe('sandbox viewer toolbar styles', () => {
  it('exports a non-empty stylesheet from the barrel', () => {
    expect(TOOLBAR_STYLES.length).toBe(ORIGINAL_STYLE_BYTE_LENGTH);
  });

  it('includes signature toolbar, overlay, and mobile sections', () => {
    expect(TOOLBAR_STYLES).toContain('#shareout-admin-toolbar');
    expect(TOOLBAR_STYLES).toContain('#so-comments-overlay');
    expect(TOOLBAR_STYLES).toContain('.so-sched-dest-grid');
    expect(TOOLBAR_STYLES).toContain('@media (max-width: 640px)');
    expect(TOOLBAR_STYLES).toContain('@keyframes so-trig-spin');
  });

  it('decomposes into focused section modules, each under 1000 lines of source', () => {
    for (const [name, section] of SECTION_EXPORTS) {
      expect(section.length, `${name} should export CSS`).toBeGreaterThan(20);
      const lineCount = section.split('\n').length;
      expect(lineCount, `${name} section source`).toBeLessThanOrEqual(1000);
    }
  });

  it('preserves the original monolithic CSS body byte-for-byte', async () => {
    expect(TOOLBAR_STYLES.length).toBe(ORIGINAL_STYLE_BYTE_LENGTH);
    expect(await sha256(TOOLBAR_STYLES)).toBe(ORIGINAL_STYLE_SHA256);
  });
});
