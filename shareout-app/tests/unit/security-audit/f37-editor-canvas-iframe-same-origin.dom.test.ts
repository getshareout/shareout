// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { withCanvasCsp, stripCanvasCsp } from '../../../editor-client/src/canvas/canvas-csp';
import { applyHtmlToCanvasFull } from '../../../editor-client/src/canvas/apply-html';
import { renderCanvas } from '../../../editor-client/src/canvas/render-canvas';
import { updateHtmlFromCanvas } from '../../../editor-client/src/history/html-sync';
import { stripEditorAttributes } from '../../../editor-client/src/dom/editor-ids';

const CSP = `script-src 'none'; object-src 'none'; base-uri 'none'`;
const PAGE = '<!doctype html><html><head><title>t</title></head><body><p>hi</p><script>window.x=1</script></body></html>';

function frame(): HTMLIFrameElement {
  const f = document.createElement('iframe');
  document.body.appendChild(f);
  return f;
}

describe('f37 editor canvas iframe', () => {
  it('blocks: CSP meta is the first child of head in every written doc', () => {
    expect(withCanvasCsp(PAGE)).toMatch(/<head><meta [^>]*content="script-src 'none'; object-src 'none'; base-uri 'none'"><title>/);
    for (const html of ['<html><body>x</body></html>', '<header>x</header>', '<html><!--<head>--><head></head><body></body></html>']) {
      const head = new DOMParser().parseFromString(withCanvasCsp(html), 'text/html').head;
      expect((head.firstChild as Element).getAttribute('content')).toBe(CSP);
    }

    const f = frame();
    const dom = { canvasFrame: f } as never;
    const doc = renderCanvas({ html: PAGE, manifest: null } as never, dom, { skipLoadingState: true })!;
    expect(doc.head.firstElementChild?.getAttribute('content')).toBe(CSP);

    const doc2 = applyHtmlToCanvasFull(dom, PAGE)!;
    expect(doc2.head.firstElementChild?.getAttribute('content')).toBe(CSP);
  });

  it('blocks: CSP meta never reaches serialized or saved HTML', () => {
    const f = frame();
    const dom = { canvasFrame: f } as never;
    renderCanvas({ html: PAGE, manifest: null } as never, dom, { skipLoadingState: true });
    expect(f.contentDocument!.querySelector('meta[http-equiv]')).not.toBeNull();

    const state = { html: '' };
    updateHtmlFromCanvas(state as never, f);
    expect(state.html).not.toMatch(/Content-Security-Policy/i);
    expect(state.html).toContain('<p');

    expect(stripEditorAttributes(withCanvasCsp(PAGE))).not.toMatch(/Content-Security-Policy/i);

    const d = new DOMParser().parseFromString(withCanvasCsp(PAGE), 'text/html');
    stripCanvasCsp(d);
    expect(d.querySelector('meta[http-equiv]')).toBeNull();
  });

  it('keeps an artifact-authored CSP meta intact on save', () => {
    const own = '<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="img-src *"></head><body></body></html>';
    expect(stripEditorAttributes(own)).toContain('img-src *');
  });
});
