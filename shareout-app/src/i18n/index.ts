import type { Locale } from './locale';

export * from './locale';

/** Bilingual copy bundle — same shape as the home shell's copy modules. */
export type LocaleCopy<T> = Record<Locale, T>;

/** Pick the copy for a locale, falling back to English. */
export function t<T>(locale: Locale | null | undefined, dict: LocaleCopy<T>): T {
  return dict[locale ?? 'en'] ?? dict.en;
}
export * from './agent-language';
