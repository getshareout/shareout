import { createLogger } from '../editor/logger';
import type { EditorDom, EditorState } from '../editor/types';
import { showToast } from '../toast';
import {
  applyDragMove,
  createCanvasDragState,
  endDrag,
} from './drag-controller';
import {
  getCanvasElementAt,
  getSelectionContext,
  resolveSelectTarget,
} from './selection-target';
import { syncCanvasFrameSize } from './render-canvas';
import { renderSelectionHandles, repositionSelection } from './selection';
import { setupResizeHandles } from './resize-handles.js';
import { setupReorderHandle } from './reorder-controller';
import { isDataBoundElement, showVariablePopover, hideVariablePopover } from '../bindings';

const log = createLogger('canvas-events');

export interface CanvasEventHandlers {
  state: EditorState;
  dom: EditorDom;
  selectElement: (element: Element | null) => void;
  canEditElement: (element: Element) => boolean;
  getElementSelector: (element: Element) => string;
  pushUndo: () => void;
  captureUndoSnapshot: () => void;
  markDirty: () => void;
  updateHtmlFromCanvas: () => void;
  onCollabTyping: (typing: boolean) => void;
  onCollabReleaseLock: (selector: string) => void;
  initDroppedCharts: (doc: Document) => void;
  onTextEditStart?: (element: Element) => void;
  onTextEditEnd?: (element: Element) => void;
}

