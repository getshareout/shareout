/**
 * ShareOut Mobile SDK entry — attaches `ShareOut.mobile` to the global namespace.
 *
 * Built as a standalone IIFE bundle served at `/sdk/shareout-mobile.js` for PWA
 * artifacts. Modules live under `sdk/src/mobile/` and are composed here.
 */

import { createBottomSheet } from './bottom-sheet';
import { isAndroid, isIOS, isMobile, isStandalone } from './device';
import { createGestures } from './gestures';
import { createHaptics } from './haptics';
import { createNavigation } from './navigation';
import { createPullToRefresh } from './pull-to-refresh';
import { createPwa } from './pwa';
import { createSafeArea } from './safe-area';
import type { MobileInitOptions, ShareOutGlobal, ShareOutMobileApi } from './types';
import { createMobileUtils } from './utils';

export const MOBILE_SDK_VERSION = '1.0.0';

/**
 * Build the mobile API object. Exported for unit tests; the IIFE calls
 * {@link attachMobileSdk} at load time.
 */
export function buildMobileApi(): ShareOutMobileApi {
  const haptics = createHaptics();
  const navigation = createNavigation();
  const gestures = createGestures(haptics, navigation);
  const pwa = createPwa();
  const safeArea = createSafeArea();
  const utils = createMobileUtils();

  const api: ShareOutMobileApi = {
    isMobile,
    isIOS,
    isAndroid,
    isStandalone,
    pwa,
    navigation,
    haptics,
    gestures,
    createPullToRefresh: (element, onRefresh, options) =>
      createPullToRefresh(element, onRefresh, haptics, options),
    createBottomSheet: (options) => createBottomSheet(haptics, options),
    safeArea,
    utils,
    version: MOBILE_SDK_VERSION,

    init(options: MobileInitOptions = {}) {
      if (options.viewport !== false) {
        utils.setMobileViewport();
      }
      if (options.safeArea !== false) {
        safeArea.applyCustomProperties();
      }
      if (options.preventOverscroll) {
        utils.preventOverscroll();
      }
      if (options.themeColor) {
        utils.setThemeColor(options.themeColor);
      }
      if (options.registerServiceWorker) {
        pwa.registerServiceWorker().catch(console.error);
      }

      const hash = window.location.hash.slice(1) || 'home';
      navigation.replace(hash);

      return api;
    },
  };

  return api;
}

/**
 * Idempotently attach the mobile SDK to `global.ShareOut.mobile`.
 */
export function attachMobileSdk(global: ShareOutGlobal): ShareOutMobileApi | undefined {
  if (global.ShareOut?.mobile) {
    return global.ShareOut.mobile;
  }

  global.ShareOut = global.ShareOut ?? {};
  const api = buildMobileApi();
  global.ShareOut.mobile = api;
  return api;
}

const root =
  typeof globalThis !== 'undefined'
    ? (globalThis as ShareOutGlobal)
    : typeof window !== 'undefined'
      ? (window as unknown as ShareOutGlobal)
      : ({} as ShareOutGlobal);

const attached = attachMobileSdk(root);

if (
  attached &&
  typeof document !== 'undefined' &&
  document.currentScript instanceof HTMLScriptElement &&
  document.currentScript.dataset.autoInit !== undefined
) {
  document.addEventListener('DOMContentLoaded', () => {
    attached.init();
  });
}

export type {
  BottomSheetHandle,
  BottomSheetOptions,
  GestureHandle,
  GestureOptions,
  HapticsApi,
  MobileInitOptions,
  NavigationApi,
  PullToRefreshHandle,
  PullToRefreshOptions,
  PwaApi,
  SafeAreaApi,
  ShareOutMobileApi,
} from './types';
