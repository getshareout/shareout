import type { EditorContext } from '../editor/context';
import { SDK_DETECTION_PATTERNS } from '../sdk-patterns';
import { escapeHtml, rgbToHex } from '../utils';
import { showToast } from '../toast';
import { getStableSelector, resolveElementBySelector, EDITOR_ID_ATTR } from '../dom/editor-ids';

interface CollabPresence {
  userId: string;
  userName: string;
  userColor?: string;
  isTyping?: boolean;
  cursor?: { x: number; y: number };
  selectedElement?: string;
  textCursor?: { elementId: string; offset: number };
}

interface CollabLock {
  userId: string;
  userName: string;
  expiresAt: number;
}

export function renderCollaborators(ctx: EditorContext, presences: CollabPresence[] = []) {
  const container = document.getElementById('collaborators');
  if (!container) return;
  container.innerHTML = '';

  const users = presences.length > 0 ? presences : (ctx.state.collaborators as CollabPresence[]);
  const maxDisplay = 5;
  const displayed = users.slice(0, maxDisplay);
  const overflow = users.length - maxDisplay;

  displayed.forEach(user => {
    const avatar = document.createElement('div');
    avatar.className = 'collaborator-avatar';
    avatar.style.backgroundColor = user.userColor || '#666';
    avatar.title = user.userName + (user.isTyping ? ' (typing...)' : '');
    avatar.textContent = user.userName?.charAt(0)?.toUpperCase() || '?';

    if (user.isTyping) {
      avatar.classList.add('typing');
      avatar.style.boxShadow = '0 0 0 2px ' + (user.userColor || '#666');
    }

    container.appendChild(avatar);
  });

  if (overflow > 0) {
    const more = document.createElement('div');
    more.className = 'collaborator-avatar collaborator-overflow';
    more.textContent = '+' + overflow;
    more.title = users.slice(maxDisplay).map(u => u.userName).join(', ');
    container.appendChild(more);
  }
}

export function connectWebSocket(ctx: EditorContext) {
  if (!window.EditorCollab) return;
  const instance = new window.EditorCollab(
    ctx.config.artifactId,
    ctx.config.userId ?? '',
    ctx.config.userName ?? '',
    ctx.config.userAvatar
  );
  ctx.collab.instance = instance;

  instance.on('presenceUpdate', (raw) => {
    const presences = raw as CollabPresence[];
    ctx.state.collaborators = presences;
    renderCollaborators(ctx, presences);
    renderRemoteCursors(ctx, presences);
    renderRemoteSelections(ctx, presences);
    renderInlineTextCursors(ctx, presences);
  });

  instance.on('lockUpdate', (raw) => {
    renderLockedElements(ctx, raw as Map<string, CollabLock>);
  });

  // Remote doc changes arrive as Yjs frames on the socket and apply to ctx.yjsDoc,
  // which the element/text managers mirror into the canvas DOM.
  instance.attachDoc(ctx.yjsDoc);
  instance.connect();

  const canvasArea = document.querySelector('.canvas');
  canvasArea?.addEventListener('mousemove', (e) => {
    const rect = canvasArea.getBoundingClientRect();
    const mouse = e as MouseEvent;
    instance.updateCursor(mouse.clientX - rect.left, mouse.clientY - rect.top);
  });
}

const cursorLastSeen = new Map<string, number>();
const CURSOR_FADE_MS = 3000;
const CURSOR_REMOVE_MS = 10000;

export function renderRemoteCursors(ctx: EditorContext, presences: CollabPresence[]) {
  let container = document.getElementById('remote-cursors');
  if (!container) {
    container = document.createElement('div');
    container.id = 'remote-cursors';
    container.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:100;';
    document.querySelector('.canvas')?.appendChild(container);
  }

  const activeUserIds = new Set<string>();

  presences.forEach(user => {
    if (!user.cursor) return;
    if (user.userId === ctx.config.userId) return;

    activeUserIds.add(user.userId);
    cursorLastSeen.set(user.userId, Date.now());

    let cursor = container.querySelector(`[data-cursor-user="${user.userId}"]`) as HTMLElement;

    if (!cursor) {
      cursor = document.createElement('div');
      cursor.className = 'remote-cursor';
      cursor.setAttribute('data-cursor-user', user.userId);
      cursor.style.cssText = `
        position: absolute;
        pointer-events: none;
        z-index: 101;
        transition: left 100ms ease-out, top 100ms ease-out, opacity 300ms ease;
        opacity: 1;
      `;

      cursor.innerHTML = `
        <svg width="16" height="20" viewBox="0 0 16 20" style="filter: drop-shadow(0 1px 2px rgba(0,0,0,0.3));">
          <path d="M0 0L16 12L8 12L4 20L0 0Z" fill="${user.userColor || '#666'}"/>
        </svg>
        <span style="
          position: absolute;
          left: 16px;
          top: 12px;
          background: ${user.userColor || '#666'};
          color: white;
          font-size: 11px;
          padding: 2px 6px;
          border-radius: 3px;
          white-space: nowrap;
        ">${user.userName}</span>
      `;

      container.appendChild(cursor);
    }

    cursor.style.left = `${user.cursor.x}px`;
    cursor.style.top = `${user.cursor.y}px`;
    cursor.style.opacity = '1';
  });

  const now = Date.now();
  container.querySelectorAll<HTMLElement>('[data-cursor-user]').forEach((cursorEl) => {
    const userId = cursorEl.getAttribute('data-cursor-user');
    if (!userId) return;

    if (!activeUserIds.has(userId)) {
      const lastSeen = cursorLastSeen.get(userId) || 0;
      const elapsed = now - lastSeen;

      if (elapsed > CURSOR_REMOVE_MS) {
        cursorEl.remove();
        cursorLastSeen.delete(userId);
      } else if (elapsed > CURSOR_FADE_MS) {
        cursorEl.style.opacity = '0.3';
      }
    }
  });
}

