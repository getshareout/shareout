export const CANVAS_CSP_ATTR = 'data-so-canvas-csp';
const CANVAS_CSP_META = `<meta ${CANVAS_CSP_ATTR} http-equiv="Content-Security-Policy" content="script-src 'none'; object-src 'none'; base-uri 'none'">`;

export function withCanvasCsp(html: string): string {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + CANVAS_CSP_META);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${CANVAS_CSP_META}</head>`);
  return `<!doctype html><html><head>${CANVAS_CSP_META}</head><body>${html}</body></html>`;
}

export function stripCanvasCsp(root: ParentNode): void {
  root.querySelectorAll(`meta[${CANVAS_CSP_ATTR}]`).forEach((el) => el.remove());
}
