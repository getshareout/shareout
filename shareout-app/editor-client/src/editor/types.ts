import type * as Y from 'yjs';
import type { ParsedManifest } from '../manifest/manifest-parser';

export type EditorTool = 'select' | 'lasso';
export type ViewportMode = 'desktop' | 'mobile';

export interface LassoContext {
  imageData: string;
  bounds: { x: number; y: number; w: number; h: number };
  elementsHtml: string;
  elementsCount: number;
  /** Short labels (tag#id.class) for each selected element, shown as pills in chat. */
  labels?: string[];
}

/** One history step: document HTML plus the selection active when it was captured. */
export interface UndoEntry {
  html: string;
  selectedEditorId: string | null;
}

export interface EditorState {
  html: string;
  selectedElement: Element | null;
  /** Stable id for restoring selection after undo/redo or remote updates. */
  selectedEditorId?: string | null;
  isDirty: boolean;
  tool: EditorTool;
  viewport: ViewportMode;
  contextElements: Array<{ selector: string }>;
  collaborators: unknown[];
  undoStack: UndoEntry[];
  redoStack: UndoEntry[];
  pendingChangeId?: string | null;
  pendingPatches?: Array<Record<string, unknown>> | null;
  pendingHtml?: string | null;
  pendingActions?: Array<Record<string, unknown>> | null;
  version?: number;
  /** updated_at of the draft we loaded — sent back for optimistic-concurrency saves (F1). */
  draftUpdatedAt?: string;
  lassoContext?: LassoContext | null;
  /** Parsed manifest from <script type="shareout/manifest"> */
  manifest?: ParsedManifest | null;
  /** Yjs UndoManager for collaborative undo (local-only operations) */
  collabUndoManager?: Y.UndoManager | null;
}

export function createInitialEditorState(): EditorState {
  return {
    html: '',
    selectedElement: null,
    selectedEditorId: null,
    isDirty: false,
    tool: 'select',
    viewport: 'desktop',
    contextElements: [],
    collaborators: [],
    undoStack: [],
    redoStack: [],
    manifest: null,
  };
}

export interface EditorDom {
  canvasFrame: HTMLIFrameElement;
  selectionOverlay: HTMLElement;
  cursorOverlay: HTMLElement | null;
  floatingMenu: HTMLElement | null;
  floatingToolbar: HTMLElement | null;
  stylePopover: HTMLElement | null;
  studioRail: HTMLElement | null;
  railSuggestions: HTMLElement | null;
  propertyPanel: HTMLElement | null;
  dataBrowser: HTMLElement | null;
  chatContainer: HTMLElement | null;
  chatMessages: HTMLElement | null;
  chatInput: HTMLTextAreaElement | null;
  chatContextChips: HTMLElement | null;
  workspaceMenu: HTMLElement | null;
  workspaceDrawer: HTMLElement | null;
  drawerContent: HTMLElement | null;
  drawerTitle: HTMLElement | null;
  saveStatus: HTMLElement | null;
}
