/**
 * Pull-to-refresh component for scrollable mobile views.
 */

import type { HapticsApi, PullToRefreshHandle, PullToRefreshOptions } from './types';

function resolveElement(element: HTMLElement | string): HTMLElement {
  const el = typeof element === 'string' ? document.querySelector<HTMLElement>(element) : element;
  if (!el) throw new Error('Element not found');
  return el;
}

/**
 * Attach pull-to-refresh behavior to a scroll container.
 *
 * @param element - Container element or CSS selector.
 * @param onRefresh - Async callback invoked when the user releases past the threshold.
 * @param options - Threshold, resistance, and optional indicator markup.
 */
export function createPullToRefresh(
  element: HTMLElement | string,
  onRefresh: () => void | Promise<void>,
  haptics: HapticsApi,
  options: PullToRefreshOptions = {},
): PullToRefreshHandle {
  const config = {
    threshold: options.threshold ?? 80,
    maxPull: options.maxPull ?? 120,
    resistance: options.resistance ?? 2.5,
  };

  let startY = 0;
  let currentY = 0;
  let isPulling = false;
  let isRefreshing = false;

  const indicator = document.createElement('div');
  indicator.className = 'shareout-ptr-indicator';
  indicator.innerHTML =
    options.indicatorHTML ??
    '<div class="shareout-ptr-spinner"></div><div class="shareout-ptr-text">Pull to refresh</div>';
  indicator.style.cssText = `
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    height: 60px;
    display: flex;
    align-items: center;
    justify-content: center;
    transform: translateY(-100%);
    transition: transform 0.2s ease;
    pointer-events: none;
  `;

  const el = resolveElement(element);
  el.style.position = 'relative';
  el.insertBefore(indicator, el.firstChild);

  function handleTouchStart(e: TouchEvent) {
    if (isRefreshing || el.scrollTop > 0) return;
    startY = e.touches[0].clientY;
    isPulling = true;
  }

  function handleTouchMove(e: TouchEvent) {
    if (!isPulling || isRefreshing) return;

    currentY = e.touches[0].clientY;
    const pull = (currentY - startY) / config.resistance;

    if (pull > 0 && el.scrollTop === 0) {
      e.preventDefault();
      const clampedPull = Math.min(pull, config.maxPull);
      indicator.style.transform = `translateY(${clampedPull - 60}px)`;

      const text = indicator.querySelector('.shareout-ptr-text');
      if (text) {
        text.textContent = pull >= config.threshold ? 'Release to refresh' : 'Pull to refresh';
      }
    }
  }

  async function handleTouchEnd() {
    if (!isPulling || isRefreshing) return;
    isPulling = false;

    const pull = (currentY - startY) / config.resistance;

    if (pull >= config.threshold) {
      isRefreshing = true;
      haptics.medium();

      const text = indicator.querySelector('.shareout-ptr-text');
      if (text) text.textContent = 'Refreshing...';

      indicator.style.transform = 'translateY(0)';

      try {
        await onRefresh();
      } finally {
        isRefreshing = false;
        indicator.style.transform = 'translateY(-100%)';
      }
    } else {
      indicator.style.transform = 'translateY(-100%)';
    }
  }

  el.addEventListener('touchstart', handleTouchStart, { passive: true });
  el.addEventListener('touchmove', handleTouchMove, { passive: false });
  el.addEventListener('touchend', handleTouchEnd, { passive: true });

  return {
    destroy() {
      el.removeEventListener('touchstart', handleTouchStart);
      el.removeEventListener('touchmove', handleTouchMove);
      el.removeEventListener('touchend', handleTouchEnd);
      indicator.remove();
    },
    refresh() {
      if (!isRefreshing) {
        void handleTouchEnd();
      }
    },
  };
}
