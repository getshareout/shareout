// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import { titleAttrForType } from '../src/outline/outline-panel';

describe('titleAttrForType', () => {
  it('maps page/section/tab to their ShareOut title attributes', () => {
    expect(titleAttrForType('page')).toBe('data-shareout-page-title');
    expect(titleAttrForType('section')).toBe('data-shareout-section-title');
    expect(titleAttrForType('tab')).toBe('data-shareout-tab-title');
  });

  it('returns null for non-renamable node types', () => {
    expect(titleAttrForType('heading')).toBeNull();
    expect(titleAttrForType('landmark')).toBeNull();
    expect(titleAttrForType('whatever')).toBeNull();
  });
});
