import { stampEditorIdsOnBlocks, EDITOR_ID_ATTR, resolveElementBySelector } from '../dom/editor-ids';
import { createLogger } from '../editor/logger';
import type { EditorDom } from '../editor/types';
import type { MutationOp } from '../dom/mutation-observer';
import { injectCanvasEditorStyles } from './editor-styles';
import { injectSdkScript, syncCanvasFrameSize } from './render-canvas';

const log = createLogger('apply-html');

function extractBodyInnerHtml(html: string): string | null {
  const match = html.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  return match ? match[1] : null;
}

/**
 * Update canvas body in place when structure is compatible (avoids full doc.write).
 * Returns true if applied incrementally.
 */
export function applyHtmlToCanvasIncremental(
  dom: EditorDom,
  html: string
): boolean {
  const doc = dom.canvasFrame?.contentDocument;
  if (!doc?.body) return false;

  const bodyHtml = extractBodyInnerHtml(html);
  if (bodyHtml == null) return false;

  try {
    doc.body.innerHTML = bodyHtml;
    injectCanvasEditorStyles(doc);
    stampEditorIdsOnBlocks(doc);
    syncCanvasFrameSize(dom);
    log.debug('incremental body update', { bytes: bodyHtml.length });
    return true;
  } catch (err) {
    log.warn('incremental apply failed', err);
    return false;
  }
}

/** Full document replace when incremental update is not suitable. */
export function applyHtmlToCanvasFull(dom: EditorDom, html: string): Document | null {
  const doc = dom.canvasFrame?.contentDocument;
  if (!doc) return null;

  const withSdk = injectSdkScript(html);
  doc.open();
  doc.write(withSdk);
  doc.close();

  if (!doc.body) return null;

  injectCanvasEditorStyles(doc);
  stampEditorIdsOnBlocks(doc);
  syncCanvasFrameSize(dom);
  return doc;
}

/**
 * Apply granular element mutations from remote collaborators.
 * Returns number of successfully applied operations.
 */
export function applyElementUpdate(dom: EditorDom, ops: MutationOp[]): number {
  const doc = dom.canvasFrame?.contentDocument;
  if (!doc?.body) return 0;

  let applied = 0;

  for (const op of ops) {
    try {
      const success = applyOp(doc, op);
      if (success) applied++;
    } catch (err) {
      log.warn('element update op failed', { op, err });
    }
  }

  if (applied > 0) {
    syncCanvasFrameSize(dom);
  }

  log.debug('element update applied', { total: ops.length, applied });
  return applied;
}

function applyOp(doc: Document, op: MutationOp): boolean {
  switch (op.type) {
    case 'attr': {
      const el = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.id}"]`);
      if (!el) return false;

      if (op.value === null) {
        el.removeAttribute(op.name);
      } else {
        el.setAttribute(op.name, op.value);
      }
      return true;
    }

    case 'text': {
      const el = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.id}"]`);
      if (!el) return false;

      el.textContent = op.value;
      return true;
    }

    case 'insert': {
      const parent = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.parentId}"]`);
      if (!parent) return false;

      const temp = doc.createElement('div');
      temp.innerHTML = op.html;
      const el = temp.firstElementChild;
      if (!el) return false;

      const refChild = parent.children[op.index] || null;
      parent.insertBefore(el, refChild);
      return true;
    }

    case 'remove': {
      const el = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.id}"]`);
      if (!el) return false;

      el.remove();
      return true;
    }

    case 'move': {
      const el = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.id}"]`);
      const parent = resolveElementBySelector(doc, `[${EDITOR_ID_ATTR}="${op.parentId}"]`);
      if (!el || !parent) return false;

      const refChild = parent.children[op.index] || null;
      parent.insertBefore(el, refChild);
      return true;
    }

    default:
      return false;
  }
}
