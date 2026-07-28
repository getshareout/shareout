// Floating action menu for selected elements
import type { EditorContext } from '../editor/context';
import { setChatState } from '../chat/chat';
import { pushUndo } from '../history/undo-redo';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { markDirty } from '../persistence/draft';
import { renderSelectionHandles } from '../canvas/selection';

export function setupFloatingMenu(ctx: EditorContext): void {
  const menu = ctx.dom.floatingMenu;
  if (!menu) return;

  menu.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = (e.target as HTMLElement).closest('[data-action]') as HTMLElement;
    if (!btn) return;

    const action = btn.dataset.action;
    const element = ctx.state.selectedElement;
    if (!element) return;

    switch (action) {
      case 'delete':
        handleDelete(ctx, element);
        break;
      case 'ai':
        handleAI(ctx, element);
        break;
      case 'move-up':
        handleMoveUp(ctx, element);
        break;
      case 'move-down':
        handleMoveDown(ctx, element);
        break;
      case 'size-increase':
        handleSizeIncrease(ctx, element);
        break;
      case 'size-decrease':
        handleSizeDecrease(ctx, element);
        break;
    }
  });

  // Close floating menu when clicking outside
  document.addEventListener('click', (e) => {
    if (!menu || menu.hidden) return;

    const target = e.target as HTMLElement;
    if (!menu.contains(target)) {
      menu.hidden = true;
      ctx.state.selectedElement = null;
      renderSelectionHandles(null, ctx.dom);
    }
  });

  setupInlineColors(ctx);
}

function setupInlineColors(ctx: EditorContext): void {
  const colorInput = document.getElementById('style-color') as HTMLInputElement;
  const bgInput = document.getElementById('style-bg') as HTMLInputElement;

  let undoPushed = false;

  const applyColor = () => {
    const element = ctx.state.selectedElement as HTMLElement;
    if (!element) return;

    if (!undoPushed) {
      pushUndo(ctx.state);
      undoPushed = true;
    }

    if (colorInput) element.style.color = colorInput.value;

    syncHtmlFromCanvas(ctx);
    markDirty(ctx);
    renderSelectionHandles(element, ctx.dom);
  };

  const applyBg = () => {
    const element = ctx.state.selectedElement as HTMLElement;
    if (!element) return;

    if (!undoPushed) {
      pushUndo(ctx.state);
      undoPushed = true;
    }

    if (bgInput) element.style.backgroundColor = bgInput.value;

    syncHtmlFromCanvas(ctx);
    markDirty(ctx);
    renderSelectionHandles(element, ctx.dom);
  };

  colorInput?.addEventListener('input', applyColor);
  bgInput?.addEventListener('input', applyBg);

  // Reset undo flag when menu closes
  const menu = ctx.dom.floatingMenu;
  if (menu) {
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.attributeName === 'hidden' && (m.target as HTMLElement).hidden) {
          undoPushed = false;
        }
      }
    });
    observer.observe(menu, { attributes: true });
  }
}

function handleDelete(ctx: EditorContext, element: Element): void {
  pushUndo(ctx.state);
  element.remove();
  ctx.state.selectedElement = null;
  renderSelectionHandles(null, ctx.dom);

  if (ctx.dom.floatingMenu) {
    ctx.dom.floatingMenu.hidden = true;
  }

  syncHtmlFromCanvas(ctx);
  markDirty(ctx);
}

function handleAI(ctx: EditorContext, element: Element): void {
  const tagName = element.tagName.toLowerCase();
  const id = element.id ? `#${element.id}` : '';
  const className = element.className ? `.${String(element.className).split(' ')[0]}` : '';

  const hint = `${tagName}${id}${className}`;
  const chatInput = ctx.dom.chatInput;

  if (chatInput) {
    chatInput.value = `For the ${hint} element: `;
    chatInput.focus();
    setChatState(ctx, 'focused');
  }
}

function handleMoveUp(ctx: EditorContext, element: Element): void {
  const prev = element.previousElementSibling;
  if (!prev) return;

  pushUndo(ctx.state);
  element.parentElement?.insertBefore(element, prev);
  syncHtmlFromCanvas(ctx);
  markDirty(ctx);
  renderSelectionHandles(element, ctx.dom);
}

function handleMoveDown(ctx: EditorContext, element: Element): void {
  const next = element.nextElementSibling;
  if (!next) return;

  pushUndo(ctx.state);
  element.parentElement?.insertBefore(next, element);
  syncHtmlFromCanvas(ctx);
  markDirty(ctx);
  renderSelectionHandles(element, ctx.dom);
}

function handleSizeIncrease(ctx: EditorContext, element: Element): void {
  const el = element as HTMLElement;
  const computedStyle = ctx.dom.canvasFrame.contentWindow?.getComputedStyle(el);
  if (!computedStyle) return;

  pushUndo(ctx.state);
  const currentSize = parseInt(computedStyle.fontSize) || 16;
  const newSize = currentSize + 2;
  el.style.fontSize = `${newSize}px`;
  syncHtmlFromCanvas(ctx);
  markDirty(ctx);
  renderSelectionHandles(element, ctx.dom);
}

function handleSizeDecrease(ctx: EditorContext, element: Element): void {
  const el = element as HTMLElement;
  const computedStyle = ctx.dom.canvasFrame.contentWindow?.getComputedStyle(el);
  if (!computedStyle) return;

  pushUndo(ctx.state);
  const currentSize = parseInt(computedStyle.fontSize) || 16;
  const newSize = Math.max(10, currentSize - 2);
  el.style.fontSize = `${newSize}px`;
  syncHtmlFromCanvas(ctx);
  markDirty(ctx);
  renderSelectionHandles(element, ctx.dom);
}

function rgbToHex(rgb: string): string {
  if (!rgb || rgb === 'transparent' || rgb === 'rgba(0, 0, 0, 0)') {
    return '#ffffff';
  }

  if (rgb.startsWith('#')) return rgb;

  const match = rgb.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return '#ffffff';

  const r = parseInt(match[1]).toString(16).padStart(2, '0');
  const g = parseInt(match[2]).toString(16).padStart(2, '0');
  const b = parseInt(match[3]).toString(16).padStart(2, '0');

  return `#${r}${g}${b}`;
}

export function syncColorInputsToElement(element: Element | null): void {
  if (!element) return;

  const colorInput = document.getElementById('style-color') as HTMLInputElement;
  const bgInput = document.getElementById('style-bg') as HTMLInputElement;

  const iframe = document.getElementById('canvas-frame') as HTMLIFrameElement;
  const computedStyle = iframe?.contentWindow?.getComputedStyle(element as HTMLElement);

  if (computedStyle) {
    if (colorInput) {
      colorInput.value = rgbToHex(computedStyle.color) || '#1c1917';
    }
    if (bgInput) {
      bgInput.value = rgbToHex(computedStyle.backgroundColor) || '#ffffff';
    }
  }
}
