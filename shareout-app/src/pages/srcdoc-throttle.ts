/**
 * Browser source shared by every live "watch it build" preview (/create and Studio's
 * Create with AI): paints a streamed page into an iframe at most once per `ms`.
 *
 * `srcdocThrottle(apply, ms)` returns { push(html), flush(), cancel() }. The first push
 * paints at once (first paint lands with the first streamed chunk); later pushes inside
 * the window coalesce into one trailing paint, so the last chunk always shows. flush()
 * paints anything pending now; cancel() drops it.
 */
export const SRCDOC_THROTTLE_JS = `
  function srcdocThrottle(apply, ms) {
    var last = 0, timer = 0, pending = null;
    function run() { timer = 0; last = Date.now(); var v = pending; pending = null; apply(v); }
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
