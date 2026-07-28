import { BINDING_ATTR } from '../sdk-patterns';

/** Tags that cannot be selected in the visual editor. */
export const NON_SELECTABLE_TAGS = new Set([
  'html', 'head', 'body', 'script', 'style', 'meta', 'link', 'title', 'br', 'hr',
]);

/** Block-level tags eligible as selection targets (innermost match wins). */
export const BLOCK_SELECT_TAGS = new Set([
  'section', 'article', 'aside', 'nav', 'header', 'footer', 'main',
  'div', 'figure', 'form', 'fieldset', 'blockquote', 'ul', 'ol', 'table',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'img', 'button', 'a',
  'video', 'canvas', 'svg', 'iframe', 'picture', 'li', 'td', 'th',
  'span', 'strong', 'em', 'b', 'i', 'label', 'small', 'code',
  'input', 'textarea', 'select', 'details', 'summary', 'pre', 'dl', 'dt', 'dd',
]);

/** Check if an element has a data binding */
export function hasBoundData(el: Element): boolean {
  return el.hasAttribute(BINDING_ATTR);
}

export interface SelectionTargetContext {
  body: Element;
  documentElement: Element;
}

/**
 * Check if target is an Element (cross-iframe safe).
 * Using nodeType instead of instanceof because iframe elements
 * have different constructors than the parent document.
 */
function isElement(target: EventTarget | null): target is Element {
  return target !== null && (target as Node).nodeType === 1;
}

/**
 * Walk up from the click target to the innermost selectable block element.
 */
export function resolveSelectTarget(
  raw: EventTarget | null,
  ctx: SelectionTargetContext
): Element | null {
  if (!isElement(raw)) return null;
  if (raw === ctx.body || raw === ctx.documentElement) return null;

  let el: Element | null = raw;
  let genericFallback: Element | null = null;

  while (el && el !== ctx.body && el !== ctx.documentElement) {
    const tag = el.tagName.toLowerCase();
    const hasBinding = hasBoundData(el);

    if (NON_SELECTABLE_TAGS.has(tag)) return null;
    if (hasBinding) return el;
    if (BLOCK_SELECT_TAGS.has(tag) || el.hasAttribute('data-shareout-chart')) return el;
    if ((el as Node).nodeType === 1) genericFallback = el;
    el = el.parentElement;
  }

  return genericFallback;
}

/**
 * Element under viewport coordinates inside the canvas iframe document.
 */
export function getCanvasElementAt(
  clientX: number,
  clientY: number,
  canvasFrame: HTMLIFrameElement,
  ctx: SelectionTargetContext
): Element | null {
  const doc = canvasFrame.contentDocument;
  const win = canvasFrame.contentWindow;
  if (!doc || !win) return null;

  const frameRect = canvasFrame.getBoundingClientRect();
  const x = clientX - frameRect.left;
  const y = clientY - frameRect.top;

  if (x < 0 || y < 0 || x > frameRect.width || y > frameRect.height) return null;

  const raw = doc.elementFromPoint(x, y);
  return raw ? resolveSelectTarget(raw, ctx) : null;
}

export function getSelectionContext(doc: Document): SelectionTargetContext | null {
  if (!doc.body || !doc.documentElement) return null;
  return { body: doc.body, documentElement: doc.documentElement };
}
