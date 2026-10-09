// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { homePageComponents } from '../../../src/design-system/pages/home/index';
import { homePageStyles } from '../../../src/design-system/pages/home.css';

describe('home page styles', () => {
  it('exports a non-empty stylesheet from the barrel', () => {
    expect(homePageComponents.length).toBeGreaterThan(0);
    expect(homePageStyles.length).toBeGreaterThan(homePageComponents.length);
  });

  it('includes signature layout and interaction sections', () => {
    expect(homePageComponents).toContain('.shell {');
    expect(homePageComponents).toContain('.artifact-card {');
    expect(homePageComponents).toContain('.detail-drawer {');
    expect(homePageComponents).toContain('.lib-modal {');
    expect(homePageComponents).toContain('@media (prefers-reduced-motion: reduce)');
  });
});
