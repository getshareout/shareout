/**
 * Safe-area inset helpers for notched devices and PWA standalone mode.
 */

import type { SafeAreaApi } from './types';

/** Factory for the safe-area namespace on `ShareOut.mobile`. */
export function createSafeArea(): SafeAreaApi {
  return {
    getInsets() {
      const style = getComputedStyle(document.documentElement);
      return {
        top: parseInt(
          style.getPropertyValue('--sat') || style.getPropertyValue('env(safe-area-inset-top)') || '0',
          10,
        ),
        right: parseInt(
          style.getPropertyValue('--sar') || style.getPropertyValue('env(safe-area-inset-right)') || '0',
          10,
        ),
        bottom: parseInt(
          style.getPropertyValue('--sab') || style.getPropertyValue('env(safe-area-inset-bottom)') || '0',
          10,
        ),
        left: parseInt(
          style.getPropertyValue('--sal') || style.getPropertyValue('env(safe-area-inset-left)') || '0',
          10,
        ),
      };
    },

    applyCustomProperties() {
      const root = document.documentElement;
      root.style.setProperty('--sat', 'env(safe-area-inset-top)');
      root.style.setProperty('--sar', 'env(safe-area-inset-right)');
      root.style.setProperty('--sab', 'env(safe-area-inset-bottom)');
      root.style.setProperty('--sal', 'env(safe-area-inset-left)');
    },

    hasNotch() {
      return this.getInsets().top > 20;
    },
  };
}