export function setupCanvasEvents(handlers: CanvasEventHandlers): () => void {
  const doc = handlers.dom.canvasFrame.contentDocument;
  if (!doc?.body) {
    log.error('setupCanvasEvents: canvas document not ready');
    return () => {};
  }

  const ctx = getSelectionContext(doc);
  if (!ctx) {
    log.error('setupCanvasEvents: missing body/documentElement');
    return () => {};
  }

  let dragState = createCanvasDragState();
  let hoverElement: Element | null = null;

  const resolve = (target: EventTarget | null) => resolveSelectTarget(target, ctx);

  const onMouseOver = (e: MouseEvent) => {
    if (handlers.state.tool !== 'select' || dragState.isDragging) return;
    const target = resolve(e.target);
    if (!target || target === hoverElement) return;
    if (hoverElement) hoverElement.removeAttribute('data-editor-hover');
    hoverElement = target;
    target.setAttribute('data-editor-hover', 'true');
  };

  const onMouseOut = (e: MouseEvent) => {
    const target = resolve(e.target);
    if (target && target === hoverElement) {
      target.removeAttribute('data-editor-hover');
      hoverElement = null;
    }
  };

  const onClick = (e: MouseEvent) => {
    log.debug('onClick handler ENTERED', {
      didDrag: dragState.didDrag,
      tool: handlers.state.tool,
      targetTag: e.target instanceof Element ? e.target.tagName : String(e.target),
    });

    // Block navigation for all interactive elements (links, buttons) in edit mode
    const rawTarget = e.target;
    if (rawTarget instanceof Element) {
      const interactive = rawTarget.closest('a[href], button[onclick], [onclick]');
      if (interactive) {
        e.preventDefault();
        e.stopPropagation();
        log.debug('blocked navigation on interactive element', {
          tag: interactive.tagName,
          href: interactive.getAttribute('href'),
        });
      }
    }

    if (dragState.didDrag) {
      log.debug('click ignored (drag)', { didDrag: dragState.didDrag });
      return;
    }

    if (handlers.state.tool === 'select') {
      const target = resolve(e.target);
      log.debug('iframe click resolved', {
        rawTag: e.target instanceof Element ? e.target.tagName : String(e.target),
        resolvedTag: target?.tagName ?? null,
        resolvedId: target instanceof Element ? target.id : null,
      });

      // Clicking empty space clears the selection (and returns the rail to Agent)
      if (!target) {
        if (handlers.state.selectedElement) {
          handlers.selectElement(null);
        }
        log.debug('target was null, cleared selection');
        return;
      }

      if (target) {
        e.preventDefault();
        e.stopPropagation();
        if (target === handlers.state.selectedElement) {
          enterTextEditMode(target, doc, handlers);
        } else {
          log.debug('calling selectElement', { tag: target.tagName });
          handlers.selectElement(target);
          log.debug('selectElement returned');
        }
      }
      return;
    }
  };

  const onMouseDown = (e: MouseEvent) => {
    log.debug('onMouseDown handler ENTERED', {
      tool: handlers.state.tool,
      targetTag: e.target instanceof Element ? e.target.tagName : String(e.target),
    });
    if (handlers.state.tool !== 'select') {
      log.debug('onMouseDown skipped (tool not select)');
      return;
    }
    const element = resolve(e.target);
    log.debug('iframe mousedown resolved', {
      rawTag: (e.target as Node)?.nodeType === 1 ? (e.target as Element).tagName : String(e.target),
      resolvedTag: element?.tagName ?? null,
    });
    // Use nodeType check instead of instanceof for cross-iframe compatibility
    if (!element || (element as Node).nodeType !== 1) {
      log.debug('onMouseDown: element invalid, not selecting');
      return;
    }

    log.debug('onMouseDown: calling selectElement');
    handlers.selectElement(element);
  };

  const onMouseMove = (e: MouseEvent) => {
    const wasDragging = dragState.isDragging;
    const result = applyDragMove(dragState, e);
    dragState = result.state;
    if (!wasDragging && dragState.isDragging) {
      handlers.captureUndoSnapshot();
    }
    if (result.moved && dragState.element) {
      renderSelectionDuringDrag(handlers.dom, dragState.element);
    }
  };

  const onMouseUp = () => {
    if (dragState.didDrag && dragState.element) {
      handlers.markDirty();
      handlers.updateHtmlFromCanvas();
    }
    dragState = endDrag(dragState);
  };

  const cleanupDrop = setupDropZone(doc, handlers);
  const cleanupResize = setupResizeHandles({
    dom: handlers.dom,
    getSelected: () => handlers.state.selectedElement,
    pushUndo: handlers.pushUndo,
    markDirty: handlers.markDirty,
    updateHtmlFromCanvas: handlers.updateHtmlFromCanvas,
  });

  const cleanupReorder = setupReorderHandle({
    dom: handlers.dom,
    getSelected: () => handlers.state.selectedElement,
    pushUndo: handlers.pushUndo,
    markDirty: handlers.markDirty,
    updateHtmlFromCanvas: handlers.updateHtmlFromCanvas,
  });

  // DEBUG: Test if ANY events fire on iframe body (separate counters per event type)
  const eventCounters: Record<string, number> = {};
  const debugEventListener = (eventType: string) => (e: Event) => {
    eventCounters[eventType] = (eventCounters[eventType] || 0) + 1;
    // Only log first 3 mouseovers (spammy), but all clicks/mousedowns
    const limit = eventType === 'mouseover' ? 3 : 20;
    if (eventCounters[eventType] <= limit) {
      log.debug(`iframe body ${eventType} #${eventCounters[eventType]}`, {
        target: e.target instanceof Element ? e.target.tagName : String(e.target),
        targetId: e.target instanceof Element ? (e.target as Element).id : undefined,
        eventPhase: e.eventPhase,
        bubbles: e.bubbles,
        tool: handlers.state.tool,
      });
    }
  };

  doc.body.addEventListener('mouseover', debugEventListener('mouseover'), true);
  doc.body.addEventListener('click', debugEventListener('click'), true);
  doc.body.addEventListener('mousedown', debugEventListener('mousedown'), true);

  // Also test on documentElement
  doc.documentElement.addEventListener('click', (e) => {
    log.debug('documentElement click', {
      target: e.target instanceof Element ? e.target.tagName : String(e.target),
    });
  }, true);

  doc.body.addEventListener('mouseover', onMouseOver);
  doc.body.addEventListener('mouseout', onMouseOut);
  doc.body.addEventListener('click', onClick);
  doc.body.addEventListener('mousedown', onMouseDown);
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);

  setupDoubleClickTextEdit(doc, handlers);
  setupRightClickNavigation(doc, handlers);
  setupIframeKeyboardShortcuts(doc, handlers);

  const canvasShell = document.getElementById('canvas');
  const onCanvasPointerDown = (e: MouseEvent) => {
    log.debug('canvasShell mousedown fired', {
      tool: handlers.state.tool,
      target: e.target instanceof Element ? e.target.tagName : String(e.target),
    });
    if (handlers.state.tool !== 'select') return;
    const hitTarget = e.target;
    if (hitTarget instanceof Element && hitTarget.closest('.resize-handle, .drag-handle')) return;
    // Don't interfere with floating menu clicks
    if (hitTarget instanceof Element && hitTarget.closest('#floating-menu, #style-popover')) return;

    const frame = handlers.dom.canvasFrame;
    const frameRect = frame.getBoundingClientRect();
    log.debug('frame bounds check', {
      clientX: e.clientX,
      clientY: e.clientY,
      frameLeft: frameRect.left,
      frameRight: frameRect.right,
      frameTop: frameRect.top,
      frameBottom: frameRect.bottom,
      inBounds: e.clientX >= frameRect.left && e.clientX <= frameRect.right &&
                e.clientY >= frameRect.top && e.clientY <= frameRect.bottom,
    });
    if (
      e.clientX < frameRect.left ||
      e.clientX > frameRect.right ||
      e.clientY < frameRect.top ||
      e.clientY > frameRect.bottom
    ) {
      return;
    }

    const hit = getCanvasElementAt(e.clientX, e.clientY, frame, ctx);
    log.debug('canvas shell mousedown', {
      shellTarget:
        hitTarget instanceof Element ? hitTarget.id || hitTarget.tagName : String(hitTarget),
      hitTag: hit?.tagName ?? null,
      clientX: e.clientX,
      clientY: e.clientY,
    });

    if (!hit || !(hit instanceof HTMLElement)) return;

    handlers.selectElement(hit);
  };

  canvasShell?.addEventListener('mousedown', onCanvasPointerDown, true);

  // Keep the selection overlay (which lives in the parent document) aligned with
  // its element when the canvas scrolls or the window resizes — otherwise the
  // handles/box freeze in place and drift off the element. rAF-throttled.
  let repositionRaf: number | null = null;
  const onReposition = () => {
    if (repositionRaf !== null) return;
    repositionRaf = requestAnimationFrame(() => {
      repositionRaf = null;
      if (handlers.state.selectedElement) {
        repositionSelection(handlers.state.selectedElement, handlers.dom);
      }
    });
  };
  const canvasWin = handlers.dom.canvasFrame.contentWindow;
  const canvasScroll = document.getElementById('canvas-scroll');
  canvasWin?.addEventListener('scroll', onReposition, { passive: true });
  canvasScroll?.addEventListener('scroll', onReposition, { passive: true });
  window.addEventListener('resize', onReposition);

  // DEBUG: Log comprehensive setup info
  log.info('canvas event listeners attached', {
    bodyChildCount: doc.body.childElementCount,
    frameHeight: handlers.dom.canvasFrame.getBoundingClientRect().height,
    bodyTagName: doc.body.tagName,
    bodyPointerEvents: window.getComputedStyle(doc.body).pointerEvents,
    docElementPointerEvents: window.getComputedStyle(doc.documentElement).pointerEvents,
    iframeSrc: handlers.dom.canvasFrame.src,
    iframeSandbox: handlers.dom.canvasFrame.sandbox.toString(),
    currentTool: handlers.state.tool,
    canvasShellExists: !!canvasShell,
  });

  return () => {
    doc.body.removeEventListener('mouseover', onMouseOver);
    doc.body.removeEventListener('mouseout', onMouseOut);
    doc.body.removeEventListener('click', onClick);
    doc.body.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
    canvasShell?.removeEventListener('mousedown', onCanvasPointerDown, true);
    if (repositionRaf !== null) cancelAnimationFrame(repositionRaf);
    canvasWin?.removeEventListener('scroll', onReposition);
    canvasScroll?.removeEventListener('scroll', onReposition);
    window.removeEventListener('resize', onReposition);
    cleanupDrop();
    cleanupResize();
    cleanupReorder();
  };
}

