import type { EditorContext } from '../editor/context';
import { SDK_DETECTION_PATTERNS } from '../sdk-patterns';
import { escapeHtml, rgbToHex } from '../utils';
import { showToast } from '../toast';
import { getElementSelector as buildElementSelector } from '../dom/element-selector';
import { renderCanvas } from '../canvas/render-canvas';
import { renderSelectionHandles } from '../canvas/selection';
import { syncHtmlFromCanvas } from '../history/html-sync';
import { pushUndo } from '../history/undo-redo';
import { markDirty } from '../persistence/draft';
import { renderPropertyPanel } from '../properties/property-panel';

export function toggleStyle(
  ctx: EditorContext,
  element: HTMLElement,
  property: string,
  activeValue: string,
  inactiveValue: string,
) {
  const style = element.style as unknown as Record<string, string>;
  const current = style[property];
  style[property] = current === activeValue ? inactiveValue : activeValue;
  pushUndo(ctx.state);
  markDirty(ctx);
  syncHtmlFromCanvas(ctx);
  renderPropertyPanel(ctx, element);
}

export function duplicateElement(ctx: EditorContext, element: HTMLElement) {
  const clone = element.cloneNode(true) as HTMLElement;
  clone.style.position = 'relative';
  clone.style.top = '10px';
  clone.style.left = '10px';
  element.parentNode?.insertBefore(clone, element.nextSibling);
  pushUndo(ctx.state);
  markDirty(ctx);
  syncHtmlFromCanvas(ctx);
  ctx.selectElement(clone);
}

export function nudgeElement(ctx: EditorContext, element: HTMLElement, direction: string, amount: number) {
  const current = parseInt(element.style.marginTop || '0');
  const currentLeft = parseInt(element.style.marginLeft || '0');

  switch (direction) {
    case 'ArrowUp':
      element.style.marginTop = (current - amount) + 'px';
      break;
    case 'ArrowDown':
      element.style.marginTop = (current + amount) + 'px';
      break;
    case 'ArrowLeft':
      element.style.marginLeft = (currentLeft - amount) + 'px';
      break;
    case 'ArrowRight':
      element.style.marginLeft = (currentLeft + amount) + 'px';
      break;
  }

  pushUndo(ctx.state);
  markDirty(ctx);
  syncHtmlFromCanvas(ctx);
  renderSelectionHandles(element, ctx.dom);
}

export function resizeElement(ctx: EditorContext, element: HTMLElement, direction: 'up' | 'down', amount = 1) {
  const computed = ctx.dom.canvasFrame?.contentWindow?.getComputedStyle(element);
  if (!computed) return;

  const currentFontSize = parseInt(computed.fontSize) || 16;
  const currentWidth = parseInt(computed.width) || element.offsetWidth;
  const currentHeight = parseInt(computed.height) || element.offsetHeight;

  const tag = element.tagName.toLowerCase();
  const isText = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'a', 'li', 'label', 'td', 'th'].includes(tag);

  if (isText) {
    const newSize = direction === 'up' ? currentFontSize + amount : Math.max(8, currentFontSize - amount);
    element.style.fontSize = newSize + 'px';
  } else {
    const scaleFactor = direction === 'up' ? 1 + (amount * 0.05) : 1 - (amount * 0.05);
    const newWidth = Math.max(20, Math.round(currentWidth * scaleFactor));
    const newHeight = Math.max(20, Math.round(currentHeight * scaleFactor));
    element.style.width = newWidth + 'px';
    element.style.height = newHeight + 'px';
  }

  pushUndo(ctx.state);
  markDirty(ctx);
  syncHtmlFromCanvas(ctx);
  renderSelectionHandles(element, ctx.dom);
}
