export const DRAG_THRESHOLD_PX = 4;

export interface CanvasDragState {
  pending: boolean;
  isDragging: boolean;
  didDrag: boolean;
  element: HTMLElement | null;
  startX: number;
  startY: number;
  origLeft: number;
  origTop: number;
}

export function createCanvasDragState(): CanvasDragState {
  return {
    pending: false,
    isDragging: false,
    didDrag: false,
    element: null,
    startX: 0,
    startY: 0,
    origLeft: 0,
    origTop: 0,
  };
}

export function applyDragMove(
  state: CanvasDragState,
  e: MouseEvent
): { state: CanvasDragState; moved: boolean } {
  if (!state.pending || !state.element) {
    return { state, moved: false };
  }

  // Capture once: reassigning `state` below widens state.element back to nullable.
  const element = state.element;
  const dx = e.clientX - state.startX;
  const dy = e.clientY - state.startY;

  if (!state.isDragging) {
    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
      return { state, moved: false };
    }
    if (window.getComputedStyle(element).position === 'static') {
      element.style.position = 'relative';
    }
    state = { ...state, isDragging: true, didDrag: true };
  }

  element.style.left = `${state.origLeft + dx}px`;
  element.style.top = `${state.origTop + dy}px`;

  return { state, moved: true };
}

export function endDrag(state: CanvasDragState): CanvasDragState {
  return createCanvasDragState();
}
