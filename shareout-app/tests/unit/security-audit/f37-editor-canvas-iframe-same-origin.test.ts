import { describe, expect, it } from 'vitest';
import { renderEditorShell } from '../../../src/editor/page/template/shell';

describe('f37 editor canvas iframe', () => {
  it('blocks: canvas sandbox no longer escapes into popups', () => {
    const tag = renderEditorShell({ slug: 'demo' }).match(/<iframe[^>]*id="canvas-frame"[^>]*>/)![0];
    const sandbox = tag.match(/sandbox="([^"]*)"/)![1].split(/\s+/);
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-popups-to-escape-sandbox');
  });
});
