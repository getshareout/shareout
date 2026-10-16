// @vitest-environment happy-dom
//
// The cached i18n runtime carries no copy: the page loads one locale's file before it,
// any other locale is fetched on demand, and a locale that fails to load falls back to en.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getStaticHomeI18nScript, homeLocaleCopyScript } from '../../../src/pages/home/home-i18n/runtime';
import { HOME_COPY } from '../../../src/pages/home/home-i18n/merge-copy';

type W = Window & Record<string, any>;
const w = window as unknown as W;
let requested: string[];
let fail: Set<string>;
let realAppend: typeof document.head.appendChild;

function boot(preloaded: 'en' | 'es' | null, serverLocale: string | null = null) {
  if (preloaded) new Function(homeLocaleCopyScript(preloaded))();
  w.WSX_LOCALE = serverLocale;
  w.WSX_I18N = { en: '/sdk/home-i18n-en.js?v=1', es: '/sdk/home-i18n-es.js?v=1' };
  new Function(getStaticHomeI18nScript())();
}

beforeEach(() => {
  document.body.innerHTML = '<h1 data-i18n="meta.title"></h1>';
  delete w.__SO_HOME_COPY;
  requested = [];
  fail = new Set();
  realAppend = document.head.appendChild;
  // Serve copy-file script tags synchronously from the real copy bodies.
  document.head.appendChild = function <T extends Node>(node: T): T {
    const s = node as unknown as HTMLScriptElement;
    if (s.tagName !== 'SCRIPT') return realAppend.call(this, node) as T;
    const src = s.getAttribute('src') || '';
    requested.push(src);
    const locale = src.match(/home-i18n-([a-z]+)\.js/)?.[1] as 'en' | 'es';
    if (fail.has(locale)) s.onerror?.(new Event('error'));
    else { new Function(homeLocaleCopyScript(locale))(); s.onload?.(new Event('load')); }
    return node;
  };
});
afterEach(() => { document.head.appendChild = realAppend; });

const title = () => document.querySelector('h1')!.textContent;

describe('home i18n loader', () => {
  it('uses the preloaded copy without fetching anything', () => {
    boot('es', 'es');
    expect(title()).toBe(HOME_COPY.es['meta.title']);
    expect(requested).toEqual([]);
  });

  it('switching language fetches the other locale and re-applies in place', () => {
    boot('en', 'en');
    let events = 0;
    document.addEventListener('shareout:locale', () => { events++; });
    w.__SO_SET_HOME_LOCALE('es');
    expect(requested).toEqual(['/sdk/home-i18n-es.js?v=1']);
    expect(w.__SO_HOME_LOCALE()).toBe('es');
    expect(title()).toBe(HOME_COPY.es['meta.title']);
    expect(events).toBe(1);
  });

  it('a client-side pick that differs from the loaded file fetches the right one', () => {
    try { localStorage.setItem('shareout_lang', 'es'); } catch { /* ignore */ }
    boot('en', null);
    expect(requested).toEqual(['/sdk/home-i18n-es.js?v=1']);
    expect(title()).toBe(HOME_COPY.es['meta.title']);
    localStorage.removeItem('shareout_lang');
  });

  it('falls back to the en copy when the locale file fails to load', () => {
    fail.add('es');
    boot(null, 'es');
    expect(requested).toEqual(['/sdk/home-i18n-es.js?v=1', '/sdk/home-i18n-en.js?v=1']);
    expect(w.__SO_HOME_LOCALE()).toBe('es');
    expect(w.__SO_HOME_T('meta.title')).toBe(HOME_COPY.en['meta.title']);
    expect(title()).toBe(HOME_COPY.en['meta.title']);
  });
});