export function observeCanvasResize(dom: EditorDom): () => void {
  const doc = dom.canvasFrame.contentDocument;
  if (!doc?.body) return () => {};

  const runSync = () => syncCanvasFrameSize(dom);
  runSync();

  const observer = new ResizeObserver(() => runSync());
  observer.observe(doc.documentElement);
  if (doc.body) observer.observe(doc.body);

  return () => observer.disconnect();
}

function renderSelectionDuringDrag(dom: EditorDom, element: Element): void {
  renderSelectionHandles(element, dom);
}

function enterTextEditMode(target: Element, _doc: Document, handlers: CanvasEventHandlers): void {
  if (
    !target.matches(
      'p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, label, button, div'
    )
  ) {
    return;
  }

  // Check if element is data-bound to SDK - show variable popover
  if (isDataBoundElement(target)) {
    const frameRect = handlers.dom.canvasFrame.getBoundingClientRect();
    showVariablePopover(target, frameRect, {
      parentDocument: window.parent.document,
      onClose: () => {
        hideVariablePopover();
      },
    });
    return;
  }

  if (!handlers.canEditElement(target)) {
    const lockInfo = target.getAttribute('data-locked-by');
    showToast((lockInfo || 'Another user') + ' is editing this element', 'warning');
    return;
  }

  const el = target as HTMLElement;
  handlers.captureUndoSnapshot();
  el.contentEditable = 'true';
  el.focus();
  handlers.onCollabTyping(true);
  handlers.onTextEditStart?.(target);

  target.addEventListener(
    'blur',
    () => {
      el.contentEditable = 'false';
      handlers.onCollabTyping(false);
      handlers.onTextEditEnd?.(target);
      handlers.onCollabReleaseLock(handlers.getElementSelector(target));
      handlers.markDirty();
      handlers.updateHtmlFromCanvas();
    },
    { once: true }
  );

  target.addEventListener(
    'keydown',
    (ke) => {
      if ((ke as KeyboardEvent).key === 'Escape') el.blur();
    },
    { once: true }
  );
}

