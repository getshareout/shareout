// Outline panel — renders the detected page/section/tab outline, navigates to a node
// on click, and renames a node (writes its title attribute) on double-click.
import type { EditorContext } from '../editor/context';
import { createLogger } from '../editor/logger';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { pushUndo } from '../history/undo-redo';
import { markDirty } from '../persistence/draft';
import { PAGE_TITLE_ATTR, SECTION_TITLE_ATTR, TAB_TITLE_ATTR } from '../sdk-patterns';
import { detectOutline, type OutlineNode, type OutlineResult } from './outline-detector';
import { escapeHtml } from '../utils';

const log = createLogger('outline');

let currentOutline: OutlineResult | null = null;

/** Title attribute that names a page/section/tab — the rename target (null = not renamable). */
export function titleAttrForType(type: string): string | null {
  switch (type) {
    case 'page': return PAGE_TITLE_ATTR;
    case 'section': return SECTION_TITLE_ATTR;
    case 'tab': return TAB_TITLE_ATTR;
    default: return null;
  }
}

export function renderOutlineSection(ctx: EditorContext): string {
  const doc = ctx.dom.canvasFrame.contentDocument;
  if (!doc) {
    return '<p class="empty-hint">Canvas not loaded</p>';
  }

  currentOutline = detectOutline(doc);

  if (currentOutline.nodes.length === 0) {
    return renderEmptyState();
  }

  return renderOutlineTree(currentOutline);
}

function renderEmptyState(): string {
  return `
    <div class="drawer-section">
      <p class="empty-hint">No pages or sections detected</p>
      <p class="hint-subtext">
        Add structure with ShareOut attributes:<br>
        • <code>data-shareout-page</code> / <code>data-shareout-page-title</code><br>
        • <code>data-shareout-section</code> / <code>data-shareout-section-title</code><br>
        • <code>data-shareout-tabs</code> containing <code>data-shareout-tab</code>
      </p>
    </div>
  `;
}

function renderOutlineTree(outline: OutlineResult): string {
  const nodeCount = countNodes(outline.nodes);

  return `
    <div class="drawer-section">
      <div class="outline-header">
        <span class="outline-count">${nodeCount} item${nodeCount !== 1 ? 's' : ''}</span>
        <span class="outline-hint">Double-click a name to rename</span>
      </div>
      <div class="outline-tree" id="outline-tree">
        ${outline.nodes.map((node, idx) => renderNode(node, idx, [])).join('')}
      </div>
    </div>
  `;
}

function renderNode(node: OutlineNode, index: number, path: number[]): string {
  const currentPath = [...path, index];
  const pathStr = currentPath.join('-');
  const hasChildren = node.children.length > 0;
  const icon = getTypeIcon(node.type);
  const isActive = node.element.hasAttribute?.('data-editor-selected') ||
                   node.element.classList?.contains('active');

  return `
    <div class="outline-node ${isActive ? 'active' : ''}" data-outline-path="${pathStr}" style="--depth: ${node.depth}">
      <button class="outline-item" data-outline-path="${pathStr}" type="button">
        <span class="outline-icon">${icon}</span>
        <span class="outline-label">${escapeHtml(node.label)}</span>
        <span class="outline-type">${node.type}</span>
      </button>
      ${hasChildren ? `
        <div class="outline-children">
          ${node.children.map((child, i) => renderNode(child, i, currentPath)).join('')}
        </div>
      ` : ''}
    </div>
  `;
}

function getTypeIcon(type: string): string {
  switch (type) {
    case 'page':
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/></svg>';
    case 'tab':
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M3 12h18M3 18h12"/></svg>';
    case 'section':
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/></svg>';
    default:
      return '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="4"/></svg>';
  }
}

function countNodes(nodes: OutlineNode[]): number {
  return nodes.reduce((count, node) => count + 1 + countNodes(node.children), 0);
}


/**
 * Wire navigation (click) + rename (double-click) on the rendered tree. Delegates on
 * the stable #outline-tree node so it works in either host (rail or legacy drawer) and
 * re-attaches cleanly on each render (the tree element is replaced, so no stacking).
 */
export function setupOutlineHandlers(ctx: EditorContext): void {
  const tree = document.getElementById('outline-tree');
  if (!tree || !currentOutline) return;

  tree.addEventListener('click', (e) => {
    // Ignore the clicks that compose a double-click (which triggers rename instead).
    if ((e as MouseEvent).detail > 1) return;
    const btn = (e.target as HTMLElement).closest('[data-outline-path]') as HTMLElement | null;
    if (!btn || !currentOutline) return;
    const path = btn.dataset.outlinePath;
    if (!path) return;
    const node = getNodeByPath(currentOutline.nodes, path.split('-').map(Number));
    if (node) navigateToNode(ctx, node);
  });

  tree.addEventListener('dblclick', (e) => {
    const labelEl = (e.target as HTMLElement).closest('.outline-label') as HTMLElement | null;
    if (!labelEl || !currentOutline) return;
    const item = labelEl.closest('[data-outline-path]') as HTMLElement | null;
    const path = item?.dataset.outlinePath;
    if (!path) return;
    const node = getNodeByPath(currentOutline.nodes, path.split('-').map(Number));
    if (!node) return;
    const attr = titleAttrForType(node.type);
    if (attr) startRename(ctx, labelEl, node, attr);
  });
}

