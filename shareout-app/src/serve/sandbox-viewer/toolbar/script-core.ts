import type { Locale } from '../../../i18n';
import { TOOLBAR_COPY, js, type ToolbarCopy } from './copy';

/** Auto-extracted client script for the sandbox viewer toolbar. */
export function renderToolbarScriptCore(c: ToolbarCopy = TOOLBAR_COPY.en, locale: Locale = 'en'): string {
  const ago = locale === 'es'
    ? `      if (seconds < 3600) return 'hace ' + Math.floor(seconds / 60) + ' min';
      if (seconds < 86400) return 'hace ' + Math.floor(seconds / 3600) + ' h';
      return 'hace ' + Math.floor(seconds / 86400) + ' d';`
    : `      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      return Math.floor(seconds / 86400) + 'd ago';`;
  return `
    // Shared optimistic-action helper (design-system/components/optimistic.ts) with this
    // viewer's Undo / Retry labels. componentScripts always load before the toolbar script.
    if (window.soOptimistic) window.soOptimistic.labels = { undo: '${js(c.undo)}', retry: '${js(c.retry)}', failed: '${js(c.actionFailed)}' };
    function soOpt(o) { return window.soOptimistic(o); }
    function escapeHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function timeAgo(date) {
      var seconds = Math.floor((new Date() - date) / 1000);
      if (seconds < 60) return '${js(c.justNow)}';
${ago}
    }
    // Title menu: opens under the title, closes on a pick, a click outside or Esc.
    window.soHdMenu = function(open, ev) {
      var menu = document.getElementById('so-hd-menu');
      var btn = document.getElementById('so-hd-menu-btn');
      if (!menu || !btn) return;
      var show = typeof open === 'boolean' ? open : menu.hidden;
      menu.hidden = !show;
      btn.setAttribute('aria-expanded', show ? 'true' : 'false');
      // Opened from the keyboard (a click with no pointer): move focus into the menu.
      if (show && ev && ev.detail === 0) { var first = menu.querySelector('[role="menuitem"]'); if (first) first.focus(); }
    };
    document.addEventListener('click', function(e) {
      var menu = document.getElementById('so-hd-menu');
      if (!menu || menu.hidden) return;
      var wrap = menu.parentNode;
      if (wrap && !wrap.contains(e.target)) soHdMenu(false);
    });
    document.addEventListener('keydown', function(e) {
      var menu = document.getElementById('so-hd-menu');
      if (e.key !== 'Escape' || !menu || menu.hidden) return;
      soHdMenu(false);
      var btn = document.getElementById('so-hd-menu-btn');
      if (btn) btn.focus();
    });
    // The Comments button opens the side panel, and closes it when it is already open.
    window.soHdComments = function() {
      var ov = document.getElementById('so-comments-overlay');
      if (ov && ov.classList.contains('open')) { if (window.closeComments) closeComments(); }
      else if (window.openComments) openComments();
      var btn = document.getElementById('so-cmt-btn');
      if (btn && ov) btn.setAttribute('aria-expanded', ov.classList.contains('open') ? 'true' : 'false');
    };
    window.soToggleSkills = function() {
      var ov = document.getElementById('so-skills-overlay');
      if (!ov) return;
      var open = ov.classList.toggle('so-open');
      var btn = document.getElementById('so-skills-btn');
      if (btn) btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    };
    window.soCloseSkills = function() {
      var ov = document.getElementById('so-skills-overlay');
      if (ov) ov.classList.remove('so-open');
      var btn = document.getElementById('so-skills-btn');
      if (btn) btn.setAttribute('aria-expanded', 'false');
    };`;
}
