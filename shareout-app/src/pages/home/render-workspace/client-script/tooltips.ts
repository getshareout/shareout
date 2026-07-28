/** Lightweight tooltip for [data-tip] elements — appended to body so it never clips in scrolling panels. */
export const workspace_client_tooltips_JS = `  // ===== tooltip for [data-tip] (body-appended, no clipping) =====
  (function () {
    var tip = null, tEl = null;
    function show(el) {
      var txt = el.getAttribute('data-tip'); if (!txt) return;
      if (!tip) { tip = document.createElement('div'); tip.className = 'wsx-tip'; document.body.appendChild(tip); }
      tip.textContent = txt; tip.style.display = 'block'; tEl = el;
      var r = el.getBoundingClientRect();
      var tw = tip.offsetWidth, th = tip.offsetHeight;
      var left = Math.min(window.innerWidth - tw - 8, Math.max(8, r.left + r.width / 2 - tw / 2));
      var top = r.top - th - 8; if (top < 8) top = r.bottom + 8;
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
      tip.classList.add('is-show');
    }
    function hide() { if (tip) { tip.classList.remove('is-show'); tip.style.display = 'none'; } tEl = null; }
    document.addEventListener('mouseover', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el && el !== tEl) show(el); });
    document.addEventListener('mouseout', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) hide(); });
    document.addEventListener('focusin', function (e) { var el = e.target.closest && e.target.closest('[data-tip]'); if (el) show(el); });
    document.addEventListener('focusout', hide);
    window.addEventListener('scroll', hide, true);
  })();

`;
