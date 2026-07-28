import { HOME_COPY } from './merge-copy';

/**
 * Inline client bootstrap for workspace home i18n.
 *
 * Embeds the full copy table, detects locale (localStorage → navigator),
 * exposes `window.__SO_HOME_T` and friends, and applies `data-i18n*` attributes.
 */
export function getHomeI18nScript(): string {
  const copyJson = JSON.stringify(HOME_COPY).replace(/</g, '\\u003c');
  return `(function(){
  var COPY = ${copyJson};
  var STORAGE_KEY = 'shareout_lang';

  function detectLocale(){
    try {
      var saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'en' || saved === 'es') return saved;
    } catch (e) {}
    var nav = (navigator.language || '').toLowerCase();
    return nav.indexOf('es') === 0 ? 'es' : 'en';
  }

  var locale = detectLocale();

  function t(key){
    var bag = COPY[locale] || COPY.en;
    return bag[key] || COPY.en[key] || key;
  }

  function applyHomeI18n(){
    document.documentElement.lang = locale;
    document.title = t('meta.title');
    document.querySelectorAll('[data-i18n]').forEach(function(el){
      var key = el.getAttribute('data-i18n');
      if (!key) return;
      if (el.getAttribute('data-i18n-html') === 'true') el.innerHTML = t(key);
      else el.textContent = t(key);
    });
    document.querySelectorAll('[data-i18n-placeholder]').forEach(function(el){
      var key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    document.querySelectorAll('[data-i18n-aria]').forEach(function(el){
      var key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key));
    });
    document.querySelectorAll('[data-i18n-title]').forEach(function(el){
      var key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
    document.querySelectorAll('.home-lang-btn').forEach(function(btn){
      var lang = btn.getAttribute('data-lang');
      btn.setAttribute('aria-selected', lang === locale ? 'true' : 'false');
      btn.classList.toggle('is-on', lang === locale);
    });
  }

  function setHomeLocale(next){
    if (next !== 'en' && next !== 'es') return;
    locale = next;
    try { localStorage.setItem(STORAGE_KEY, locale); } catch (e) {}
    applyHomeI18n();
    try { document.dispatchEvent(new CustomEvent('shareout:locale', { detail: { locale: locale } })); } catch (e2) {}
  }

  function wireLangButtons(root){
    (root || document).querySelectorAll('.home-lang-btn').forEach(function(btn){
      if (btn.__soLangWired) return;
      btn.__soLangWired = true;
      btn.addEventListener('click', function(){ setHomeLocale(btn.getAttribute('data-lang')); });
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
})();`;
}
