/** Auto-extracted client script for the sandbox viewer toolbar. */
export function renderToolbarScriptCore(): string {
  return `
    function escapeHtml(s) {
      return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }
    function timeAgo(date) {
      var seconds = Math.floor((new Date() - date) / 1000);
      if (seconds < 60) return 'just now';
      if (seconds < 3600) return Math.floor(seconds / 60) + 'm ago';
      if (seconds < 86400) return Math.floor(seconds / 3600) + 'h ago';
      return Math.floor(seconds / 86400) + 'd ago';
    }
    window.soToggleToolbar = function() {
      var tb = document.getElementById('shareout-admin-toolbar');
      var trig = document.getElementById('so-toolbar-trigger');
      if (!tb) return;
      var isOpen = tb.classList.contains('so-open');
      var items = tb.querySelectorAll('.so-toolbar-btn');
      if (trig) {
        trig.classList.remove('so-spin');
        void trig.offsetWidth;
        trig.classList.add('so-spin');
      }
      if (!isOpen) {
        var n = items.length;
        for (var i = 0; i < n; i++) {
          items[i].style.transitionDelay = ((n - 1 - i) * 45) + 'ms';
        }
        tb.classList.add('so-open');
        if (trig) trig.setAttribute('aria-expanded', 'true');
      } else {
        for (var j = 0; j < items.length; j++) {
          items[j].style.transitionDelay = '';
        }
        tb.classList.remove('so-open');
        if (trig) trig.setAttribute('aria-expanded', 'false');
      }
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
