/** Stable identity for canvas elements (collab locks, undo selection restore). */
export const EDITOR_ID_ATTR = 'data-editor-id';

export function createEditorId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ed-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
}

export function ensureEditorId(element: Element): string {
  const existing = element.getAttribute(EDITOR_ID_ATTR);
  if (existing) return existing;
  const id = createEditorId();
  element.setAttribute(EDITOR_ID_ATTR, id);
  return id;
}

/** Stable selector for collab locks/selection and AI patches (survives structural edits). */
export function getStableSelector(element: Element): string {
  return `[${EDITOR_ID_ATTR}="${ensureEditorId(element)}"]`;
}

/** Resolve selector from collab/AI — prefers stable editor id. */
export function resolveElementBySelector(root: ParentNode, selector: string): Element | null {
  if (!selector) return null;

  const editorIdMatch = selector.match(/^\[data-editor-id="([^"]+)"\]$/);
  if (editorIdMatch) {
    const escaped = CSS.escape(editorIdMatch[1]);
    return root.querySelector(`[${EDITOR_ID_ATTR}="${escaped}"]`);
  }

  try {
    return root.querySelector(selector);
  } catch {
    return null;
  }
}

const STAMP_SELECTOR = [
  // Block elements
  'p,h1,h2,h3,h4,h5,h6,div,section,article,aside,address,pre,blockquote',
  // Semantic structure
  'header,footer,nav,main,figure,figcaption,details,summary',
  // Lists
  'ul,ol,li,dl,dt,dd',
  // Tables
  'table,thead,tbody,tfoot,tr,td,th,caption',
  // Form elements
  'form,fieldset,legend,input,textarea,select,option,optgroup,button,label',
  // Media
  'img,video,audio,source,picture,iframe,embed,object,canvas,svg',
  // Inline formatting (for text CRDT)
  'span,a,b,i,em,strong,code,small,mark,del,ins,u,s,sub,sup,abbr,cite,q,time',
  // Other
  'hr,br,dialog',
].join(',');

/** Assign ids to common editable blocks when loading HTML (for legacy artifacts). */
export function stampEditorIdsOnBlocks(doc: Document): void {
  doc.querySelectorAll(`${STAMP_SELECTOR}:not([${EDITOR_ID_ATTR}])`).forEach((node) => {
    if (node instanceof Element) ensureEditorId(node);
  });
}

const EDITOR_ONLY_ATTRS = [EDITOR_ID_ATTR, 'data-locked-by', 'data-editor-hover', 'data-editor-selected'];

/**
 * Strip editor-internal attributes from serialized HTML before saving/publishing.
 * They live on the live canvas DOM (collab locks, undo selection restore) but must
 * never leak into the saved/published artifact. Returns a cleaned copy; the live
 * `state.html` keeps its ids so undo/collab identity is preserved.
 */
export function stripEditorAttributes(html: string): string {
  if (!html) return html;
  try {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    for (const attr of EDITOR_ONLY_ATTRS) {
      parsed.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
    }
    const prefix = /^\s*<!doctype/i.test(html) ? '<!DOCTYPE html>' : '';
    return prefix + parsed.documentElement.outerHTML;
  } catch {
    return html;
  }
}
