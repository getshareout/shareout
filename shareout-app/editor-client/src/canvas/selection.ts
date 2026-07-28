import { EDITOR_ID_ATTR, ensureEditorId } from '../dom/editor-ids';
import { createLogger } from '../editor/logger';
import type { EditorDom, EditorState } from '../editor/types';
import { syncColorInputsToElement } from '../floating-menu/floating-menu';
import { isDataBoundElement, getBindingDescription } from '../bindings';
import {
  ACTION_ATTR,
  ACTIONS_ATTR,
  MODAL_ATTR,
  IF_ATTR,
  HIDE_ATTR,
  SHOW_ATTR,
  SWITCH_ATTR,
  CASE_ATTR,
  FORM_ATTR,
  FIELD_ATTR,
  NAV_ATTR,
  LINK_ATTR,
  BREADCRUMB_ATTR,
} from '../sdk-patterns';

const log = createLogger('selection');

export function clearSelectionAttributes(doc: Document): void {
  doc.querySelectorAll('[data-editor-selected]').forEach((el) => {
    el.removeAttribute('data-editor-selected');
  });
}

export function renderSelectionHandles(
  element: Element | null,
  dom: EditorDom
): void {
  if (!dom.selectionOverlay) {
    log.warn('renderSelectionHandles: selectionOverlay is null');
    return;
  }
  dom.selectionOverlay.innerHTML = '';
  if (!element) return;

  const rect = element.getBoundingClientRect();
  const frameRect = dom.canvasFrame.getBoundingClientRect();
  const overlayRect = dom.selectionOverlay.getBoundingClientRect();

  // Element's rect is relative to iframe viewport.
  // Convert to viewport coords, then to overlay-relative coords.
  const absLeft = frameRect.left + rect.left;
  const absTop = frameRect.top + rect.top;
  const left = absLeft - overlayRect.left;
  const top = absTop - overlayRect.top;

  const box = document.createElement('div');
  box.className = 'selection-box';
  box.style.left = `${left}px`;
  box.style.top = `${top}px`;
  box.style.width = `${rect.width}px`;
  box.style.height = `${rect.height}px`;

  // Element type label (above-left)
  const label = document.createElement('div');
  label.className = 'selection-label';
  const tag = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const cls = element.classList.length > 0 ? `.${element.classList[0]}` : '';

  // ShareOut Design System Colors (consolidated, semantic)
  const BADGE_COLORS = {
    primary: '#2563eb',    // Data bindings, main actions
    success: '#16a34a',    // Conditions, visibility
    warning: '#ca8a04',    // Actions, interactive
    danger: '#dc2626',     // Destructive, hide
    neutral: '#57534e',    // Navigation, secondary
  };

  // Detect element features and build badges
  const badges: Array<{ icon: string; text: string; color: string }> = [];

  // Check if element is data-bound
  const isBound = isDataBoundElement(element);
  if (isBound) {
    const bindingInfo = getBindingDescription(element);
    const bindingType = bindingInfo?.bindingType || 'data';
    const typeIcon = bindingType === 'table' ? '⊞' : bindingType === 'computed' ? 'ƒx' : '📊';
    badges.push({ icon: typeIcon, text: bindingType === 'table' ? 'table' : bindingType === 'computed' ? 'formula' : 'data', color: BADGE_COLORS.primary });
  }

  // Check for action attributes
  if (element.hasAttribute(ACTION_ATTR) || element.hasAttribute(ACTIONS_ATTR)) {
    badges.push({ icon: '⚡', text: 'action', color: BADGE_COLORS.warning });
  }
  if (element.hasAttribute(MODAL_ATTR)) {
    badges.push({ icon: '🪟', text: 'modal', color: BADGE_COLORS.primary });
  }

  // Check for conditional attributes
  if (element.hasAttribute(IF_ATTR)) {
    badges.push({ icon: '👁️', text: 'if', color: BADGE_COLORS.success });
  }
  if (element.hasAttribute(HIDE_ATTR)) {
    badges.push({ icon: '🙈', text: 'hide', color: BADGE_COLORS.danger });
  }
  if (element.hasAttribute(SHOW_ATTR)) {
    badges.push({ icon: '👀', text: 'show', color: BADGE_COLORS.success });
  }
  if (element.hasAttribute(SWITCH_ATTR)) {
    badges.push({ icon: '🔀', text: 'switch', color: BADGE_COLORS.success });
  }
  if (element.hasAttribute(CASE_ATTR)) {
    badges.push({ icon: '▪️', text: 'case', color: BADGE_COLORS.success });
  }

  // Check for form attributes
  if (element.hasAttribute(FORM_ATTR)) {
    badges.push({ icon: '📋', text: 'form', color: BADGE_COLORS.primary });
  }
  if (element.hasAttribute(FIELD_ATTR)) {
    badges.push({ icon: '📝', text: 'field', color: BADGE_COLORS.primary });
  }

  // Check for navigation attributes
  if (element.hasAttribute(NAV_ATTR)) {
    badges.push({ icon: '🧭', text: 'nav', color: BADGE_COLORS.neutral });
  }
  if (element.hasAttribute(LINK_ATTR)) {
    badges.push({ icon: '🔗', text: 'link', color: BADGE_COLORS.neutral });
  }
  if (element.hasAttribute(BREADCRUMB_ATTR)) {
    badges.push({ icon: '🧭', text: 'breadcrumb', color: BADGE_COLORS.neutral });
  }

  // Render label with badges - larger padding for better touch targets
  if (badges.length > 0) {
    const badgeHtml = badges.map(b => `
      <span style="background: ${b.color}; color: white; padding: 2px 8px; border-radius: 6px; margin-left: 6px; font-size: 11px; font-weight: 500; display: inline-flex; align-items: center; gap: 3px;">
        <span style="font-size: 11px;">${b.icon}</span>
        ${b.text}
      </span>
    `).join('');

    label.innerHTML = `<span>${tag}${id || cls}</span>${badgeHtml}`;
    box.style.borderColor = badges[0].color;
  } else {
    label.textContent = `${tag}${id || cls}`;
  }
  box.appendChild(label);

  for (const pos of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const handle = document.createElement('div');
    handle.className = `resize-handle ${pos}`;
    handle.dataset.handle = pos;
    box.appendChild(handle);
  }

  // Drag-to-reorder handle — only when the parent opts in via data-shareout-sortable
  const parent = element.parentElement;
  if (parent && parent.hasAttribute('data-shareout-sortable')) {
    const drag = document.createElement('div');
    drag.className = 'drag-handle';
    drag.title = 'Drag to reorder';
    drag.innerHTML =
      '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>';
    box.appendChild(drag);
  }

  dom.selectionOverlay.appendChild(box);
}

