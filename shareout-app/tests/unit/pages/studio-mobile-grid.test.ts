import { describe, expect, it } from 'vitest';
import { WORKSPACE_NAV_STYLES } from '../../../src/pages/home/render-workspace/styles-nav';
import { WORKSPACE_AGENT_COMPOSER_STYLES } from '../../../src/pages/home/render-workspace/styles-agent-composer';

describe('Studio mobile grid', () => {
  it('body column can shrink below its content (1fr would overflow the viewport on phones)', () => {
    for (const css of [WORKSPACE_NAV_STYLES, WORKSPACE_AGENT_COMPOSER_STYLES]) {
      expect(css).not.toMatch(/\.wsx__body[^{]*\{\s*grid-template-columns:\s*1fr;/);
      expect(css).toMatch(/\.wsx__body[^{]*\{\s*grid-template-columns:\s*minmax\(0,\s*1fr\);/);
    }
  });

  it('account sub-screen hides the main menu above it', () => {
    expect(WORKSPACE_NAV_STYLES).toContain('.wsx__accpanel-body.is-sub > :not(.wsx__accscreen) { display: none; }');
  });
});
