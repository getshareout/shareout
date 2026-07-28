/**
 * Barrel re-export — preserves `../home-i18n` import paths across the home shell.
 * Implementation lives in `./home-i18n/`.
 */
export type { HomeLocale } from './home-i18n/types';
export { HOME_COPY } from './home-i18n/merge-copy';
export { getHomeI18nScript } from './home-i18n/runtime';
export { homeLangSwitchHtml } from './home-i18n/lang-switch';
