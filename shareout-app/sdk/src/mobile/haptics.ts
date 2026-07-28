/**
 * Haptic feedback via the Vibration API (where supported).
 */

import type { HapticsApi, VibratePattern } from './types';

function vibrate(pattern: VibratePattern): void {
  if ('vibrate' in navigator) {
    navigator.vibrate(pattern);
  }
}

/** Factory for the haptics namespace on `ShareOut.mobile`. */
export function createHaptics(): HapticsApi {
  return {
    light() {
      vibrate(10);
    },
    medium() {
      vibrate(20);
    },
    heavy() {
      vibrate(40);
    },
    success() {
      vibrate([10, 50, 20]);
    },
    warning() {
      vibrate([20, 100, 20, 100, 20]);
    },
    error() {
      vibrate([50, 100, 50]);
    },
    selection() {
      vibrate(5);
    },
    custom(pattern) {
      vibrate(pattern);
    },
    isSupported() {
      return 'vibrate' in navigator;
    },
  };
}
