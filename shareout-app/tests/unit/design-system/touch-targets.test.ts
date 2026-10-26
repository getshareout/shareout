import { describe, it, expect } from 'vitest';
import lenses from '../../../src/pages/home/render-workspace/styles-lenses.ts?raw';
import canvas from '../../../src/pages/home/render-workspace/styles-canvas.ts?raw';
import sidebar from '../../../src/pages/home/render-workspace/styles-sidebar.ts?raw';
import drawer from '../../../src/design-system/pages/home/artifact-detail-drawer.css.ts?raw';
import cmdbar from '../../../src/design-system/pages/home/bulk-command-bar-liquid-glass.css.ts?raw';

describe('touch targets', () => {
  it('compact controls keep a 44px hit-area overlay', () => {
    expect(lenses).toMatch(/\.wsx-abtn::before/);
    expect(lenses).toMatch(/\.wsx-atbl__act::before/);
    expect(drawer).toMatch(/\.detail-iconbtn\.sm::before/);
    expect(cmdbar).toMatch(/\.cmdbar-clear::before/);
  });
  it('no sub-12px font sizes in the fixed selectors', () => {
    expect(canvas).not.toMatch(/\.wsx__evtier \{ font-size: 9px/);
    expect(sidebar).not.toMatch(/\.wsx-det__who \.role \{ font-size: 10px/);
  });
});