export interface SelectElementDeps {
  state: EditorState;
  dom: EditorDom;
  broadcastSelection: (element: Element | null) => void;
}

export function selectElement(
  element: Element | null,
  deps: SelectElementDeps
): void {
  const doc = deps.dom.canvasFrame.contentDocument;
  if (!doc) {
    log.warn('selectElement: canvas document unavailable');
    return;
  }

  clearSelectionAttributes(doc);

  if (!element || element === doc.body || element === doc.documentElement) {
    deps.state.selectedElement = null;
    deps.state.selectedEditorId = null;
    renderSelectionHandles(null, deps.dom);
    hideFloatingMenu(deps.dom);
    deps.broadcastSelection(null);
    log.debug('selection cleared');
    return;
  }

  ensureEditorId(element);
  element.setAttribute('data-editor-selected', 'true');
  deps.state.selectedElement = element;
  deps.state.selectedEditorId = element.getAttribute(EDITOR_ID_ATTR);
  renderSelectionHandles(element, deps.dom);
  positionFloatingMenu(element, deps.dom);
  deps.broadcastSelection(element);
  log.info('selected', {
    tag: element.tagName.toLowerCase(),
    id: element.id || undefined,
    className: element.className || undefined,
  });
}

function positionFloatingMenu(element: Element, dom: EditorDom): void {
  const menu = dom.floatingMenu;
  if (!menu) return;

  // Sync color inputs to element's current colors
  syncColorInputsToElement(element);

  const rect = element.getBoundingClientRect();
  const frameRect = dom.canvasFrame.getBoundingClientRect();

  const elemTop = frameRect.top + rect.top;
  const elemLeft = frameRect.left + rect.left;
  const elemWidth = rect.width;

  menu.hidden = false;
  const menuRect = menu.getBoundingClientRect();
  const menuWidth = menuRect.width || 200;
  const menuHeight = menuRect.height || 48;

  // Position menu higher to leave room for selection label and binding badge
  let top = elemTop - menuHeight - 36;
  if (top < 70) {
    top = elemTop + rect.height + 12;
  }

  let left = elemLeft + (elemWidth / 2) - (menuWidth / 2);
  left = Math.max(12, Math.min(left, window.innerWidth - menuWidth - 12));

  menu.style.top = `${top}px`;
  menu.style.left = `${left}px`;
}

export function hideFloatingMenu(dom: EditorDom): void {
  if (dom.floatingMenu) {
    dom.floatingMenu.hidden = true;
  }
}

/**
 * Re-place the selection box/handles (and the floating menu, if visible) for the
 * current element. The overlay lives in the parent document and is positioned from
 * the element's viewport rect, so it must be re-run when the canvas scrolls or the
 * window resizes — otherwise the handles freeze in place and drift off the element.
 */
export function repositionSelection(element: Element | null, dom: EditorDom): void {
  if (!element) return;
  renderSelectionHandles(element, dom);
  if (dom.floatingMenu && !dom.floatingMenu.hidden) {
    positionFloatingMenu(element, dom);
  }
}
