/**
 * ShareOut Comments Agent — injected into the artifact iframe (null-origin) by the
 * worker's HTMLRewriter when the out-of-box comments overlay is enabled.
 *
 * Responsibilities (pinning only — state capture/restore is handled by the SDK):
 *  - enter "pin mode" and turn the next click into an element-anchored position
 *  - keep parent-rendered pin markers aligned as the artifact scrolls/resizes
 *  - scroll a pin into view on request
 *
 * It talks to the parent overlay via postMessage. The artifact DOM is never shared.
 */
(function () {
  if (window.__shareoutCommentsAgent) return;
  window.__shareoutCommentsAgent = true;

  var pinMode = false;
  var pins = []; // [{ id, position }]
  var rafScheduled = false;

  function send(msg) {
    try { window.parent.postMessage(msg, '*'); } catch (e) {}
  }

  // Build a CSS selector path to the nearest stable element.
  function selectorFor(el) {
    if (!el || el === document.body || el === document.documentElement) return 'body';
    var parts = [];
    var node = el;
    var depth = 0;
    while (node && node.nodeType === 1 && node !== document.body && depth < 8) {
      if (node.id) {
        parts.unshift('#' + cssEscape(node.id));
        return parts.join(' > ');
      }
      var tag = node.tagName.toLowerCase();
      var parent = node.parentElement;
      if (parent) {
        var sameTag = [];
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].tagName === node.tagName) sameTag.push(parent.children[i]);
        }
        if (sameTag.length > 1) {
          tag += ':nth-of-type(' + (sameTag.indexOf(node) + 1) + ')';
        }
      }
      parts.unshift(tag);
      node = parent;
      depth++;
    }
    return parts.join(' > ');
  }

  function cssEscape(s) {
    if (window.CSS && window.CSS.escape) return window.CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, '\\$&');
  }

  function docWidth() {
    return Math.max(document.documentElement.scrollWidth, document.body ? document.body.scrollWidth : 0, 1);
  }
  function docHeight() {
    return Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0, 1);
  }

  function computePosition(el, clientX, clientY) {
    var rect = el.getBoundingClientRect();
    var relX = rect.width ? (clientX - rect.left) / rect.width : 0.5;
    var relY = rect.height ? (clientY - rect.top) / rect.height : 0.5;
    var pageX = clientX + window.scrollX;
    var pageY = clientY + window.scrollY;
    return {
      selector: selectorFor(el),
      relX: clamp01(relX),
      relY: clamp01(relY),
      pctX: clamp01(pageX / docWidth()),
      pctY: clamp01(pageY / docHeight()),
      scrollY: Math.round(window.scrollY)
    };
  }

  function clamp01(n) { return Math.max(0, Math.min(1, n)); }

  // Resolve a stored position to current viewport pixel coords.
  function resolvePosition(pos) {
    if (!pos) return null;
    var x, y;
    var el = null;
    if (pos.selector) {
      try { el = document.querySelector(pos.selector); } catch (e) { el = null; }
    }
    if (el) {
      var rect = el.getBoundingClientRect();
      x = rect.left + (pos.relX != null ? pos.relX : 0.5) * rect.width;
      y = rect.top + (pos.relY != null ? pos.relY : 0.5) * rect.height;
    } else {
      x = (pos.pctX != null ? pos.pctX : 0.5) * docWidth() - window.scrollX;
      y = (pos.pctY != null ? pos.pctY : 0.5) * docHeight() - window.scrollY;
    }
    var visible = y >= -40 && y <= window.innerHeight + 40 && x >= -40 && x <= window.innerWidth + 40;
    return { x: Math.round(x), y: Math.round(y), visible: visible };
  }

  function emitPositions() {
    rafScheduled = false;
    var out = [];
    for (var i = 0; i < pins.length; i++) {
      var r = resolvePosition(pins[i].position);
      if (r) out.push({ id: pins[i].id, x: r.x, y: r.y, visible: r.visible });
    }
    send({ type: 'shareout:comments:pinPositions', pins: out });
  }

  function scheduleEmit() {
    if (rafScheduled) return;
    rafScheduled = true;
    (window.requestAnimationFrame || function (cb) { setTimeout(cb, 16); })(emitPositions);
  }

  function onClickCapture(e) {
    if (!pinMode) return;
    e.preventDefault();
    e.stopPropagation();
    pinMode = false;
    document.documentElement.style.cursor = '';
    var pos = computePosition(e.target, e.clientX, e.clientY);
    send({ type: 'shareout:comments:pinPlaced', position: pos });
  }

  window.addEventListener('message', function (e) {
    if (e.source !== window.parent) return;
    var data = e.data;
    if (!data || typeof data !== 'object' || typeof data.type !== 'string') return;
    if (data.type.indexOf('shareout:comments:') !== 0) return;

    if (data.type === 'shareout:comments:enterPinMode') {
      pinMode = true;
      document.documentElement.style.cursor = 'crosshair';
    } else if (data.type === 'shareout:comments:exitPinMode') {
      pinMode = false;
      document.documentElement.style.cursor = '';
    } else if (data.type === 'shareout:comments:setPins') {
      pins = Array.isArray(data.pins) ? data.pins : [];
      scheduleEmit();
    } else if (data.type === 'shareout:comments:scrollToPin') {
      var r = resolvePosition(data.position);
      if (r && !r.visible) {
        var targetY = (data.position && data.position.scrollY != null)
          ? data.position.scrollY
          : window.scrollY + r.y - window.innerHeight / 2;
        window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' });
        setTimeout(scheduleEmit, 350);
      }
    }
  });

  document.addEventListener('click', onClickCapture, true);
  window.addEventListener('scroll', scheduleEmit, { passive: true });
  window.addEventListener('resize', scheduleEmit, { passive: true });

  send({ type: 'shareout:comments:agentReady' });
})();
