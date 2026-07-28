/**
 * Device and display-mode detection for mobile artifacts.
 */

const MOBILE_UA_REGEX =
  /iPhone|iPad|iPod|Android|webOS|BlackBerry|IEMobile|Opera Mini|Mobile|mobile|CriOS/i;

/** True when the user agent looks like a phone or tablet browser. */
export function isMobile(): boolean {
  return MOBILE_UA_REGEX.test(navigator.userAgent);
}

/** True on iPhone, iPad, or iPod. */
export function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

/** True on Android. */
export function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/** True when running as an installed PWA (standalone display mode). */
export function isStandalone(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari legacy flag
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
