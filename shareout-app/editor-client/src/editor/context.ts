// EditorCollabInstance is an ambient global declared in ../globals.d.ts (like EditorConfig).
import type * as Y from 'yjs';
import type { EditorDom, EditorState } from './types';
import type { Logger } from './logger';

export interface EditorContext {
  config: EditorConfig;
  state: EditorState;
  dom: EditorDom;
  log: Logger;
  /** Shared CRDT doc — DOM ↔ Yjs ↔ socket (one collab protocol). */
  yjsDoc: Y.Doc;
  collab: { instance: EditorCollabInstance | null };
  /** Re-attach canvas listeners after iframe document is replaced. */
  bindCanvasEvents: () => void;
  selectElement: (element: Element | null) => void;
  undo: () => void;
  redo: () => void;
  /** Apply a remote/AI DOM change without echoing it back to collaborators. */
  withCanvasMutationsPaused?: <T>(fn: () => T) => T;
}
