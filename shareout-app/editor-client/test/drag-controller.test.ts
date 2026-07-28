import { describe, expect, it } from 'vitest';
import {
  applyDragMove,
  createCanvasDragState,
  DRAG_THRESHOLD_PX,
} from '../src/canvas/drag-controller';

function dragPending(el: HTMLElement, clientX = 0, clientY = 0) {
  return {
    ...createCanvasDragState(),
    pending: true,
    element: el,
    startX: clientX,
    startY: clientY,
    origLeft: 0,
    origTop: 0,
  };
}

describe('drag-controller', () => {
  it('does not drag until threshold exceeded', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const state = dragPending(el);

    const move = applyDragMove(state, { clientX: 1, clientY: 1 } as MouseEvent);
    expect(move.moved).toBe(false);
    expect(move.state.isDragging).toBe(false);
    expect(move.state.didDrag).toBe(false);

    document.body.removeChild(el);
  });

  it('starts drag after threshold', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);

    const state = dragPending(el);

    const move = applyDragMove(state, {
      clientX: DRAG_THRESHOLD_PX + 2,
      clientY: 0,
    } as MouseEvent);

    expect(move.moved).toBe(true);
    expect(move.state.isDragging).toBe(true);
    expect(move.state.didDrag).toBe(true);

    document.body.removeChild(el);
  });
});
