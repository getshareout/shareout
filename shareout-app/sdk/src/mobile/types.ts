/**
 * Shared types for the ShareOut Mobile SDK — browser-native helpers for PWA
 * artifacts (gestures, haptics, navigation, safe-area, pull-to-refresh, etc.).
 */

/** Vibration pattern accepted by the Vibration API. */
export type VibratePattern = number | number[];

/** Minimal global shape the mobile bundle attaches to. */
export interface ShareOutGlobal {
  ShareOut?: {
    mobile?: ShareOutMobileApi;
    [key: string]: unknown;
  };
}

/** Options passed to {@link ShareOutMobileApi.init}. */
export interface MobileInitOptions {
  viewport?: boolean;
  safeArea?: boolean;
  preventOverscroll?: boolean;
  themeColor?: string;
  registerServiceWorker?: boolean;
}

/** PWA install prompt outcome. */
export interface InstallPromptResult {
  outcome: 'accepted' | 'dismissed';
  error?: string;
}

/** Install state change payload. */
export interface InstallState {
  canInstall?: boolean;
  installed?: boolean;
}

/** Navigation event payload. */
export interface NavigationEvent {
  type: 'push' | 'pop' | 'replace';
  route: string;
  state?: NavigationState;
}

/** Serialized navigation state stored in `history.state`. */
export interface NavigationState {
  _shareout_nav: true;
  route: string;
  data: Record<string, unknown>;
  timestamp: number;
}

/** Safe-area inset values in CSS pixels. */
export interface SafeAreaInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** Gesture handler configuration. */
export interface GestureOptions {
  swipeThreshold?: number;
  swipeVelocity?: number;
  longPressDelay?: number;
  doubleTapDelay?: number;
}

/** Pull-to-refresh configuration. */
export interface PullToRefreshOptions {
  threshold?: number;
  maxPull?: number;
  resistance?: number;
  indicatorHTML?: string;
}

/** Bottom sheet configuration. */
export interface BottomSheetOptions {
  snapPoints?: number[];
  initialSnap?: number;
  dismissible?: boolean;
  backdrop?: boolean;
  content?: string | HTMLElement;
}

/** Public mobile SDK surface exposed as `ShareOut.mobile`. */
export interface ShareOutMobileApi {
  isMobile: () => boolean;
  isIOS: () => boolean;
  isAndroid: () => boolean;
  isStandalone: () => boolean;
  pwa: PwaApi;
  navigation: NavigationApi;
  haptics: HapticsApi;
  gestures: GesturesApi;
  createPullToRefresh: (
    element: HTMLElement | string,
    onRefresh: () => void | Promise<void>,
    options?: PullToRefreshOptions,
  ) => PullToRefreshHandle;
  createBottomSheet: (options?: BottomSheetOptions) => BottomSheetHandle;
  safeArea: SafeAreaApi;
  utils: MobileUtilsApi;
  version: string;
  init: (options?: MobileInitOptions) => ShareOutMobileApi;
}

export interface PwaApi {
  canInstall: () => boolean;
  isInstalled: () => boolean;
  promptInstall: () => Promise<InstallPromptResult>;
  onInstallStateChange: (callback: (state: InstallState) => void) => () => void;
  registerServiceWorker: (swPath?: string) => Promise<ServiceWorkerRegistration>;
  updateServiceWorker: () => Promise<void>;
}

export interface NavigationApi {
  push: (route: string, options?: { data?: Record<string, unknown>; replaceUrl?: boolean; url?: string }) => void;
  pop: () => NavigationState | null;
  replace: (route: string, options?: { data?: Record<string, unknown>; url?: string }) => void;
  currentRoute: () => string | null;
  stackDepth: () => number;
  canGoBack: () => boolean;
  onNavigate: (callback: (event: NavigationEvent) => void) => () => void;
  reset: (initialRoute?: string) => void;
}

export interface HapticsApi {
  light: () => void;
  medium: () => void;
  heavy: () => void;
  success: () => void;
  warning: () => void;
  error: () => void;
  selection: () => void;
  custom: (pattern: VibratePattern) => void;
  isSupported: () => boolean;
}

export interface GesturesApi {
  create: (element: HTMLElement | string, options?: GestureOptions) => GestureHandle;
  enableSwipeBack: (element: HTMLElement | string, options?: GestureOptions) => GestureHandle;
}

export type GestureEvent =
  | 'swipeLeft'
  | 'swipeRight'
  | 'swipeUp'
  | 'swipeDown'
  | 'longPress'
  | 'doubleTap'
  | 'pan'
  | 'pinch';

export interface GestureHandle {
  on: (event: GestureEvent, callback: (detail: Record<string, number>) => void) => GestureHandle;
  off: (event: GestureEvent, callback: (detail: Record<string, number>) => void) => GestureHandle;
  destroy: () => void;
}

export interface PullToRefreshHandle {
  destroy: () => void;
  refresh: () => void;
}

export interface BottomSheetHandle {
  open: () => void;
  close: () => void;
  snapTo: (index: number) => void;
  setContent: (content: string | HTMLElement) => void;
  isOpen: () => boolean;
  destroy: () => void;
}

export interface SafeAreaApi {
  getInsets: () => SafeAreaInsets;
  applyCustomProperties: () => void;
  hasNotch: () => boolean;
}

export interface MobileUtilsApi {
  preventOverscroll: () => void;
  setMobileViewport: () => void;
  setThemeColor: (color: string) => void;
  disableSelection: (element: HTMLElement) => void;
  enableMomentumScroll: (element: HTMLElement) => void;
}
