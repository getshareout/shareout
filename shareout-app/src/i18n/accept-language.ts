/** Server-rendered page locale: `?lang=en|es` wins, else the browser's first Accept-Language (es* → es). */
export type PageLocale = 'en' | 'es';

export function pageLocale(request: Request): PageLocale {
  const q = new URL(request.url).searchParams.get('lang');
  if (q === 'en' || q === 'es') return q;
  const first = (request.headers.get('Accept-Language') || '').split(',')[0].trim().toLowerCase();
  return first.startsWith('es') ? 'es' : 'en';
}
