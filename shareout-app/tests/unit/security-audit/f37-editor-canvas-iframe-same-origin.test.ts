import { describe, expect, it } from 'vitest';
import { withCanvasCsp } from '../../../editor-client/src/canvas/canvas-csp';
import { renderEditorShell } from '../../../src/editor/page/template/shell';

describe('f37 editor canvas iframe', () => {
  it('blocks: canvas sandbox no longer escapes into popups', () => {
    const tag = renderEditorShell({ slug: 'demo' }).match(/<iframe[^>]*id="canvas-frame"[^>]*>/)![0];
    const sandbox = tag.match(/sandbox="([^"]*)"/)![1].split(/\s+/);
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).not.toContain('allow-popups-to-escape-sandbox');
  });

  it('blocks: CSP meta is injected as first child of head', () => {
    const csp = `<meta data-so-canvas-csp http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'">`;
    expect(withCanvasCsp('<html><head><title>t</title></head><body></body></html>')).toContain(`<head>${csp}<title>`);
    expect(withCanvasCsp('<html><body>x</body></html>')).toContain(csp);
  });
});
