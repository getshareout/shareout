import { describe, expect, it } from 'vitest';
import renderCanvasSrc from '../../../editor-client/src/canvas/render-canvas.ts?raw';
import yjsSyncSrc from '../../../editor-client/src/collab/yjs-element-sync.ts?raw';
import editorIndexSrc from '../../../src/editor/index.ts?raw';
import { renderEditorShell } from '../../../src/editor/page/template/shell';

describe('f37 editor canvas iframe', () => {
  it('CONFIRMS: canvas iframe has allow-same-origin + allow-scripts and no src/srcdoc', () => {
    const html = renderEditorShell({ slug: 'demo' });
    const tag = html.match(/<iframe[^>]*id="canvas-frame"[^>]*>/)![0];
    console.log('OBSERVED iframe tag:', tag.replace(/\s+/g, ' '));
    const sandbox = tag.match(/sandbox="([^"]*)"/)![1].split(/\s+/);
    expect(sandbox).toContain('allow-same-origin');
    expect(sandbox).toContain('allow-scripts');
    expect(tag).not.toMatch(/\ssrc=/);
    expect(tag).not.toMatch(/srcdoc=/);
  });

  it('CONFIRMS: artifact HTML is doc.write()n unsanitized into the iframe contentDocument', () => {
    const src = renderCanvasSrc;
    expect(src).toContain('doc.write(normalized.fullHtml)');
    expect(src).toContain('dom.canvasFrame.contentDocument');
    expect(src).not.toMatch(/sanitiz|DOMPurify/i);
  });

  it('CONFIRMS: remote collab ops are applied with innerHTML and no CSP is set by the editor module', () => {
    const sync = yjsSyncSrc;
    expect(sync).toMatch(/\.innerHTML = op\.html/);
    expect(editorIndexSrc).not.toMatch(/Content-Security-Policy/i);
  });
});