function setupDoubleClickTextEdit(doc: Document, handlers: CanvasEventHandlers): void {
  doc.body.addEventListener('dblclick', (e) => {
    const target = e.target;
    if (!(target instanceof Element)) return;

    // Check if it's an interactive element - run its action instead of editing
    const interactive = target.closest('a[href], button[onclick], [onclick], button[type="button"], button[type="submit"]');
    if (interactive) {
      e.preventDefault();
      e.stopPropagation();

      // Execute the interactive element's action
      if (interactive.tagName === 'A') {
        const link = interactive as HTMLAnchorElement;
        const href = link.getAttribute('href');
        if (href) {
          if (href.startsWith('#')) {
            // Internal anchor - scroll to it
            const targetEl = doc.querySelector(href);
            if (targetEl) {
              targetEl.scrollIntoView({ behavior: 'smooth' });
              showToast('Navigated to: ' + href, 'info');
            }
          } else {
            // External link - open in new tab
            window.open(href, '_blank', 'noopener,noreferrer');
            showToast('Opened link in new tab', 'info');
          }
        }
      } else if (interactive.tagName === 'BUTTON') {
        const button = interactive as HTMLButtonElement;
        // Trigger click event to execute any attached handlers
        const clickEvent = new MouseEvent('click', {
          bubbles: true,
          cancelable: true,
          view: doc.defaultView || undefined,
        });
        button.dispatchEvent(clickEvent);
        showToast('Button action executed', 'info');
      }
      return;
    }

    if (
      !target.matches(
        'p, h1, h2, h3, h4, h5, h6, span, a, li, td, th, label, button, div'
      )
    ) {
      return;
    }

    // Check if element is data-bound to SDK - show variable popover
    if (isDataBoundElement(target)) {
      const frameRect = handlers.dom.canvasFrame.getBoundingClientRect();
      showVariablePopover(target, frameRect, {
        parentDocument: window.parent.document,
        onClose: () => {
          hideVariablePopover();
        },
      });
      return;
    }

    if (!handlers.canEditElement(target)) {
      const lockInfo = target.getAttribute('data-locked-by');
      showToast(`${lockInfo || 'Another user'} is editing this element`, 'warning');
      return;
    }

    const el = target as HTMLElement;
    handlers.captureUndoSnapshot();
    el.contentEditable = 'true';
    el.focus();
    handlers.onCollabTyping(true);

    target.addEventListener(
      'blur',
      () => {
        el.contentEditable = 'false';
        handlers.onCollabTyping(false);
        handlers.onCollabReleaseLock(handlers.getElementSelector(target));
        handlers.markDirty();
        handlers.updateHtmlFromCanvas();
      },
      { once: true }
    );

    el.addEventListener(
      'keydown',
      (ke: KeyboardEvent) => {
        if (ke.key === 'Escape') el.blur();
      },
      { once: true }
    );
  });
}

