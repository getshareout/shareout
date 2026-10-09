import { localeFromAcceptLanguage, type Locale } from './locale';

/** Server-rendered page locale: `?lang=en|es` wins, else the browser's Accept-Language. */
export type PageLocale = Locale;

export function pageLocale(request: Request): PageLocale {
  const q = new URL(request.url).searchParams.get('lang');
  if (q === 'en' || q === 'es') return q;
  return localeFromAcceptLanguage(request.headers.get('Accept-Language')) ?? 'en';
}
