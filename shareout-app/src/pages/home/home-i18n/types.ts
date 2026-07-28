/** Supported locales for the workspace home shell. */
export type HomeLocale = 'en' | 'es';

/** Flat key → string map for one locale (e.g. `nav.brief`). */
export type HomeCopySection = Record<string, string>;

/** Bilingual copy bundle for a single domain module. */
export type HomeLocaleCopy = Record<HomeLocale, HomeCopySection>;

/** Full merged copy table served to the client i18n runtime. */
export type HomeCopyTable = Record<HomeLocale, HomeCopySection>;
