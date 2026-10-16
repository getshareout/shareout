import { HOME_COPY } from './merge-copy';
import type { HomeLocale } from './types';

/** Global the per-locale copy files fill in: `window.__SO_HOME_COPY[locale] = {…}`. */
export const HOME_COPY_GLOBAL = '__SO_HOME_COPY';

/** Body of the cached per-locale copy file (/sdk/home-i18n-<locale>.js). */
export function homeLocaleCopyScript(locale: HomeLocale): string {
  const copyJson = JSON.stringify(HOME_COPY[locale]).replace(/</g, '\\u003c');
  return `(window.${HOME_COPY_GLOBAL}=window.${HOME_COPY_GLOBAL}||{})[${JSON.stringify(locale)}]=${copyJson};\n`;
}

/**
 * Inline client bootstrap for workspace home i18n.
 *
 * Embeds the full copy table, picks the locale (server-resolved person/workspace
 * language → localStorage → navigator),
 * exposes `window.__SO_HOME_T` and friends, and applies `data-i18n*` attributes.
 */
export function getHomeI18nScript(serverLocale: HomeLocale | null = null): string {
  return homeI18nSource(JSON.stringify(serverLocale), JSON.stringify(HOME_COPY).replace(/</g, '\\u003c'));
}

/**
 * The same bootstrap with the locale read from `window.WSX_LOCALE` at run time and no
 * copy of its own, so the bytes are identical for every viewer and can be served as a
 * cached file. The page loads one locale's copy file before it; any other locale (a
 * language switch, or a client-side pick that differs from the server's guess) is
 * fetched from `window.WSX_I18N[locale]` on demand. A locale that fails to load falls
 * back to the en copy.
 */
export function getStaticHomeI18nScript(): string {
  return homeI18nSource('window.WSX_LOCALE || null', `window.${HOME_COPY_GLOBAL} || (window.${HOME_COPY_GLOBAL} = {})`);
}

function homeI18nSource(serverLocaleExpr: string, copyExpr: string): string {
  return `(function(){
  var COPY = ${copyExpr};
  var STORAGE_KEY = 'shareout_lang';
  var SERVER_LOCALE = ${serverLocaleExpr};

  function detectLocale(){
    if (SERVER_LOCALE) return SERVER_LOCALE;
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'es') return saved;
    } catch (e) {}
    var nav = (navigator.language || '').toLowerCase();
    return nav.indexOf('es') === 0 ? 'es' : 'en';
  }

  var locale = detectLocale();

  function t(key){
    var bag = COPY[locale] || {};
    return bag[key] || (COPY.en && COPY.en[key]) || key;
  }

  var copyWaits = {};
  function loadCopy(next, done){
    if (COPY[next]) return done();
    if (copyWaits[next]) return copyWaits[next].push(done);
    copyWaits[next] = [done];
    var finish = function(){ var cbs = copyWaits[next] || []; delete copyWaits[next]; cbs.forEach(function(cb){ cb(); }); };
    var s = document.createElement('script');
    s.src = (window.WSX_I18N && window.WSX_I18N[next]) || ('/sdk/home-i18n-' + next + '.js');
    s.onload = finish;
    s.onerror = function(){ if (next === 'en') return finish(); loadCopy('en', finish); };
    document.head.appendChild(s);
  }

  function announceLocale(){
    applyHomeI18n();
    try { document.dispatchEvent(new CustomEvent('shareout:locale', { detail: { locale: locale } })); } catch (e2) {}
  }

  function applyHomeI18n(root){
    var r = root || document;
    if (!root) {
      document.documentElement.lang = locale;
      document.title = t('meta.title');
    }
    r.querySelectorAll('[data-i18n]').forEach(function(el){
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      if (el.getAttribute('data-i18n-html') === 'true') el.innerHTML = t(key);
      else el.textContent = t(key);
    });
    r.querySelectorAll('[data-i18n-placeholder]').forEach(function(el){
      var key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    r.querySelectorAll('[data-i18n-aria]').forEach(function(el){
      var key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key));
    });
    r.querySelectorAll('[data-i18n-title]').forEach(function(el){
      var key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
    r.querySelectorAll('[data-i18n-tip]').forEach(function(el){
      var key = el.getAttribute('data-i18n-tip');
      if (key) el.setAttribute('data-tip', t(key));
    });
    document.querySelectorAll('.home-lang-btn').forEach(function(btn){
      var lang = btn.getAttribute('data-lang');
      btn.setAttribute('aria-selected', lang === locale ? 'true' : 'false');
      btn.classList.toggle('is-on', lang === locale);
    });
  }

  function setHomeLocale(next, scope){
    if (next !== 'en' && next !== 'es') return;
    var url = scope === 'workspace' && window.WSX_WS ? '/v1/workspaces/' + encodeURIComponent(window.WSX_WS) + '/locale' : scope === 'me' ? '/v1/me/locale' : '';
    if (url) fetch(url, { method: 'PUT', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ locale: next }) }).catch(function(){});
    try { localStorage.setItem(STORAGE_KEY, next); } catch (e) {}
    loadCopy(next, function(){ locale = next; announceLocale(); });
  }

  function wireLangButtons(root){
    (root || document).querySelectorAll('.home-lang-btn').forEach(function(btn){
      if (btn.__soLangWired) return;
      btn.__soLangWired = true;
      btn.addEventListener('click', function(){ setHomeLocale(btn.getAttribute('data-lang'), btn.getAttribute('data-scope') || 'me'); });
    });
  }

  window.__SO_HOME_T = t;
  window.__SO_HOME_LOCALE = function(){ return locale; };
  window.__SO_SET_HOME_LOCALE = setHomeLocale;
  window.__SO_WIRE_HOME_LANG = wireLangButtons;
  window.__SO_APPLY_HOME_I18N = applyHomeI18n;

  document.addEventListener('click', function(e){
    var b = e.target && e.target.closest ? e.target.closest('.home-lang-btn') : null;
    if (b) setHomeLocale(b.getAttribute('data-lang'));
  });

  applyHomeI18n();
  wireLangButtons(document);
  if (!COPY[locale]) loadCopy(locale, announceLocale);
})();`;
}