export function renderRemoteSelections(ctx: EditorContext, presences: CollabPresence[]) {
  let container = document.getElementById('remote-selections');
  if (!container) {
    container = document.createElement('div');
    container.id = 'remote-selections';
    container.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;pointer-events:none;z-index:99;';
    document.querySelector('.canvas')?.appendChild(container);
  }
  container.innerHTML = '';

  presences.forEach(user => {
    if (!user.selectedElement) return;
    if (user.userId === ctx.config.userId) return; // Skip current user

    const doc = ctx.dom.canvasFrame?.contentDocument;
    if (!doc) return;

    const el = resolveElementBySelector(doc, user.selectedElement);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const frameRect = ctx.dom.canvasFrame.getBoundingClientRect();
    const canvasRect = document.querySelector('.canvas')?.getBoundingClientRect();
    if (!canvasRect) return;

    const outline = document.createElement('div');
    outline.className = 'remote-selection';
    outline.style.cssText = `
      position: absolute;
      left: ${rect.left - canvasRect.left + frameRect.left - canvasRect.left}px;
      top: ${rect.top - canvasRect.top + frameRect.top - canvasRect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      border: 2px dashed ${user.userColor || '#666'};
      pointer-events: none;
      box-sizing: border-box;
    `;

    const label = document.createElement('span');
    label.style.cssText = `
      position: absolute;
      top: -20px;
      left: 0;
      background: ${user.userColor || '#666'};
      color: white;
      font-size: 10px;
      padding: 2px 4px;
      border-radius: 2px;
      white-space: nowrap;
    `;
    label.textContent = user.userName;
    outline.appendChild(label);

    container.appendChild(outline);
  });
}

export function renderLockedElements(ctx: EditorContext, locks: Map<string, CollabLock>) {
  const doc = ctx.dom.canvasFrame?.contentDocument;
  if (!doc) return;

  doc.querySelectorAll<HTMLElement>('[data-locked-by]').forEach(el => {
    el.removeAttribute('data-locked-by');
    el.style.outline = '';
  });

  locks.forEach((lock, selector) => {
    if (lock.userId === ctx.config.userId) return;
    if (Date.now() >= lock.expiresAt) return;

    const el = resolveElementBySelector(doc, selector);
    if (!el) return;

    el.setAttribute('data-locked-by', lock.userName);
    (el as HTMLElement).style.outline = '2px solid #f59e0b';
  });
}

export function renderInlineTextCursors(ctx: EditorContext, presences: CollabPresence[]) {
  const doc = ctx.dom.canvasFrame?.contentDocument;
  if (!doc) return;

  doc.querySelectorAll('.remote-text-cursor').forEach(el => el.remove());

  presences.forEach(user => {
    if (!user.textCursor) return;
    if (user.userId === ctx.config.userId) return;

    const { elementId, offset } = user.textCursor;
    const el = resolveElementBySelector(doc, `[data-editor-id="${elementId}"]`);
    if (!el) return;

    const textNode = el.firstChild;
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return;

    const text = textNode.textContent || '';
    const clampedOffset = Math.min(offset, text.length);

    const range = doc.createRange();
    try {
      range.setStart(textNode, clampedOffset);
      range.setEnd(textNode, clampedOffset);
    } catch {
      return;
    }

    const rects = range.getClientRects();
    if (rects.length === 0) return;

    const rect = rects[0];
    const frameRect = ctx.dom.canvasFrame.getBoundingClientRect();

    const cursor = doc.createElement('span');
    cursor.className = 'remote-text-cursor';
    cursor.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: 2px;
      height: ${rect.height || 16}px;
      background: ${user.userColor || '#666'};
      pointer-events: none;
      z-index: 1000;
      animation: blink-cursor 1s step-end infinite;
    `;

    const label = doc.createElement('span');
    label.style.cssText = `
      position: absolute;
      top: -18px;
      left: 0;
      background: ${user.userColor || '#666'};
      color: white;
      font-size: 10px;
      padding: 1px 4px;
      border-radius: 2px;
      white-space: nowrap;
    `;
    label.textContent = user.userName;
    cursor.appendChild(label);

    doc.body.appendChild(cursor);
  });
}

export function broadcastSelection(ctx: EditorContext, element: Element | null) {
  if (!ctx.collab.instance || !element) return;

  const selector = getStableSelector(element);
  ctx.collab.instance.updateSelection(selector);
  ctx.collab.instance.acquireLock(selector);
}

export function canEditElement(ctx: EditorContext, element: Element | null) {
  if (!ctx.collab.instance || !element) return true;
  const selector = getStableSelector(element);
  return ctx.collab.instance.canEdit(selector);
}

