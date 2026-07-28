/**
 * Lets the viewer drag the floating ShareOut toolbar to any screen corner so it
 * never sits on top of an artifact's own corner widget (chat FABs, etc.).
 * The chosen corner snaps and persists per-artifact in localStorage.
 */
export function renderToolbarScriptDrag(artifactId: string): string {
  return `
    (function() {
      var KEY = 'so-tbpos:' + ${JSON.stringify(artifactId)};
      var CORNERS = { br: 1, bl: 1, tr: 1, tl: 1 };
      var tb = document.getElementById('shareout-admin-toolbar');
      var trig = document.getElementById('so-toolbar-trigger');
      if (!tb || !trig) return;

      function applyCorner(c) {
        tb.classList.remove('so-pos-br','so-pos-bl','so-pos-tr','so-pos-tl');
        tb.classList.add('so-pos-' + c);
      }
      var saved = null;
      try { saved = localStorage.getItem(KEY); } catch (e) {}
      applyCorner(CORNERS[saved] ? saved : 'br');

      trig.style.cursor = 'grab';
      trig.style.touchAction = 'none';
      trig.title = trig.title || 'Drag to move';

      // Movement past this many px counts as a drag, not a click — large enough
      // that ordinary taps/clicks never get hijacked.
      var THRESHOLD = 8;
      var dragging = false, moved = false, startX = 0, startY = 0, offX = 0, offY = 0;
      var suppressClickUntil = 0;

      function onDown(e) {
        if (e.button != null && e.button !== 0) return;
        var r = trig.getBoundingClientRect();
        startX = e.clientX; startY = e.clientY;
        offX = e.clientX - r.left; offY = e.clientY - r.top;
        moved = false; dragging = true;
        try { trig.setPointerCapture(e.pointerId); } catch (er) {}
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onUp);
      }
      function onMove(e) {
        if (!dragging) return;
        if (!moved && Math.abs(e.clientX - startX) < THRESHOLD && Math.abs(e.clientY - startY) < THRESHOLD) return;
        if (!moved) {
          moved = true;
          tb.classList.add('so-dragging');
          tb.classList.remove('so-open');
        }
        e.preventDefault();
        var w = trig.offsetWidth, h = trig.offsetHeight;
        var x = e.clientX - offX, y = e.clientY - offY;
        var maxX = window.innerWidth - w, maxY = window.innerHeight - h;
        tb.style.left = Math.max(0, Math.min(x, maxX)) + 'px';
        tb.style.top = Math.max(0, Math.min(y, maxY)) + 'px';
        tb.style.right = 'auto'; tb.style.bottom = 'auto';
      }
      function onUp(e) {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onUp);
        try { trig.releasePointerCapture(e.pointerId); } catch (er) {}
        dragging = false;
        if (!moved) return;
        suppressClickUntil = Date.now() + 350;
        var r = trig.getBoundingClientRect();
        var cx = r.left + r.width / 2, cy = r.top + r.height / 2;
        var corner = (cy < window.innerHeight / 2 ? 't' : 'b') + (cx < window.innerWidth / 2 ? 'l' : 'r');
        tb.classList.remove('so-dragging');
        tb.style.left = tb.style.top = tb.style.right = tb.style.bottom = '';
        applyCorner(corner);
        try { localStorage.setItem(KEY, corner); } catch (er) {}
      }
      trig.addEventListener('pointerdown', onDown);
      // Suppress the toggle click that fires at the end of a drag gesture.
      // Time-guarded so a dropped click event can't leave a stale flag.
      trig.addEventListener('click', function(e) {
        if (moved || Date.now() < suppressClickUntil) {
          e.preventDefault(); e.stopImmediatePropagation();
          moved = false;
        }
      }, true);
    })();`;
}
