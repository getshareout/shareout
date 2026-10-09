/**
 * The page's language for SDK-rendered UI and number/date formatting:
 * <html lang> first (the viewer and home shell set it from the workspace), then
 * the browser's language, then English.
 */
export function pageLocaleTag(): string {
  const doc = typeof document !== 'undefined' ? document.documentElement?.lang : '';
  const nav = typeof navigator !== 'undefined' ? navigator.language : '';
  return doc || nav || 'en-US';
}

/** 'es' when the page speaks Spanish, else 'en'. */
export function pageLocale(): 'en' | 'es' {
  return pageLocaleTag().toLowerCase().startsWith('es') ? 'es' : 'en';
}
