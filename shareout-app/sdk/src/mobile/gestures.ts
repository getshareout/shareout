/**
 * Touch gesture recognition (swipe, long-press, double-tap, pan).
 */

import type { GestureEvent, GestureHandle, GestureOptions, GesturesApi, HapticsApi, NavigationApi } from './types';

type GestureCallback = (detail: Record<string, number>) => void;

function resolveElement(element: HTMLElement | string): HTMLElement {
  const el = typeof element === 'string' ? document.querySelector<HTMLElement>(element) : element;
  if (!el) throw new Error('Element not found');
  return el;
}

function createGestureHandler(
  element: HTMLElement,
  haptics: HapticsApi,
  options: GestureOptions = {},
): GestureHandle {
  const state = { startX: 0, startY: 0, startTime: 0, isTracking: false };

  const config = {
    swipeThreshold: options.swipeThreshold ?? 50,
    swipeVelocity: options.swipeVelocity ?? 0.3,
    longPressDelay: options.longPressDelay ?? 500,
    doubleTapDelay: options.doubleTapDelay ?? 300,
  };

  let longPressTimer: ReturnType<typeof setTimeout> | null = null;
  let lastTapTime = 0;

  const callbacks: Record<GestureEvent, GestureCallback[]> = {
    swipeLeft: [],
    swipeRight: [],
    swipeUp: [],
    swipeDown: [],
    longPress: [],
    doubleTap: [],
    pan: [],
    pinch: [],
  };

  function handleTouchStart(e: TouchEvent) {
    const touch = e.touches[0];
    state.startX = touch.clientX;
    state.startY = touch.clientY;
    state.startTime = Date.now();
    state.isTracking = true;

    longPressTimer = setTimeout(() => {
      if (state.isTracking) {
        callbacks.longPress.forEach((cb) => cb({ x: state.startX, y: state.startY }));
        haptics.medium();
      }
    }, config.longPressDelay);
  }

  function handleTouchMove(e: TouchEvent) {
    if (!state.isTracking) return;

    if (longPressTimer) clearTimeout(longPressTimer);

    const touch = e.touches[0];
    const deltaX = touch.clientX - state.startX;
    const deltaY = touch.clientY - state.startY;

    callbacks.pan.forEach((cb) =>
      cb({ deltaX, deltaY, x: touch.clientX, y: touch.clientY }),
    );
  }

  function handleTouchEnd(e: TouchEvent) {
    if (!state.isTracking) return;

    if (longPressTimer) clearTimeout(longPressTimer);
    state.isTracking = false;

    const touch = e.changedTouches[0];
    const deltaX = touch.clientX - state.startX;
    const deltaY = touch.clientY - state.startY;
    const deltaTime = Date.now() - state.startTime;
    const velocity = Math.sqrt(deltaX * deltaX + deltaY * deltaY) / deltaTime;

    const now = Date.now();
    if (
      now - lastTapTime < config.doubleTapDelay &&
      Math.abs(deltaX) < 10 &&
      Math.abs(deltaY) < 10
    ) {
      callbacks.doubleTap.forEach((cb) => cb({ x: touch.clientX, y: touch.clientY }));
      lastTapTime = 0;
      return;
    }
    lastTapTime = now;

    if (velocity >= config.swipeVelocity) {
      if (Math.abs(deltaX) > Math.abs(deltaY)) {
        if (deltaX > config.swipeThreshold) {
          callbacks.swipeRight.forEach((cb) => cb({ velocity, deltaX }));
        } else if (deltaX < -config.swipeThreshold) {
          callbacks.swipeLeft.forEach((cb) => cb({ velocity, deltaX: -deltaX }));
        }
      } else {
        if (deltaY > config.swipeThreshold) {
          callbacks.swipeDown.forEach((cb) => cb({ velocity, deltaY }));
        } else if (deltaY < -config.swipeThreshold) {
          callbacks.swipeUp.forEach((cb) => cb({ velocity, deltaY: -deltaY }));
        }
      }
    }
  }

  element.addEventListener('touchstart', handleTouchStart, { passive: true });
  element.addEventListener('touchmove', handleTouchMove, { passive: true });
  element.addEventListener('touchend', handleTouchEnd, { passive: true });

  return {
    on(event, callback) {
      callbacks[event].push(callback);
      return this;
    },
    off(event, callback) {
      const idx = callbacks[event].indexOf(callback);
      if (idx > -1) callbacks[event].splice(idx, 1);
      return this;
    },
    destroy() {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
      if (longPressTimer) clearTimeout(longPressTimer);
    },
  };
}

/** Factory for the gestures namespace on `ShareOut.mobile`. */
export function createGestures(haptics: HapticsApi, navigation: NavigationApi): GesturesApi {
  return {
    create(element, options = {}) {
      return createGestureHandler(resolveElement(element), haptics, options);
    },

    enableSwipeBack(element, options = {}) {
      const handler = this.create(element, options);
      handler.on('swipeRight', () => {
        if (navigation.canGoBack()) {
          haptics.light();
          navigation.pop();
        }
      });
      return handler;
    },
  };
}
