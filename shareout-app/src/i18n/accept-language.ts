import { localeFromAcceptLanguage, type Locale } from './locale';

/** Server-rendered page locale: `?lang=en|es` wins, then the workspace's language, else the browser's Accept-Language. */
export type PageLocale = Locale;

export function pageLocale(request: Request, workspaceLocale?: Locale | null): PageLocale {
  const q = new URL(request.url).searchParams.get('lang');
  if (q === 'en' || q === 'es') return q;
  if (workspaceLocale) return workspaceLocale;
  return localeFromAcceptLanguage(request.headers.get('Accept-Language')) ?? 'en';
}
