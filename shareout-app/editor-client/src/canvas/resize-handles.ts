import { createLogger } from '../editor/logger';
import type { EditorDom } from '../editor/types';
import { renderSelectionHandles } from './selection';

const log = createLogger('resize');

export interface ResizeHandleDeps {
  dom: EditorDom;
  getSelected: () => Element | null;
  pushUndo: () => void;
  markDirty: () => void;
  updateHtmlFromCanvas: () => void;
}

export function setupResizeHandles(deps: ResizeHandleDeps): () => void {
  let resizeState = {
    isResizing: false,
    handle: '' as string,
    element: null as HTMLElement | null,
    startX: 0,
    startY: 0,
    startW: 0,
    startH: 0,
  };

  const onMouseDown = (e: MouseEvent) => {
    const target = e.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains('resize-handle')) {
      return;
    }

    const selected = deps.getSelected();
    if (!selected) return;

    const rect = selected.getBoundingClientRect();
    deps.pushUndo();

    resizeState = {
      isResizing: true,
      handle: target.dataset.handle || '',
      element: selected instanceof HTMLElement ? selected : null,
      startX: e.clientX,
      startY: e.clientY,
      startW: rect.width,
      startH: rect.height,
    };

    e.preventDefault();
    e.stopPropagation();
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!resizeState.isResizing || !resizeState.element) return;

    const dx = e.clientX - resizeState.startX;
    const dy = e.clientY - resizeState.startY;
    const { element, handle } = resizeState;

    let newW = resizeState.startW;
    let newH = resizeState.startH;

    if (handle.includes('e')) newW = resizeState.startW + dx;
    if (handle.includes('w')) newW = resizeState.startW - dx;
    if (handle.includes('s')) newH = resizeState.startH + dy;
    if (handle.includes('n')) newH = resizeState.startH - dy;

    element.style.width = `${Math.max(20, newW)}px`;
    element.style.height = `${Math.max(20, newH)}px`;
    renderSelectionHandles(element, deps.dom);
  };

  const onMouseUp = () => {
    if (resizeState.isResizing) {
      deps.markDirty();
      deps.updateHtmlFromCanvas();
      log.debug('resize committed');
    }
    resizeState = {
      isResizing: false,
      handle: '',
      element: null,
      startX: 0,
      startY: 0,
      startW: 0,
      startH: 0,
    };
  };

  // Use document with capture to catch resize-handle clicks reliably
  document.addEventListener('mousedown', onMouseDown, true);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  return () => {
    document.removeEventListener('mousedown', onMouseDown, true);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  };
}
