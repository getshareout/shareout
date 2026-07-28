// Inline rich-text toolbar — appears over a text selection inside an editable element
import type { EditorContext } from '../editor/context';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { markDirty } from '../persistence/draft';

let toolbarEl: HTMLElement | null = null;
let activeDoc: Document | null = null;
let ctxRef: EditorContext | null = null;

const BUTTONS = `
  <button class="fmt-btn" data-cmd="bold" title="Bold"><b>B</b></button>
  <button class="fmt-btn" data-cmd="italic" title="Italic"><i>I</i></button>
  <button class="fmt-btn" data-cmd="underline" title="Underline"><u>U</u></button>
  <span class="fmt-sep"></span>
  <button class="fmt-btn" data-cmd="h2" title="Heading">H</button>
  <button class="fmt-btn" data-cmd="p" title="Paragraph">¶</button>
  <span class="fmt-sep"></span>
  <button class="fmt-btn" data-cmd="createLink" title="Add link">🔗</button>
`;

export function setupFormatToolbar(ctx: EditorContext): void {
  ctxRef = ctx;
  if (toolbarEl) return;

  toolbarEl = document.createElement('div');
  toolbarEl.className = 'format-toolbar';
  toolbarEl.hidden = true;
  toolbarEl.innerHTML = BUTTONS;
  document.body.appendChild(toolbarEl);

  // Keep the iframe selection alive while interacting with the toolbar
  toolbarEl.addEventListener('mousedown', (e) => e.preventDefault());
  toolbarEl.addEventListener('click', onToolbarClick);

  // Reposition while scrolling/resizing the editor shell
  window.addEventListener('scroll', () => reposition(), true);
  window.addEventListener('resize', () => reposition());
}

/** (Re)bind selection tracking to the current canvas document. */
export function bindFormatToolbar(_ctx: EditorContext, doc: Document): void {
  activeDoc = doc;
  if ((doc as any).__fmtBound) return;
  (doc as any).__fmtBound = true;
  doc.addEventListener('selectionchange', reposition);
}

function onToolbarClick(e: MouseEvent): void {
  const btn = (e.target as HTMLElement).closest('[data-cmd]') as HTMLElement | null;
  if (!btn || !activeDoc) return;
  const cmd = btn.dataset.cmd!;

  if (cmd === 'createLink') {
    const url = window.prompt('Link URL:');
    if (url) activeDoc.execCommand('createLink', false, url);
  } else if (cmd === 'h2' || cmd === 'p') {
    activeDoc.execCommand('formatBlock', false, cmd.toUpperCase());
  } else {
    activeDoc.execCommand(cmd);
  }

  if (ctxRef) {
    markDirty(ctxRef);
    syncHtmlFromCanvas(ctxRef);
  }
  updateActiveStates();
  reposition();
}

function editableAncestor(node: Node | null): Element | null {
  const el = node && node.nodeType === 3 ? node.parentElement : (node as Element | null);
  return el?.closest('[contenteditable="true"]') || null;
}

function reposition(): void {
  if (!toolbarEl || !activeDoc || !ctxRef) return;
  const sel = activeDoc.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0 || !editableAncestor(sel.anchorNode)) {
    hide();
    return;
  }

  const rect = sel.getRangeAt(0).getBoundingClientRect();
  if (!rect.width && !rect.height) {
    hide();
    return;
  }

  const frameRect = ctxRef.dom.canvasFrame.getBoundingClientRect();
  toolbarEl.hidden = false;
  const tb = toolbarEl.getBoundingClientRect();

  let top = frameRect.top + rect.top - tb.height - 8;
  if (top < 70) top = frameRect.top + rect.bottom + 8;
  let left = frameRect.left + rect.left + rect.width / 2 - tb.width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - tb.width - 12));

  toolbarEl.style.top = `${top}px`;
  toolbarEl.style.left = `${left}px`;
  updateActiveStates();
}

function updateActiveStates(): void {
  if (!toolbarEl || !activeDoc) return;
  ['bold', 'italic', 'underline'].forEach((cmd) => {
    const btn = toolbarEl!.querySelector(`[data-cmd="${cmd}"]`);
    try {
      btn?.classList.toggle('active', activeDoc!.queryCommandState(cmd));
    } catch {
      /* queryCommandState can throw if not focused */
    }
  });
}

function hide(): void {
  if (toolbarEl) toolbarEl.hidden = true;
}
