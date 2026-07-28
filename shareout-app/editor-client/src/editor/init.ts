import * as Y from 'yjs';
import { showToast } from '../toast';
import { observeCanvasResize, setupCanvasEvents } from '../canvas/canvas-events';
import { renderCanvas } from '../canvas/render-canvas';
import { applyHtmlToCanvasFull, applyHtmlToCanvasIncremental, applyElementUpdate } from '../canvas/apply-html';
import { selectElement as selectElementImpl } from '../canvas/selection';
import { getStableSelector, resolveElementBySelector } from '../dom/editor-ids';
import { syncHtmlFromCanvas } from '../history/html-sync';
import {
  captureUndoSnapshot,
  undo as popUndo,
  redo as popRedo,
} from '../history/undo-redo';
import { initDroppedCharts } from '../charts/chart-init';
import { setupToolbarEvents } from '../toolbar/toolbar-events';
import { setupKeyboardShortcuts } from '../toolbar/keyboard-shortcuts';
import { setupChatEvents } from '../chat/chat';
import { setupStudioRail, railOnSelection } from '../rail/rail';
import { setupFormatToolbar, bindFormatToolbar } from '../text/format-toolbar';
import { setupTopbarAutohide, bindTopbarAutohide } from '../toolbar/topbar-autohide';
import { openRailPanel } from '../rail/rail-panels';
import { initPalette } from '../palette/palettes';
import {
  markDirty,
  saveDraft,
  publish,
  openPreview,
  setupDraftLifecycle,
} from '../persistence/draft';
import {
  renderCollaborators,
  connectWebSocket,
  broadcastSelection,
  canEditElement,
} from '../collab/collaboration';
import { collectEditorDom } from './dom';
import { createLogger } from './logger';
import { createInitialEditorState } from './types';
import { parseManifest } from '../manifest/manifest-parser';
import { refreshValidityChip } from '../validation/validity-chip';
import { CanvasMutationObserver } from '../dom/mutation-observer';
import { ElementSyncManager } from '../collab/yjs-element-sync';
import { TextCrdtManager } from '../collab/text-crdt';
import type { EditorContext } from './context';

const log = createLogger('init');