/** Inline-rename a node's label; commit writes the title attribute onto the element. */
function startRename(ctx: EditorContext, labelEl: HTMLElement, node: OutlineNode, attr: string): void {
  const original = node.label;
  labelEl.setAttribute('contenteditable', 'true');
  labelEl.classList.add('outline-label-editing');
  labelEl.focus();
  const sel = window.getSelection();
  if (sel) {
    const range = document.createRange();
    range.selectNodeContents(labelEl);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  let done = false;
  const finish = (commit: boolean): void => {
    if (done) return;
    done = true;
    labelEl.removeAttribute('contenteditable');
    labelEl.classList.remove('outline-label-editing');
    labelEl.removeEventListener('keydown', onKey);
    labelEl.removeEventListener('blur', onBlur);

    const text = (labelEl.textContent || '').trim();
    if (commit && text && text !== original) {
      pushUndo(ctx.state);
      node.element.setAttribute(attr, text);
      node.label = text;
      syncHtmlFromCanvas(ctx);
      markDirty(ctx);
    } else {
      labelEl.textContent = original;
    }
  };

  const onKey = (ev: KeyboardEvent): void => {
    if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
    else if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
  };
  const onBlur = (): void => finish(true);
  labelEl.addEventListener('keydown', onKey);
  labelEl.addEventListener('blur', onBlur);
}

function getNodeByPath(nodes: OutlineNode[], path: number[]): OutlineNode | null {
  if (path.length === 0) return null;

  let current = nodes[path[0]];
  for (let i = 1; i < path.length; i++) {
    if (!current?.children?.[path[i]]) return null;
    current = current.children[path[i]];
  }
  return current;
}

// Exit any active inline edit mode (contenteditable) in the canvas before navigating —
// clicking the outline (parent doc) doesn't trigger blur inside the iframe.
function exitInlineEditMode(doc: Document): void {
  doc.querySelectorAll('[contenteditable="true"], [contenteditable=""]').forEach((el) => {
    const htmlEl = el as HTMLElement;
    htmlEl.blur();
    htmlEl.removeAttribute('contenteditable');
  });
}

// Activate a screen/tab by showing it and hiding siblings (best-effort for class-based UIs).
function activateScreen(el: HTMLElement, doc: Document): void {
  const screenSelectors = ['.screen', '.page', '.view', '.tab-pane', '.tab-panel', '[data-screen]', '[data-page]', '[data-view]', '[role="tabpanel"]'];

  let matchedSelector: string | null = null;
  for (const sel of screenSelectors) {
    if (el.matches(sel)) { matchedSelector = sel; break; }
  }
  if (!matchedSelector) return;

  const parent = el.parentElement;
  if (!parent) return;

  parent.querySelectorAll(`:scope > ${matchedSelector}`).forEach((sibling) => {
    const sib = sibling as HTMLElement;
    sib.classList.remove('active', 'show');
    sib.style.display = 'none';
    sib.removeAttribute('aria-selected');
  });

  el.classList.add('active');
  el.style.display = '';
  el.setAttribute('aria-selected', 'true');

  const screenId = el.id || el.getAttribute('data-screen') || el.getAttribute('data-page');
  if (screenId) {
    doc.querySelectorAll(`[href="#${screenId}"], [data-tab="${screenId}"], [data-target="#${screenId}"]`).forEach((link) => {
      link.parentElement?.querySelectorAll('.active').forEach((a) => a.classList.remove('active'));
      link.classList.add('active');
    });
  }
}

function navigateToNode(ctx: EditorContext, node: OutlineNode): void {
  const element = node.element;
  if (!element) return;

  const doc = ctx.dom.canvasFrame.contentDocument;
  if (!doc?.body.contains(element)) {
    log.warn('navigateToNode: element no longer in DOM');
    return;
  }

  exitInlineEditMode(doc);

  if (node.type === 'page' || node.type === 'tab' || node.type === 'section') {
    activateScreen(element as HTMLElement, doc);
  }

  ctx.selectElement(element);

  try {
    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch {
    /* scrollIntoView can throw in some embeddings; non-fatal */
  }

  // Reflect the active node in the tree.
  const tree = document.getElementById('outline-tree');
  if (tree) {
    tree.querySelectorAll('.outline-node.active').forEach((el) => el.classList.remove('active'));
    tree.querySelectorAll<HTMLElement>('[data-outline-path]').forEach((item) => {
      const path = item.dataset.outlinePath;
      if (!path) return;
      const resolved = getNodeByPath(currentOutline?.nodes || [], path.split('-').map(Number));
      if (resolved?.element === element) item.classList.add('active');
    });
  }
}

