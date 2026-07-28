// @ts-nocheck
import html2canvas from 'html2canvas';
import type { EditorContext } from '../editor/context';
import type { LassoContext } from '../editor/types';
import { setCanvasToolCursor } from '../canvas/editor-styles';
import { setChatState } from '../chat/chat';
import { escapeHtml } from '../utils';

export function activateLasso(ctx: EditorContext) {
  ctx.state.tool = 'lasso';

  const overlay = document.createElement('div');
  overlay.id = 'lasso-overlay';
  overlay.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    cursor: crosshair;
    z-index: 1000;
    user-select: none;
    -webkit-user-select: none;
  `;
  overlay.setAttribute('tabindex', '0');

  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'width: 100%; height: 100%; pointer-events: none;';
  overlay.appendChild(canvas);

  const canvasArea = document.getElementById('canvas');
  if (!canvasArea) {
    console.error('Canvas area not found');
    ctx.state.tool = 'select';
    return;
  }

  document.body.style.userSelect = 'none';
  (document.body.style as any).webkitUserSelect = 'none';
  document.body.classList.add('lasso-active');

  const iframeDoc = ctx.dom.canvasFrame.contentDocument;
  if (iframeDoc) {
    setCanvasToolCursor(iframeDoc, 'lasso');
  }

  canvasArea.appendChild(overlay);
  overlay.focus();

  const canvasCtx = canvas.getContext('2d');
  const rect = canvasArea.getBoundingClientRect();
  canvas.width = rect.width;
  canvas.height = rect.height;

  let isDrawing = false;
  let path = [];

  overlay.addEventListener('mousedown', (e) => {
    isDrawing = true;
    path = [{ x: e.offsetX, y: e.offsetY }];
    canvasCtx.clearRect(0, 0, canvas.width, canvas.height);
    canvasCtx.beginPath();
    canvasCtx.moveTo(e.offsetX, e.offsetY);
    canvasCtx.strokeStyle = '#3b82f6';
    canvasCtx.lineWidth = 2;
    canvasCtx.setLineDash([5, 5]);
  });

  overlay.addEventListener('mousemove', (e) => {
    if (!isDrawing) return;
    path.push({ x: e.offsetX, y: e.offsetY });
    canvasCtx.lineTo(e.offsetX, e.offsetY);
    canvasCtx.stroke();
  });

  overlay.addEventListener('mouseup', async (e) => {
    if (!isDrawing) return;
    isDrawing = false;

    try {
      if (path.length > 0) {
        canvasCtx.lineTo(path[0].x, path[0].y);
        canvasCtx.stroke();
      }

      const minX = Math.min(...path.map(p => p.x));
      const maxX = Math.max(...path.map(p => p.x));
      const minY = Math.min(...path.map(p => p.y));
      const maxY = Math.max(...path.map(p => p.y));

      const frameRect = ctx.dom.canvasFrame.getBoundingClientRect();
      const areaRect = canvasArea.getBoundingClientRect();
      const offsetX = frameRect.left - areaRect.left;
      const offsetY = frameRect.top - areaRect.top;

      const bounds = { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
      const iframeBounds = {
        x: Math.max(0, minX - offsetX),
        y: Math.max(0, minY - offsetY),
        w: bounds.w,
        h: bounds.h,
      };

      const elementsData = extractElementsInBounds(ctx, iframeBounds);
      const imageData = await captureScreenshot(ctx, iframeBounds);

      const lassoContext: LassoContext = {
        imageData,
        bounds,
        elementsHtml: elementsData.html,
        elementsCount: elementsData.count,
        labels: elementsData.labels,
      };

      ctx.state.lassoContext = lassoContext;
      addLassoThumbnailToChat(ctx, lassoContext);
    } catch (err) {
      console.error('Lasso failed:', err);
    } finally {
      cleanupLasso();
    }
  });

  const cleanupLasso = () => {
    overlay.remove();
    document.body.style.userSelect = '';
    (document.body.style as any).webkitUserSelect = '';
    document.body.classList.remove('lasso-active');
    if (iframeDoc) {
      setCanvasToolCursor(iframeDoc, 'select');
    }
    ctx.state.tool = 'select';
  };

  overlay.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cleanupLasso();
    }
  });
}

function extractElementsInBounds(
  ctx: EditorContext,
  bounds: { x: number; y: number; w: number; h: number }
): { html: string; count: number } {
  const iframeDoc = ctx.dom.canvasFrame.contentDocument;
  if (!iframeDoc) return { html: '', count: 0 };

  const elements: Element[] = [];
  const scrollX = iframeDoc.documentElement.scrollLeft || 0;
  const scrollY = iframeDoc.documentElement.scrollTop || 0;

  const checkBounds = {
    left: bounds.x + scrollX,
    top: bounds.y + scrollY,
    right: bounds.x + bounds.w + scrollX,
    bottom: bounds.y + bounds.h + scrollY,
  };

  const allElements = iframeDoc.body.querySelectorAll('*');
  for (const el of allElements) {
    const rect = el.getBoundingClientRect();
    const elBounds = {
      left: rect.left + scrollX,
      top: rect.top + scrollY,
      right: rect.right + scrollX,
      bottom: rect.bottom + scrollY,
    };

    const intersects =
      elBounds.left < checkBounds.right &&
      elBounds.right > checkBounds.left &&
      elBounds.top < checkBounds.bottom &&
      elBounds.bottom > checkBounds.top;

    if (intersects) {
      const isContainer = el.querySelector('*') !== null;
      if (!isContainer || el.children.length === 0) {
        elements.push(el);
      } else {
        const childrenInBounds = Array.from(el.children).some(child => {
          const childRect = child.getBoundingClientRect();
          return (
            childRect.left + scrollX < checkBounds.right &&
            childRect.right + scrollX > checkBounds.left &&
            childRect.top + scrollY < checkBounds.bottom &&
            childRect.bottom + scrollY > checkBounds.top
          );
        });
        if (!childrenInBounds) {
          elements.push(el);
        }
      }
    }
  }

  const topLevelElements = elements.filter(el => {
    return !elements.some(other => other !== el && other.contains(el));
  });

  const htmlParts = topLevelElements.slice(0, 20).map(el => {
    const tag = el.tagName.toLowerCase();
    const classes = el.className ? ` class="${el.className}"` : '';
    const id = el.id ? ` id="${el.id}"` : '';
    return `<${tag}${id}${classes}>${el.innerHTML}</${tag}>`;
  });

  const labels = topLevelElements.slice(0, 12).map(el => {
    const tag = el.tagName.toLowerCase();
    if (el.id) return `${tag}#${el.id}`;
    const cls = typeof el.className === 'string' && el.className.trim()
      ? `.${el.className.trim().split(/\s+/)[0]}`
      : '';
    return `${tag}${cls}`;
  });

  return {
    html: htmlParts.join('\n'),
    count: topLevelElements.length,
    labels,
  };
}