export function bootEditor(): void {
  log.info('bootEditor: start');

  const config = window.EDITOR_CONFIG;
  if (!config?.artifactId) {
    log.error('Missing EDITOR_CONFIG', config);
    throw new Error('EDITOR_CONFIG.artifactId is required');
  }

  const shareOutGlobal = window.ShareOut;
  const shareOutObj = shareOutGlobal as
    | { default?: new () => unknown; ShareOut?: new () => unknown }
    | undefined;
  const ShareOutClass =
    typeof shareOutGlobal === 'function' ? shareOutGlobal : shareOutObj?.default ?? shareOutObj?.ShareOut;
  if (!ShareOutClass || typeof ShareOutClass !== 'function') {
    log.error('ShareOut SDK not loaded');
    document.body.innerHTML =
      '<div style="padding:40px;text-align:center;color:red;">Error: ShareOut SDK failed to load.</div>';
    throw new Error('ShareOut SDK not loaded');
  }

  const dom = collectEditorDom();
  log.debug('DOM collected', {
    hasCanvasFrame: !!dom.canvasFrame,
    hasSelectionOverlay: !!dom.selectionOverlay,
    hasFloatingMenu: !!dom.floatingMenu,
    hasChatContainer: !!dom.chatContainer,
  });

  const state = createInitialEditorState();
  log.debug('Initial state', {
    tool: state.tool,
    hasHtml: !!state.html,
    selectedElement: state.selectedElement,
  });

  let cleanupCanvasEvents: (() => void) | null = null;
  let cleanupCanvasResize: (() => void) | null = null;
  let cleanupDraftLifecycle: (() => void) | null = null;
  let cleanupMutationObserver: (() => void) | null = null;

  // Yjs document for CRDT-based collaboration
  const yjsDoc = new Y.Doc();

  const ctx: EditorContext & {
    selectElement: (el: Element | null) => void;
    undo: () => void;
    redo: () => void;
  } = {
    config,
    state,
    dom,
    log: createLogger('editor'),
    yjsDoc,
    collab: { instance: null },
    bindCanvasEvents: () => {},
    selectElement: () => {},
    undo: () => {},
    redo: () => {},
    withCanvasMutationsPaused: (fn) => fn(),
  };

  // Element-level sync manager (DOM ↔ Yjs)
  const elementSyncManager = new ElementSyncManager({
    userId: config.userId ?? '',
    doc: yjsDoc,
    getCanvasDocument: () => dom.canvasFrame?.contentDocument ?? null,
    onRemoteUpdate: (ops) => {
      // Apply remote ops with the observer suppressed so they aren't re-broadcast (echo).
      const applied = ctx.withCanvasMutationsPaused?.(() => applyElementUpdate(dom, ops)) ?? 0;
      if (applied > 0) {
        log.debug('Applied remote element updates', { count: applied });
      }
    },
  });

  // Text CRDT manager for character-level sync
  const textCrdtManager = new TextCrdtManager({
    userId: config.userId ?? '',
    doc: yjsDoc,
    getCanvasDocument: () => dom.canvasFrame?.contentDocument ?? null,
    onTextCursorUpdate: (elementId, offset) => {
      ctx.collab.instance?.updateTextCursor(elementId, offset);
    },
  });

  // MutationObserver for DOM changes → Yjs sync
  const mutationObserver = new CanvasMutationObserver((batch) => {
    // Local DOM change → shared Y.Doc; the doc's update event ships it over the
    // socket as a binary Yjs frame (see EditorCollab.attachDoc).
    elementSyncManager.applyLocalMutations(batch);
  });

  // Now that the observer exists, let remote/AI apply paths (in other modules)
  // suppress the echo via ctx.
  ctx.withCanvasMutationsPaused = (fn) => mutationObserver.suppressDuring(fn);

  ctx.selectElement = (element) => {
    selectElementImpl(element, {
      state: ctx.state,
      dom: ctx.dom,
      broadcastSelection: (el) => broadcastSelection(ctx, el),
    });
    railOnSelection(ctx, ctx.state.selectedElement);
  };

  const restoreSelectionAfterHistory = (restoreId: string | null) => {
    if (!restoreId) {
      ctx.selectElement(null);
      return;
    }
    const doc = ctx.dom.canvasFrame.contentDocument;
    const el = doc
      ? resolveElementBySelector(doc, `[data-editor-id="${restoreId}"]`)
      : null;
    ctx.selectElement(el);
  };

  // Apply a history entry as a targeted DOM update; only fall back to a full
  // document rewrite (and listener rebind) when the structure is incompatible.
  const applyHistoryEntry = (entry: { html: string; selectedEditorId: string | null }) => {
    ctx.state.html = entry.html;
    ctx.state.selectedEditorId = entry.selectedEditorId;
    const incremental = applyHtmlToCanvasIncremental(ctx.dom, entry.html);
    if (!incremental) {
      cleanupCanvasEvents?.();
      cleanupCanvasResize?.();
      applyHtmlToCanvasFull(ctx.dom, entry.html);
      ctx.bindCanvasEvents();
    }
    restoreSelectionAfterHistory(entry.selectedEditorId);
  };

  ctx.undo = () => {
    const entry = popUndo(ctx.state);
    if (entry) applyHistoryEntry(entry);
  };

  ctx.redo = () => {
    const entry = popRedo(ctx.state);
    if (entry) applyHistoryEntry(entry);
  };

  ctx.bindCanvasEvents = () => {
    cleanupCanvasEvents?.();
    cleanupCanvasResize?.();
    cleanupMutationObserver?.();

    cleanupCanvasEvents = setupCanvasEvents({
      state: ctx.state,
      dom: ctx.dom,
      selectElement: ctx.selectElement,
      canEditElement: (el) => canEditElement(ctx, el),
      getElementSelector: (el) => getStableSelector(el),
      pushUndo: () => captureUndoSnapshot(ctx.state),
      captureUndoSnapshot: () => captureUndoSnapshot(ctx.state),
      markDirty: () => markDirty(ctx),
      updateHtmlFromCanvas: () => syncHtmlFromCanvas(ctx),
      onCollabTyping: (typing) => ctx.collab.instance?.setTyping(typing),
      onCollabReleaseLock: (selector) => ctx.collab.instance?.releaseLock(selector),
      initDroppedCharts: (doc) => initDroppedCharts(ctx, doc),
      onTextEditStart: (el) => {
        textCrdtManager.bindElement(el);
        mutationObserver.pause();
      },
      onTextEditEnd: (el) => {
        textCrdtManager.unbindElement();
        mutationObserver.resume();
      },
    });
    cleanupCanvasResize = observeCanvasResize(ctx.dom);

    // Start MutationObserver for element-level sync
    const canvasDoc = ctx.dom.canvasFrame?.contentDocument;
    if (canvasDoc?.body) {
      mutationObserver.observe(canvasDoc.body);
      cleanupMutationObserver = () => mutationObserver.disconnect();
      log.info('MutationObserver started for element-level sync');
    }

    if (canvasDoc) {
      bindFormatToolbar(ctx, canvasDoc);
      bindTopbarAutohide(ctx, canvasDoc);
      refreshValidityChip(ctx);
    }

    log.info('canvas events bound');
  };

  async function init(): Promise<void> {
    log.info('init: start');

    const editorUrl = `/v1/artifacts/${config.artifactId}/editor`;
    try {
      const response = await fetch(editorUrl, {
        headers: { Accept: 'application/json' },
        credentials: 'same-origin',
      });
      log.info('init: fetch status', { status: response.status });

      if (response.ok) {
        const data = await response.json();
        if (data.success && data.editor) {
          ctx.state.html = data.editor.html;
          ctx.state.collaborators = data.editor.collaborators || [];
          ctx.state.version = data.editor.versionNo || 0;
          // EDIT-09 F1: remember the draft timestamp we loaded for optimistic-concurrency saves.
          ctx.state.draftUpdatedAt = data.editor.draftUpdatedAt;

          // Parse manifest from HTML
          const manifest = parseManifest(ctx.state.html);
          ctx.state.manifest = manifest;
          if (manifest) {
            log.info('Manifest parsed', {
              valid: manifest.valid,
              jsonKeys: manifest.jsonKeys,
              tables: manifest.tableNames,
              computed: manifest.computedNames,
            });
            if (!manifest.valid && manifest.errors.length > 0) {
              log.warn('Manifest validation errors', manifest.errors);
            }
          } else {
            log.info('No manifest found in artifact');
          }

          const versionIndicator = document.getElementById('version-indicator');
          if (versionIndicator && (ctx.state.version ?? 0) > 0) {
            versionIndicator.textContent = `v${ctx.state.version}`;
            versionIndicator.addEventListener('click', () => openRailPanel(ctx, 'history'));
          }
        }
      } else {
        const errText = await response.text().catch(() => '');
        log.warn('init: fetch failed', { status: response.status, body: errText.slice(0, 200) });
      }
    } catch (err) {
      log.error('init: fetch error', err);
    }

    try {
      log.debug('init step: renderCanvas');
      renderCanvas(ctx.state, ctx.dom);
    } catch (err) {
      log.error('renderCanvas failed', err);
      throw err;
    }

    try {
      log.debug('init step: renderCollaborators');
      renderCollaborators(ctx);
    } catch (err) {
      log.error('renderCollaborators failed', err);
      throw err;
    }

    try {
      log.debug('init step: initPalette');
      initPalette(ctx);
    } catch (err) {
      log.error('initPalette failed', err);
      throw err;
    }

    try {
      log.debug('init step: bindCanvasEvents');
      ctx.bindCanvasEvents();
    } catch (err) {
      log.error('bindCanvasEvents failed', err);
      throw err;
    }

    try {
      log.debug('init step: setupToolbarEvents');
      setupToolbarEvents(ctx);
      document.querySelector('.toolbar-btn[data-tool="select"]')?.classList.add('active');
    } catch (err) {
      log.error('setupToolbarEvents failed', err);
      throw err;
    }

    try {
      log.debug('init step: setupChatEvents');
      setupChatEvents(ctx);
    } catch (err) {
      log.error('setupChatEvents failed', err);
      throw err;
    }

    try {
      log.debug('init step: setupStudioRail');
      setupStudioRail(ctx);
    } catch (err) {
      log.error('setupStudioRail failed', err);
      throw err;
    }

    try {
      log.debug('init step: setupFormatToolbar');
      setupFormatToolbar(ctx);
      setupTopbarAutohide(ctx);
    } catch (err) {
      log.error('setupFormatToolbar failed', err);
      throw err;
    }

    try {
      log.debug('init step: setupKeyboardShortcuts');
      setupKeyboardShortcuts(ctx);
    } catch (err) {
      log.error('setupKeyboardShortcuts failed', err);
      throw err;
    }

    try {
      log.debug('init step: connectWebSocket');
      connectWebSocket(ctx);
    } catch (err) {
      log.error('connectWebSocket failed', err);
      throw err;
    }

    cleanupDraftLifecycle = setupDraftLifecycle(ctx);

    log.info('init: complete');
  }

  log.info('bootEditor: wiring complete');
  void init().catch((err) => {
    log.error('init failed', err);
    showToast('Editor failed to load: ' + (err?.message || err), 'error');
  });
}
