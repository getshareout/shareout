import { createLogger } from '../editor/logger';
import type { EditorState, UndoEntry } from '../editor/types';

const log = createLogger('undo');

const MAX_UNDO = 50;
const UNDO_DEBOUNCE_MS = 300;

let undoDebounceTimer: ReturnType<typeof setTimeout> | null = null;
let undoGroupOpen = false;

function snapshot(state: EditorState): UndoEntry {
  return { html: state.html, selectedEditorId: state.selectedEditorId ?? null };
}

export function pushUndoImmediate(state: EditorState): void {
  if (state.collabUndoManager) return;

  // Undo tracks CONTENT, not selection. If the document hasn't changed since the
  // last snapshot, skip — otherwise selecting/entering-edit alone would create
  // no-op steps and undo would just cycle selections.
  const last = state.undoStack[state.undoStack.length - 1];
  if (last && last.html === state.html) {
    return;
  }

  state.undoStack.push(snapshot(state));
  state.redoStack = [];
  if (state.undoStack.length > MAX_UNDO) {
    state.undoStack.shift();
  }
  undoGroupOpen = false;
  clearUndoDebounce();
  log.debug('undo pushed (immediate)', { depth: state.undoStack.length });
}

export function captureUndoSnapshot(state: EditorState): void {
  if (state.collabUndoManager) return;

  if (!undoGroupOpen) {
    pushUndoImmediate(state);
    undoGroupOpen = true;
  }
  clearUndoDebounce();
  undoDebounceTimer = setTimeout(() => {
    undoGroupOpen = false;
    undoDebounceTimer = null;
  }, UNDO_DEBOUNCE_MS);
}

/** @deprecated Prefer captureUndoSnapshot for edits; pushUndoImmediate for AI/full replace. */
export function pushUndo(state: EditorState): void {
  captureUndoSnapshot(state);
}

export function clearUndoDebounce(): void {
  if (undoDebounceTimer) {
    clearTimeout(undoDebounceTimer);
    undoDebounceTimer = null;
  }
}

export function flushUndoDebounce(): void {
  clearUndoDebounce();
  undoGroupOpen = false;
}

export function undo(state: EditorState): UndoEntry | null {
  if (state.collabUndoManager) {
    state.collabUndoManager.undo();
    log.info('collab undo');
    return null;
  }

  flushUndoDebounce();
  // Discard any entries that match the current content (selection-only no-ops)
  // so undo always lands on a real content change.
  while (state.undoStack.length && state.undoStack[state.undoStack.length - 1].html === state.html) {
    state.undoStack.pop();
  }
  if (state.undoStack.length === 0) return null;
  state.redoStack.push(snapshot(state));
  const prev = state.undoStack.pop()!;
  log.info('undo', { depth: state.undoStack.length });
  return prev;
}

export function redo(state: EditorState): UndoEntry | null {
  if (state.collabUndoManager) {
    state.collabUndoManager.redo();
    log.info('collab redo');
    return null;
  }

  flushUndoDebounce();
  while (state.redoStack.length && state.redoStack[state.redoStack.length - 1].html === state.html) {
    state.redoStack.pop();
  }
  if (state.redoStack.length === 0) return null;
  state.undoStack.push(snapshot(state));
  const next = state.redoStack.pop()!;
  log.info('redo', { depth: state.redoStack.length });
  return next;
}
