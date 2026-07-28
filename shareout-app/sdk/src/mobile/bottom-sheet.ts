/**
 * Bottom sheet overlay with snap points and drag-to-dismiss.
 */

import type { BottomSheetHandle, BottomSheetOptions, HapticsApi } from './types';

/**
 * Create a modal bottom sheet anchored to the viewport.
 *
 * @param haptics - Haptics API used on open.
 * @param options - Snap points, backdrop, and initial content.
 */
export function createBottomSheet(
  haptics: HapticsApi,
  options: BottomSheetOptions = {},
): BottomSheetHandle {
  const config = {
    snapPoints: options.snapPoints ?? [0.25, 0.5, 0.9],
    initialSnap: options.initialSnap ?? 0,
    dismissible: options.dismissible !== false,
    backdrop: options.backdrop !== false,
    content: options.content ?? '',
  };

  const backdrop = document.createElement('div');
  backdrop.className = 'shareout-sheet-backdrop';
  backdrop.style.cssText = `
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.5);
    opacity: 0;
    transition: opacity 0.3s ease;
    z-index: 9998;
  `;

  const sheet = document.createElement('div');
  sheet.className = 'shareout-bottom-sheet';
  sheet.style.cssText = `
    position: fixed;
    left: 0;
    right: 0;
    bottom: 0;
    background: white;
    border-radius: 16px 16px 0 0;
    transform: translateY(100%);
    transition: transform 0.3s ease;
    z-index: 9999;
    max-height: 90vh;
    overflow: hidden;
  `;

  const handle = document.createElement('div');
  handle.style.cssText = `
    width: 40px;
    height: 4px;
    background: #ccc;
    border-radius: 2px;
    margin: 12px auto;
  `;

  const contentEl = document.createElement('div');
  contentEl.className = 'shareout-sheet-content';
  contentEl.style.cssText = `
    padding: 0 16px 16px;
    overflow-y: auto;
    max-height: calc(90vh - 30px);
  `;

  if (typeof config.content === 'string') {
    contentEl.innerHTML = config.content;
  } else if (config.content instanceof HTMLElement) {
    contentEl.appendChild(config.content);
  }

  sheet.appendChild(handle);
  sheet.appendChild(contentEl);

  let currentSnap = config.initialSnap;
  let open = false;
  let startY = 0;
  let startTranslate = 0;

  function snapTo(snapIndex: number) {
    currentSnap = Math.max(0, Math.min(snapIndex, config.snapPoints.length - 1));
    const snapHeight = config.snapPoints[currentSnap] * window.innerHeight;
    sheet.style.transform = `translateY(${window.innerHeight - snapHeight}px)`;
  }

  function handleStart(e: TouchEvent) {
    startY = e.touches[0].clientY;
    const match = sheet.style.transform.match(/translateY\(([^)]+)px\)/);
    startTranslate = match ? parseFloat(match[1]) : window.innerHeight;
    sheet.style.transition = 'none';
  }

  function handleMove(e: TouchEvent) {
    const deltaY = e.touches[0].clientY - startY;
    const newTranslate = Math.max(
      window.innerHeight * (1 - config.snapPoints[config.snapPoints.length - 1]),
      startTranslate + deltaY,
    );
    sheet.style.transform = `translateY(${newTranslate}px)`;
  }

  function handleEnd() {
    sheet.style.transition = 'transform 0.3s ease';

    const match = sheet.style.transform.match(/translateY\(([^)]+)px\)/);
    const currentTranslate = match ? parseFloat(match[1]) : window.innerHeight;
    const currentHeight = window.innerHeight - currentTranslate;

    let closestSnap = 0;
    let closestDist = Infinity;

    config.snapPoints.forEach((point, i) => {
      const snapHeight = point * window.innerHeight;
      const dist = Math.abs(currentHeight - snapHeight);
      if (dist < closestDist) {
        closestDist = dist;
        closestSnap = i;
      }
    });

    if (config.dismissible && currentHeight < config.snapPoints[0] * window.innerHeight * 0.5) {
      api.close();
    } else {
      snapTo(closestSnap);
    }
  }

  handle.addEventListener('touchstart', handleStart, { passive: true });
  handle.addEventListener('touchmove', handleMove, { passive: true });
  handle.addEventListener('touchend', handleEnd, { passive: true });

  const api: BottomSheetHandle = {
    open() {
      if (open) return;
      open = true;

      document.body.appendChild(backdrop);
      document.body.appendChild(sheet);

      requestAnimationFrame(() => {
        backdrop.style.opacity = '1';
        snapTo(config.initialSnap);
      });

      haptics.light();
    },

    close() {
      if (!open) return;
      open = false;

      backdrop.style.opacity = '0';
      sheet.style.transform = 'translateY(100%)';

      setTimeout(() => {
        backdrop.remove();
        sheet.remove();
      }, 300);
    },

    snapTo(index) {
      snapTo(index);
    },

    setContent(content) {
      if (typeof content === 'string') {
        contentEl.innerHTML = content;
      } else if (content instanceof HTMLElement) {
        contentEl.innerHTML = '';
        contentEl.appendChild(content);
      }
    },

    isOpen() {
      return open;
    },

    destroy() {
      api.close();
      handle.removeEventListener('touchstart', handleStart);
      handle.removeEventListener('touchmove', handleMove);
      handle.removeEventListener('touchend', handleEnd);
    },
  };

  if (config.dismissible && config.backdrop) {
    backdrop.addEventListener('click', () => api.close());
  }

  return api;
}
