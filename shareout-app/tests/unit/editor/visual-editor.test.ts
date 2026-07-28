import { describe, expect, it } from 'vitest';
import { generateEditorPage, type EditorPageOptions } from '../../../src/editor/visual-editor';

describe('visual-editor re-exports', () => {
  it('re-exports generateEditorPage from the page module', () => {
    const opts: EditorPageOptions = {
      artifactId: 'art_reexport',
      slug: 'reexport-test',
    };
    const html = generateEditorPage(opts);

    expect(html).toContain('art_reexport');
    expect(html).toContain('reexport-test');
  });
});
