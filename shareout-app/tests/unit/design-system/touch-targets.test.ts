import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const rd = (p: string) => readFileSync(new URL(`../../../src/${p}`, import.meta.url), 'utf8');

describe('touch targets', () => {
  it('compact controls keep a 44px hit-area overlay', () => {
    const lenses = rd('pages/home/render-workspace/styles-lenses.ts');
    expect(lenses).toMatch(/\.wsx-abtn::before/);
    expect(lenses).toMatch(/\.wsx-atbl__act::before/);
    expect(rd('design-system/pages/home/artifact-detail-drawer.css.ts')).toMatch(/\.detail-iconbtn\.sm::before/);
    expect(rd('design-system/pages/home/bulk-command-bar-liquid-glass.css.ts')).toMatch(/\.cmdbar-clear::before/);
  });
  it('no sub-12px font sizes in the fixed selectors', () => {
    expect(rd('pages/home/render-workspace/styles-canvas.ts')).not.toMatch(/\.wsx__evtier \{ font-size: 9px/);
    expect(rd('pages/home/render-workspace/styles-sidebar.ts')).not.toMatch(/\.wsx-det__who \.role \{ font-size: 10px/);
  });
});