function setupRightClickNavigation(doc: Document, handlers: CanvasEventHandlers): void {
  const log = createLogger('context-menu');

  // Use capture phase to intercept before browser's default menu
  doc.addEventListener('contextmenu', (e) => {
    const rawTarget = e.target as Node;

    log.debug('contextmenu event fired', {
      target: rawTarget?.nodeName,
      nodeType: rawTarget?.nodeType,
      clientX: e.clientX,
      clientY: e.clientY,
    });

    // Use nodeType check instead of instanceof (cross-iframe compatibility)
    if (!rawTarget || rawTarget.nodeType !== 1) {
      log.debug('rawTarget not an element node, returning');
      return;
    }

    const element = rawTarget as Element;

    // Find the selectable element (skip body/html)
    const target = element.closest('p, h1, h2, h3, h4, h5, h6, div, section, article, span, a, button, img, ul, ol, li, table, tr, td, th, form, input, textarea, select, nav, header, footer, aside, main');
    log.debug('closest selectable', {
      found: !!target,
      tag: target?.tagName,
      isBody: target === doc.body,
    });

    if (!target || target === doc.body) {
      log.debug('no valid target, returning');
      return;
    }

    log.debug('preventing default and showing menu');
    e.preventDefault();
    e.stopPropagation();

    // Use parent document for menu so it renders on top of everything
    const parentDoc = window.parent.document;
    const frame = parentDoc.getElementById('canvas-frame') as HTMLIFrameElement;
    const frameRect = frame?.getBoundingClientRect() || { left: 0, top: 0 };

    // Remove existing menu
    const existingMenu = parentDoc.getElementById('editor-context-menu');
    if (existingMenu) existingMenu.remove();

    const menu = parentDoc.createElement('div');
    menu.id = 'editor-context-menu';
    menu.style.cssText = `
      position: fixed;
      left: ${frameRect.left + e.clientX}px;
      top: ${frameRect.top + e.clientY}px;
      background: #ffffff;
      border-radius: 12px;
      border: 1px solid #e7e5e4;
      box-shadow: 0 4px 24px rgba(0,0,0,0.12);
      padding: 8px;
      z-index: 10000;
      min-width: 220px;
      font-family: 'Source Sans 3', 'Segoe UI', system-ui, sans-serif;
      font-size: 15px;
    `;

    const createMenuItem = (icon: string, label: string, shortcut: string, onClick: () => void, danger = false) => {
      const item = parentDoc.createElement('button');
      item.innerHTML = `
        <span style="width:22px;display:inline-flex;align-items:center;justify-content:center;margin-right:10px;opacity:0.8">${icon}</span>
        <span style="flex:1">${label}</span>
        ${shortcut ? `<span style="color:#a8a29e;font-size:13px;margin-left:auto;font-family:'JetBrains Mono','SF Mono',monospace">${shortcut}</span>` : ''}
      `;
      item.style.cssText = `
        display: flex;
        align-items: center;
        width: 100%;
        padding: 10px 12px;
        border: none;
        background: none;
        text-align: left;
        cursor: pointer;
        border-radius: 8px;
        color: ${danger ? '#dc2626' : '#1c1917'};
        font-size: 15px;
        min-height: 44px;
      `;
      item.onmouseenter = () => { item.style.background = danger ? 'rgba(220,38,38,0.08)' : '#f5f5f4'; };
      item.onmouseleave = () => { item.style.background = 'none'; };
      item.onclick = () => {
        menu.remove();
        onClick();
      };
      return item;
    };

    const createDivider = () => {
      const div = parentDoc.createElement('div');
      div.style.cssText = 'height:1px;background:#e7e5e4;margin:6px 0;';
      return div;
    };

    // Check if it's an interactive element (links, buttons, tabs, nav items)
    const link = target.closest('a[href]');
    const button = target.closest('button, [onclick], [role="button"], [role="tab"], [data-toggle], [data-target], [data-bs-toggle], [data-bs-target]');
    const href = link?.getAttribute('href');

    // Check for tab/navigation patterns
    const tabTarget = button?.getAttribute('data-target') ||
                      button?.getAttribute('data-bs-target') ||
                      button?.getAttribute('href') ||
                      button?.getAttribute('aria-controls');

    log.debug('interactive element check', {
      hasLink: !!link,
      hasButton: !!button,
      href,
      tabTarget,
      buttonTag: button?.tagName
    });

    // Add interactive element options at top
    if (link && href) {
      menu.appendChild(createMenuItem('▶', `Run Action (Open link)`, '', () => {
        if (href.startsWith('#')) {
          // Internal anchor - scroll to it and activate screen/tab
          const targetEl = doc.querySelector(href);
          log.debug('navigating to anchor', { href, found: !!targetEl });
          if (targetEl) {
            activateScreenElement(targetEl as HTMLElement, doc, log);
            targetEl.scrollIntoView({ behavior: 'smooth' });
            showToast('Navigated to: ' + href, 'info');
          } else {
            showToast('Target not found: ' + href, 'warning');
          }
        } else {
          // External link - open in new tab
          window.open(href, '_blank', 'noopener,noreferrer');
          showToast('Opened link in new tab', 'info');
        }
      }));
      menu.appendChild(createDivider());
    } else if (button) {
      menu.appendChild(createMenuItem('▶', `Run Action (Click)`, '', () => {
        log.debug('executing button action', { tag: button.tagName, tabTarget });

        // For tab-like elements, try to activate the target section
        if (tabTarget) {
          const targetSection = doc.querySelector(tabTarget.startsWith('#') ? tabTarget : '#' + tabTarget);
          if (targetSection) {
            activateScreenElement(targetSection as HTMLElement, doc, log);
            targetSection.scrollIntoView({ behavior: 'smooth' });
            showToast('Switched to: ' + tabTarget, 'info');
            return;
          }
        }

        // Standard button click - use native click() method for better compatibility
        // Note: instanceof check fails cross-iframe, use duck typing
        const btnEl = button as HTMLElement;
        if (typeof btnEl.click === 'function') {
          btnEl.click();
          showToast('Button clicked', 'info');
        } else {
          // Fallback to synthetic event
          const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: doc.defaultView || undefined,
          });
          button.dispatchEvent(clickEvent);
          showToast('Button action executed', 'info');
        }
      }));
      menu.appendChild(createDivider());
    }

    // Add block below
    menu.appendChild(createMenuItem('+', 'Add block below', '', () => {
      const newBlock = doc.createElement('p');
      newBlock.textContent = 'New block';
      newBlock.style.cssText = 'padding:8px 0;';
      target.insertAdjacentElement('afterend', newBlock);
      handlers.selectElement(newBlock);
      handlers.pushUndo();
      handlers.markDirty();
      handlers.updateHtmlFromCanvas();
    }));

    // Duplicate
    menu.appendChild(createMenuItem('⧉', 'Duplicate', '⌘D', () => {
      const clone = target.cloneNode(true) as Element;
      target.insertAdjacentElement('afterend', clone);
      handlers.selectElement(clone);
      handlers.pushUndo();
      handlers.markDirty();
      handlers.updateHtmlFromCanvas();
    }));

    menu.appendChild(createDivider());

    // Move up
    menu.appendChild(createMenuItem('↑', 'Move up', '⌘↑', () => {
      const prev = target.previousElementSibling;
      if (prev) {
        prev.insertAdjacentElement('beforebegin', target);
        handlers.pushUndo();
        handlers.markDirty();
        handlers.updateHtmlFromCanvas();
      }
    }));

    // Move down
    menu.appendChild(createMenuItem('↓', 'Move down', '⌘↓', () => {
      const next = target.nextElementSibling;
      if (next) {
        next.insertAdjacentElement('afterend', target);
        handlers.pushUndo();
        handlers.markDirty();
        handlers.updateHtmlFromCanvas();
      }
    }));

    menu.appendChild(createDivider());

    // Delete
    menu.appendChild(createMenuItem('🗑', 'Delete', '⌫', () => {
      handlers.pushUndo();
      target.remove();
      handlers.selectElement(null);
      handlers.markDirty();
      handlers.updateHtmlFromCanvas();
    }, true));

    parentDoc.body.appendChild(menu);

    // Adjust position if menu goes off-screen
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.parent.innerWidth) {
      menu.style.left = `${window.parent.innerWidth - rect.width - 8}px`;
    }
    if (rect.bottom > window.parent.innerHeight) {
      menu.style.top = `${window.parent.innerHeight - rect.height - 8}px`;
    }

    // Close on click outside (listen on both parent and iframe docs)
    const closeMenu = (evt: MouseEvent) => {
      if (!menu.contains(evt.target as Node)) {
        menu.remove();
        parentDoc.removeEventListener('click', closeMenu, true);
        parentDoc.removeEventListener('contextmenu', closeMenu, true);
        doc.removeEventListener('click', closeMenu, true);
      }
    };
    setTimeout(() => {
      parentDoc.addEventListener('click', closeMenu, true);
      parentDoc.addEventListener('contextmenu', closeMenu, true);
      doc.addEventListener('click', closeMenu, true);
    }, 0);
  }, true); // Capture phase to intercept before browser default
}

