/** Brief widget grid: drag-reorder + resize, persisted per workspace. */
export const workspace_client_widget_layout_JS = `
  // ===== Brief layout: drag-reorder + resize widgets, persisted per workspace =====
  (function () {
    var brief = document.querySelector('.wsx__brief');
    if (!brief) return;
    var LKEY = 'wsx_layout:' + (window.WSX_WS || '');
    var saved = {};
    try { saved = JSON.parse(localStorage.getItem(LKEY) || '{}') || {}; } catch (e) {}
    saved.order = saved.order || [];
    saved.sizes = saved.sizes || {};
    function widgets() { return Array.prototype.slice.call(brief.querySelectorAll('.wsx-widget[data-wid]')); }
    function save() { try { localStorage.setItem(LKEY, JSON.stringify(saved)); } catch (e) {} }
    function persistOrder() { saved.order = widgets().map(function (w) { return w.getAttribute('data-wid'); }); save(); }
    // apply saved order (unknown/new widgets keep their place at the end)
    if (saved.order.length) {
      var present = widgets().map(function (w) { return w.getAttribute('data-wid'); });
      var order = saved.order.filter(function (w) { return present.indexOf(w) >= 0; });
      present.forEach(function (w) { if (order.indexOf(w) < 0) order.push(w); });
      order.forEach(function (wid) { var w = brief.querySelector('.wsx-widget[data-wid="' + wid + '"]'); if (w) brief.appendChild(w); });
    }
    // apply saved sizes
    widgets().forEach(function (w) {
      var s = saved.sizes[w.getAttribute('data-wid')]; if (!s) return;
      if (s.span) w.setAttribute('data-span', String(s.span));
      if (s.h) { var b = w.querySelector('.wsx-widget__body'); if (b) b.style.maxHeight = s.h + 'px'; }
    });
    // ----- drag reorder (pointer-based; works with mouse + touch, unlike native DnD) -----
    var dragEl = null;
    function pt(e) { return (e.touches && e.touches[0]) ? e.touches[0] : e; }
    function nearest(x, y) {
      var els = widgets().filter(function (w) { return w !== dragEl && !w.classList.contains('is-empty-hidden'); });
      var best = null, bd = Infinity, before = false;
      els.forEach(function (w) {
        var b = w.getBoundingClientRect(); var cx = b.left + b.width / 2, cy = b.top + b.height / 2;
        var d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d < bd) { bd = d; best = w; before = (y < cy - 4) || (Math.abs(y - cy) <= b.height / 2 && x < cx); }
      });
      return { el: best, before: before };
    }
    function onMove(e) {
      if (!dragEl) return;
      var q = pt(e); var r = nearest(q.clientX, q.clientY);
      if (r.el && r.el !== dragEl) { if (r.before) brief.insertBefore(dragEl, r.el); else brief.insertBefore(dragEl, r.el.nextSibling); }
      if (e.cancelable) e.preventDefault();
    }
    function onUp() {
      if (!dragEl) return;
      dragEl.classList.remove('is-dragging'); dragEl = null;
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp);
      persistOrder();
    }
    function startDrag(w) {
      dragEl = w; w.classList.add('is-dragging'); document.body.style.userSelect = 'none';
      document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false }); document.addEventListener('touchend', onUp);
    }
    widgets().forEach(function (w) {
      var grip = w.querySelector('.wsx-widget__grip');
      if (grip) {
        grip.addEventListener('mousedown', function (e) { e.preventDefault(); startDrag(w); });
        grip.addEventListener('touchstart', function () { startDrag(w); }, { passive: true });
      }
      var rz = w.querySelector('.wsx-widget__rz');
      if (rz) rz.addEventListener('mousedown', function (e) { startResize(e, w); });
    });
    // ----- resize (corner handle): horizontal toggles 1<->2 span, vertical sets body height -----
    function startResize(e, w) {
      e.preventDefault(); e.stopPropagation();
      var sx = e.clientX, sy = e.clientY;
      var body = w.querySelector('.wsx-widget__body');
      var startH = body ? body.getBoundingClientRect().height : 0;
      var startSpan = parseInt(w.getAttribute('data-span') || (w.classList.contains('wsx-widget--wide') ? '2' : '1'), 10);
      document.body.style.userSelect = 'none'; document.body.style.cursor = 'nwse-resize';
      function mv(ev) {
        if (body) body.style.maxHeight = Math.max(120, startH + (ev.clientY - sy)) + 'px';
        var dx = ev.clientX - sx; var span = startSpan;
        if (dx > 110) span = 2; else if (dx < -110) span = 1;
        w.setAttribute('data-span', String(span));
      }
      function up() {
        document.removeEventListener('mousemove', mv); document.removeEventListener('mouseup', up);
        document.body.style.userSelect = ''; document.body.style.cursor = '';
        var wid = w.getAttribute('data-wid'); var s = saved.sizes[wid] = saved.sizes[wid] || {};
        s.span = parseInt(w.getAttribute('data-span'), 10);
        if (body && body.style.maxHeight) s.h = parseInt(body.style.maxHeight, 10);
        save();
      }
      document.addEventListener('mousemove', mv); document.addEventListener('mouseup', up);
    }
  })();

`;