async function captureScreenshot(
  ctx: EditorContext,
  bounds: { x: number; y: number; w: number; h: number }
): Promise<string> {
  const iframeDoc = ctx.dom.canvasFrame.contentDocument;
  if (!iframeDoc) {
    return createFallbackImage(bounds.w, bounds.h);
  }

  try {
    const fullCanvas = await html2canvas(iframeDoc.body, {
      useCORS: true,
      allowTaint: true,
      backgroundColor: '#ffffff',
      logging: false,
      scale: 2,
      imageTimeout: 0,
      onclone: (clonedDoc) => {
        const style = clonedDoc.createElement('style');
        style.textContent = '* { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }';
        clonedDoc.head.appendChild(style);
      },
    });

    const scale = 2;
    const cropX = Math.max(0, bounds.x * scale);
    const cropY = Math.max(0, bounds.y * scale);
    const cropWidth = Math.min(bounds.w * scale, fullCanvas.width - cropX);
    const cropHeight = Math.min(bounds.h * scale, fullCanvas.height - cropY);

    const croppedCanvas = document.createElement('canvas');
    croppedCanvas.width = bounds.w;
    croppedCanvas.height = bounds.h;
    const croppedCtx = croppedCanvas.getContext('2d');

    croppedCtx.imageSmoothingEnabled = true;
    croppedCtx.imageSmoothingQuality = 'high';
    croppedCtx.drawImage(
      fullCanvas,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      0,
      0,
      bounds.w,
      bounds.h
    );

    return croppedCanvas.toDataURL('image/png', 1.0);
  } catch (err) {
    console.error('Screenshot capture failed:', err);
    return createFallbackImage(bounds.w, bounds.h);
  }
}

function createFallbackImage(width: number, height: number): string {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#f8f9fa';
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = '#dee2e6';
  ctx.strokeRect(0, 0, width, height);
  ctx.fillStyle = '#6c757d';
  ctx.font = '14px system-ui';
  ctx.textAlign = 'center';
  ctx.fillText('Selected region', width / 2, height / 2);
  return canvas.toDataURL('image/png');
}

function addLassoThumbnailToChat(ctx: EditorContext, lassoContext: LassoContext) {
  const existing = document.getElementById('lasso-thumbnail-container');
  if (existing) existing.remove();

  const labels = lassoContext.labels || [];
  const shown = labels.slice(0, 6);
  const overflow = lassoContext.elementsCount - shown.length;
  const pills = shown
    .map((l) => `<span class="lasso-pill">${escapeHtml(l)}</span>`)
    .join('') + (overflow > 0 ? `<span class="lasso-pill lasso-pill-more">+${overflow}</span>` : '');

  const container = document.createElement('div');
  container.id = 'lasso-thumbnail-container';
  container.className = 'lasso-card';
  container.innerHTML = `
    <img class="lasso-thumb" src="${lassoContext.imageData}" alt="Selected region">
    <div class="lasso-card-body">
      <div class="lasso-card-title">Selected region · ${lassoContext.elementsCount} element${lassoContext.elementsCount !== 1 ? 's' : ''}</div>
      <div class="lasso-pills">${pills}</div>
    </div>
    <button class="lasso-card-remove" title="Clear selection" aria-label="Clear selection">&times;</button>
  `;

  container.querySelector('.lasso-card-remove')?.addEventListener('click', () => {
    container.remove();
    ctx.state.lassoContext = null;
  });

  const inputBar = document.querySelector('.rail-input-bar');
  if (inputBar) {
    inputBar.insertBefore(container, inputBar.firstChild);
  }

  setChatState(ctx, 'focused');
  ctx.dom.chatInput?.focus();
}

export function clearLassoContext(ctx: EditorContext) {
  ctx.state.lassoContext = null;
  const container = document.getElementById('lasso-thumbnail-container');
  if (container) container.remove();
}
