// Drag-to-reorder elements in HTML flow (opt-in via data-shareout-sortable on the container).
// Mirrors resize-handles: a handle lives in the parent overlay; we mutate the real iframe DOM,
// so collaboration (MutationObserver→Yjs), undo, and autosave all come along for free.
import { createLogger } from '../editor/logger';
import type { EditorDom } from '../editor/types';
import { renderSelectionHandles } from './selection';
import { SORTABLE_ATTR } from '../sdk-patterns';

const log = createLogger('reorder');

export interface ReorderDeps {
  dom: EditorDom;
  getSelected: () => Element | null;
  pushUndo: () => void;
  markDirty: () => void;
  updateHtmlFromCanvas: () => void;
}

/** A container opts its children into reordering. Returns axis, or null if not sortable. */
export function sortableAxis(el: Element | null): 'x' | 'y' | null {
  const parent = el?.parentElement;
  if (!parent || !parent.hasAttribute(SORTABLE_ATTR)) return null;
  return parent.getAttribute(SORTABLE_ATTR) === 'x' ? 'x' : 'y';
}

export function setupReorderHandle(deps: ReorderDeps): () => void {
  let dragging = false;
  let element: Element | null = null;
  let container: Element | null = null;
  let axis: 'x' | 'y' = 'y';
  let insertRef: Element | null = null;
  let indicator: HTMLElement | null = null;

  const getIndicator = (): HTMLElement | null => {
    if (!deps.dom.selectionOverlay) return null;
    if (!indicator) {
      indicator = document.createElement('div');
      indicator.className = 'drop-indicator';
      deps.dom.selectionOverlay.appendChild(indicator);
    }
    return indicator;
  };

  const hideIndicator = () => {
    if (indicator) indicator.style.display = 'none';
  };

  const onMouseDown = (e: MouseEvent) => {
    const target = e.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('drag-handle')) return;

    const selected = deps.getSelected();
    const a = sortableAxis(selected);
    if (!selected || !a) return;

    deps.pushUndo();
    dragging = true;
    element = selected;
    container = selected.parentElement;
    axis = a;
    insertRef = selected.nextElementSibling; // default: stay put
    e.preventDefault();
    e.stopPropagation();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!dragging || !element || !container) return;

    const frameRect = deps.dom.canvasFrame.getBoundingClientRect();
    const siblings = Array.from(container.children).filter(
      (c) => c !== element && (c as Node).nodeType === 1
    ) as Element[];

    let ref: Element | null = null;
    for (const sib of siblings) {
      const r = sib.getBoundingClientRect();
      const mid = axis === 'x' ? frameRect.left + r.left + r.width / 2 : frameRect.top + r.top + r.height / 2;
      const pos = axis === 'x' ? e.clientX : e.clientY;
      if (pos < mid) { ref = sib; break; }
    }
    insertRef = ref;
    drawIndicator(ref, siblings, frameRect);
  };

  const drawIndicator = (ref: Element | null, siblings: Element[], frameRect: DOMRect) => {
    const ind = getIndicator();
    const overlay = deps.dom.selectionOverlay;
    if (!ind || !overlay || !container) return;

    const oRect = overlay.getBoundingClientRect();
    const cRect = container.getBoundingClientRect();
    const last = siblings[siblings.length - 1];
    ind.style.display = 'block';

    if (axis === 'y') {
      const r = ref ? ref.getBoundingClientRect() : last?.getBoundingClientRect();
      const yScreen = ref ? frameRect.top + (r?.top ?? 0) : frameRect.top + (r?.bottom ?? cRect.bottom);
      ind.style.left = `${frameRect.left + cRect.left - oRect.left}px`;
      ind.style.top = `${yScreen - oRect.top - 1}px`;
      ind.style.width = `${cRect.width}px`;
      ind.style.height = '2px';
    } else {
      const r = ref ? ref.getBoundingClientRect() : last?.getBoundingClientRect();
      const xScreen = ref ? frameRect.left + (r?.left ?? 0) : frameRect.left + (r?.right ?? cRect.right);
      ind.style.top = `${frameRect.top + cRect.top - oRect.top}px`;
      ind.style.left = `${xScreen - oRect.left - 1}px`;
      ind.style.height = `${cRect.height}px`;
      ind.style.width = '2px';
    }
  };

  const onMouseUp = () => {
    if (dragging && element && container) {
      if (insertRef !== element.nextElementSibling) {
        container.insertBefore(element, insertRef);
        deps.markDirty();
        deps.updateHtmlFromCanvas();
        renderSelectionHandles(element, deps.dom);
        log.debug('reordered', { axis });
      }
      hideIndicator();
    }
    dragging = false;
    element = null;
    container = null;
  };

  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  return () => {
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    indicator?.remove();
    indicator = null;
  };
}
