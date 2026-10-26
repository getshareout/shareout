/**
 * Browser source shared by every live "watch it build" preview (/create and Studio's
 * Create with AI): paints a streamed page into an iframe at most once per `ms`.
 *
 * `srcdocThrottle(apply, ms)` returns { push(text), flush(), cancel() }. push() takes the
 * whole text streamed so far. The first push paints at once (first paint lands with the
 * first streamed chunk); later pushes inside the window coalesce into one trailing paint,
 * so the last chunk always shows. flush() paints anything pending now; cancel() drops it.
 *
 * Models often wrap the page in a markdown fence (```html … ```). `stripFence` removes a
 * leading fence line and a trailing fence before every paint, including a fence that is
 * still arriving ("`", "``", "```ht"), so the preview never flashes backticks.
 */
export const SRCDOC_THROTTLE_JS = `
  var FENCE = String.fromCharCode(96, 96, 96);
  function isFenceStart(s) { return !!s && FENCE.indexOf(s.slice(0, 3)) === 0; }
  function stripFence(s) {
    s = String(s == null ? '' : s);
    var i = 0;
    while (i < s.length && s.charCodeAt(i) <= 32) i++;
    if (isFenceStart(s.slice(i, i + 3))) {
      var nl = s.indexOf('\\n', i);
      if (nl < 0) return '';
      s = s.slice(nl + 1);
    }
    var end = s.length;
    while (end > 0 && s.charCodeAt(end - 1) <= 32) end--;
    var lastNl = s.lastIndexOf('\\n', end - 1);
    var tail = s.slice(lastNl + 1, end).trim();
    if (tail.length <= 3 && isFenceStart(tail)) s = lastNl < 0 ? '' : s.slice(0, lastNl);
    return s;
  }
  function srcdocThrottle(apply, ms) {
    var last = 0, timer = 0, pending = null;
    function run() { timer = 0; last = Date.now(); var v = pending; pending = null; apply(stripFence(v)); }
    return {
      push: function (v) {
        pending = v;
        if (timer) return;
        var wait = ms - (Date.now() - last);
        if (wait <= 0) run(); else timer = setTimeout(run, wait);
      },
      flush: function () { if (timer) { clearTimeout(timer); timer = 0; } if (pending !== null) run(); },
      cancel: function () { if (timer) clearTimeout(timer); timer = 0; pending = null; }
    };
  }
`;
