import { createLogger } from './logger';
import type { EditorDom } from './types';

const log = createLogger('dom');

const REQUIRED_KEYS: Array<keyof EditorDom> = [
  'canvasFrame',
  'selectionOverlay',
];

export function collectEditorDom(): EditorDom {
  const canvasFrame = document.getElementById('canvas-frame') as HTMLIFrameElement | null;
  const selectionOverlay = document.getElementById('selection-overlay');

  const dom: EditorDom = {
    canvasFrame: canvasFrame!,
    selectionOverlay: selectionOverlay!,
    cursorOverlay: document.getElementById('cursor-overlay'),
    floatingMenu: document.getElementById('floating-menu'),
    floatingToolbar: document.getElementById('floating-toolbar'),
    stylePopover: document.getElementById('style-popover'),
    studioRail: document.getElementById('studio-rail'),
    railSuggestions: document.getElementById('rail-suggestions'),
    propertyPanel: document.getElementById('property-panel'),
    dataBrowser: document.getElementById('data-browser'),
    chatContainer: document.getElementById('studio-rail'),
    chatMessages: document.getElementById('chat-messages'),
    chatInput: document.getElementById('chat-input') as HTMLTextAreaElement | null,
    chatContextChips: document.getElementById('chat-context-chips'),
    workspaceMenu: document.getElementById('workspace-menu'),
    workspaceDrawer: document.getElementById('workspace-drawer'),
    drawerContent: document.getElementById('drawer-content'),
    drawerTitle: document.getElementById('drawer-title'),
    saveStatus: document.getElementById('save-status'),
  };

  for (const key of REQUIRED_KEYS) {
    if (!dom[key]) {
      log.error(`Missing required DOM element: #${key === 'canvasFrame' ? 'canvas-frame' : key}`);
    }
  }

  return dom;
}
