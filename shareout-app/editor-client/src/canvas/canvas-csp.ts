export const CANVAS_CSP_ATTR = 'data-so-canvas-csp';
const CANVAS_CSP = "script-src 'none'; object-src 'none'; base-uri 'none'";

export function withCanvasCsp(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const root = doc.documentElement;
  const head = doc.head ?? doc.createElement('head');
  root.insertBefore(head, root.firstChild);
  const meta = doc.createElement('meta');
  meta.setAttribute(CANVAS_CSP_ATTR, '');
  meta.setAttribute('http-equiv', 'Content-Security-Policy');
  meta.setAttribute('content', CANVAS_CSP);
  head.insertBefore(meta, head.firstChild);
  const standards = doc.doctype !== null || !/<(?:html|head)[\s>]/i.test(html);
  return `${standards ? '<!DOCTYPE html>' : ''}${root.outerHTML}`;
}

export function stripCanvasCsp(root: ParentNode): void {
  root.querySelectorAll(`meta[${CANVAS_CSP_ATTR}]`).forEach((el) => el.remove());
}
