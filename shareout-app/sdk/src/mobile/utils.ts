/**
 * Viewport, theme, and scroll utilities for mobile artifacts.
 */

import type { MobileUtilsApi } from './types';

/** Factory for the utils namespace on `ShareOut.mobile`. */
export function createMobileUtils(): MobileUtilsApi {
  return {
    preventOverscroll() {
      document.body.style.overscrollBehavior = 'none';
      document.documentElement.style.overscrollBehavior = 'none';
    },

    setMobileViewport() {
      let viewport = document.querySelector('meta[name="viewport"]');
      if (!viewport) {
        viewport = document.createElement('meta');
        viewport.setAttribute('name', 'viewport');
        document.head.appendChild(viewport);
      }
      viewport.setAttribute(
        'content',
        'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover',
      );
    },

    setThemeColor(color) {
      let meta = document.querySelector('meta[name="theme-color"]');
      if (!meta) {
        meta = document.createElement('meta');
        meta.setAttribute('name', 'theme-color');
        document.head.appendChild(meta);
      }
      meta.setAttribute('content', color);
    },

    disableSelection(element) {
      element.style.userSelect = 'none';
      element.style.webkitUserSelect = 'none';
      (element.style as CSSStyleDeclaration & { webkitTouchCallout?: string }).webkitTouchCallout = 'none';
    },

    enableMomentumScroll(element) {
      (element.style as CSSStyleDeclaration & { webkitOverflowScrolling?: string }).webkitOverflowScrolling =
        'touch';
      element.style.overflowY = 'auto';
    },
  };
}