function activateScreenElement(el: HTMLElement, doc: Document, log: ReturnType<typeof createLogger>): void {
  const screenSelectors = ['.screen', '.page', '.view', '.tab-pane', '.tab-panel', '[data-screen]', '[data-page]', '[data-view]', '[role="tabpanel"]'];

  let matchedSelector: string | null = null;
  for (const sel of screenSelectors) {
    if (el.matches(sel)) {
      matchedSelector = sel;
      break;
    }
  }

  log.debug('activateScreenElement', { id: el.id, matchedSelector, tag: el.tagName });

  if (matchedSelector) {
    const parent = el.parentElement;
    if (parent) {
      const siblings = parent.querySelectorAll(`:scope > ${matchedSelector}`);
      siblings.forEach((sibling) => {
        const sib = sibling as HTMLElement;
        sib.classList.remove('active', 'show');
        sib.style.display = 'none';
        sib.removeAttribute('aria-selected');
      });
    }
  } else {
    const parent = el.parentElement;
    if (parent) {
      Array.from(parent.children).forEach((sibling) => {
        const sib = sibling as HTMLElement;
        if (sib !== el && (sib.classList.contains('tab-pane') || sib.getAttribute('role') === 'tabpanel')) {
          sib.classList.remove('active', 'show');
          sib.style.display = 'none';
        }
      });
    }
  }

  el.classList.add('active', 'show');
  el.style.display = '';
  el.hidden = false;
  el.setAttribute('aria-selected', 'true');

  const screenId = el.id || el.getAttribute('data-screen') || el.getAttribute('data-page');
  if (screenId) {
    doc.querySelectorAll(`[href="#${screenId}"], [data-tab="${screenId}"], [data-target="#${screenId}"], [data-bs-target="#${screenId}"], [aria-controls="${screenId}"]`).forEach((link) => {
      const navParent = link.parentElement;
      if (navParent) {
        navParent.querySelectorAll('.active').forEach((a) => a.classList.remove('active'));
      }
      link.classList.add('active');
      link.setAttribute('aria-selected', 'true');
    });
  }
}

