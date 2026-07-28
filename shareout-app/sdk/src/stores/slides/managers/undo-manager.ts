import type { Slide } from '../types';

/**
 * Client-side undo/redo stack for slide list mutations.
 * State is held in-memory on the {@link Presentation} session; the server
 * is not rolled back — undo restores the last cached slide array snapshot.
 */
export class UndoManager {
  constructor(
    private undoStack: Slide[][],
    private redoStack: Slide[][],
    private onRestore: () => void,
  ) {}

  canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): void {
    if (this.undoStack.length === 0) return;
    const state = this.undoStack.pop()!;
    this.redoStack.push(state);
    this.onRestore();
  }

  redo(): void {
    if (this.redoStack.length === 0) return;
    const state = this.redoStack.pop()!;
    this.undoStack.push(state);
    this.onRestore();
  }
}