function setupIframeKeyboardShortcuts(doc: Document, _handlers: CanvasEventHandlers): void {
  doc.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      const event = new KeyboardEvent('keydown', {
        key: 'z',
        code: 'KeyZ',
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        bubbles: true,
      });
      document.dispatchEvent(event);
    }
  });
}

function setupDropZone(doc: Document, handlers: CanvasEventHandlers): () => void {
  let dropPreview: HTMLDivElement | null = null;
  let dragCounter = 0;

  const onDragEnter = (e: DragEvent) => {
    e.preventDefault();
    dragCounter++;
    if (!dropPreview) {
      dropPreview = doc.createElement('div');
      dropPreview.id = 'drop-preview';
      dropPreview.style.cssText = `
        position: fixed;
        pointer-events: none;
        background: rgba(59, 130, 246, 0.15);
        border: 2px dashed #3b82f6;
        border-radius: 8px;
        min-width: 100px;
        min-height: 40px;
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: #3b82f6;
        box-shadow: 0 4px 12px rgba(59, 130, 246, 0.25);
      `;
      dropPreview.textContent = 'Drop here';
      doc.body.appendChild(dropPreview);
    }
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    if (!dropPreview) return;

    const target = e.target;
    if (!(target instanceof Element)) return;
    const rect = target.getBoundingClientRect();

    if (target === doc.body) {
      dropPreview.style.left = `${e.clientX - 50}px`;
      dropPreview.style.top = `${e.clientY + 10}px`;
      dropPreview.style.width = '200px';
      dropPreview.style.height = '50px';
    } else {
      dropPreview.style.left = `${rect.left}px`;
      dropPreview.style.top = `${rect.bottom + 4}px`;
      dropPreview.style.width = `${rect.width}px`;
      dropPreview.style.height = '40px';
      if (target instanceof HTMLElement) {
        target.style.outline = '2px solid #3b82f6';
        target.style.outlineOffset = '2px';
      }
    }
  };

  const onDragLeave = (e: DragEvent) => {
    dragCounter--;
    const target = e.target;
    if (target instanceof HTMLElement && target !== doc.body) {
      target.style.outline = '';
      target.style.outlineOffset = '';
    }
    if (dragCounter === 0 && dropPreview) {
      dropPreview.remove();
      dropPreview = null;
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    dragCounter = 0;
    if (dropPreview) {
      dropPreview.remove();
      dropPreview = null;
    }

    doc.querySelectorAll('[style*="outline"]').forEach((el) => {
      if (el instanceof HTMLElement) {
        el.style.outline = '';
        el.style.outlineOffset = '';
      }
    });

    const html = e.dataTransfer?.getData('text/html');
    if (!html) return;

    handlers.pushUndo();
    const target = e.target;
    if (target instanceof Element) {
      if (target === doc.body) {
        target.insertAdjacentHTML('beforeend', html);
      } else {
        target.insertAdjacentHTML('afterend', html);
      }
    }

    handlers.initDroppedCharts(doc);
    handlers.markDirty();
    handlers.updateHtmlFromCanvas();
  };

  doc.body.addEventListener('dragenter', onDragEnter);
  doc.body.addEventListener('dragover', onDragOver);
  doc.body.addEventListener('dragleave', onDragLeave);
  doc.body.addEventListener('drop', onDrop);

  return () => {
    doc.body.removeEventListener('dragenter', onDragEnter);
    doc.body.removeEventListener('dragover', onDragOver);
    doc.body.removeEventListener('dragleave', onDragLeave);
    doc.body.removeEventListener('drop', onDrop);
  };
}
