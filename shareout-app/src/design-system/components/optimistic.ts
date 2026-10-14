/**
 * Optimistic actions — the one pattern every async UI action uses.
 *
 *   soOptimistic({
 *     key,        // per-item guard: repeat calls while in flight (or in the undo window) are ignored
 *     apply,      // update the UI now (item leaves, name changes, toggle flips, modal closes)
 *     rollback,   // undo exactly what apply did
 *     request,    // () => Promise<Response|any>; a non-ok Response or a rejection is a failure
 *     success,    // optional toast on success (with undo: the "Deleted · Undo" toast text)
 *     error,      // toast text on failure (string or fn(err) => string); Retry re-runs the action
 *                 // (unless retry: false or the thrown error has noRetry, e.g. a policy refusal)
 *     undo,       // destructive: the request waits until the Undo toast expires
 *     done,       // optional fn(result) after the request succeeds
 *   }) => Promise<boolean>
 *
 * `soOptimistic.busy(key)` is true while an action on `key` is pending; list renderers
 * use it to keep a reload from flashing a just-deleted row back in.
 * `soOptimistic.leave(els)` fades rows out in place and returns { restore, commit }.
 * Labels (Undo / Retry) come from `soOptimistic.labels`, set by each surface's i18n.
 */

export const optimisticClasses = `
.so-c-leaving { opacity: 0; transition: opacity var(--duration-normal, 150ms) var(--ease-out, ease-out); pointer-events: none; }
@media (prefers-reduced-motion: reduce) { .so-c-leaving { transition: none; } }
`;

export const optimisticScript = `
(function() {
  var inflight = {};
  var pending = [];
  var UNDO_MS = 5000;
  function label(k, d) { var l = window.soOptimistic && window.soOptimistic.labels; return (l && l[k]) || d; }
  function toast(msg, type, action, ms) {
    if (typeof window.showToast !== 'function' || !msg) return { close: function() {} };
    return window.showToast(msg, type, { action: action, duration: ms }) || { close: function() {} };
  }
  function isResponse(x) { return !!x && typeof x === 'object' && typeof x.ok === 'boolean' && typeof x.status === 'number'; }
  function run(o) {
    var key = o.key;
    if (key && inflight[key]) return Promise.resolve(false);
    if (key) inflight[key] = true;
    try { if (o.apply) o.apply(); } catch (e) { if (key) delete inflight[key]; return Promise.reject(e); }
    return new Promise(function(resolve) {
      function settle(ok) { if (key) delete inflight[key]; resolve(ok); }
      function fail(err) {
        try { if (o.rollback) o.rollback(err); } catch (_) {}
        var msg = typeof o.error === 'function' ? o.error(err) : o.error;
        if (msg !== false) toast(msg || label('failed', 'Something went wrong. Try again?'), 'error', o.retry === false || (err && err.noRetry) ? null : { label: label('retry', 'Retry'), run: function() { run(o); } }, 6000);
        settle(false);
      }
      function send() {
        var p;
        try { p = Promise.resolve(o.request()); } catch (e) { p = Promise.reject(e); }
        p.then(function(res) {
          if (isResponse(res) && !res.ok) { var e = new Error('HTTP ' + res.status); e.status = res.status; e.response = res; throw e; }
          return res;
        }).then(function(res) {
          if (!o.undo && o.success) toast(o.success, 'success');
          try { if (o.done) o.done(res); } catch (_) {}
          settle(true);
        }, fail);
      }
      if (!o.undo) { send(); return; }
      var entry = { fired: false };
      var timer = null, t = null;
      function drop() { var i = pending.indexOf(entry); if (i >= 0) pending.splice(i, 1); }
      entry.fire = function() {
        if (entry.fired) return;
        entry.fired = true; clearTimeout(timer); drop();
        if (t) t.close();
        send();
      };
      pending.push(entry);
      t = toast(o.success, 'success', { label: label('undo', 'Undo'), run: function() {
        if (entry.fired) return;
        entry.fired = true; clearTimeout(timer); drop();
        try { if (o.rollback) o.rollback(); } catch (_) {}
        settle(false);
      } }, UNDO_MS);
      timer = setTimeout(entry.fire, UNDO_MS);
    });
  }
  window.soOptimistic = run;
  run.labels = run.labels || {};
  run.busy = function(key) { return !!inflight[key]; };
  // Send deferred (undo-window) requests now; callers pass keepalive so they survive unload.
  run.flush = function() { pending.slice().forEach(function(e) { e.fire(); }); };
  run.leave = function(els) {
    var list = [];
    if (els) (els.length !== undefined && !els.nodeType ? Array.prototype.slice.call(els) : [els]).forEach(function(el) { if (el) list.push(el); });
    var state = list.map(function(el) { return el.style.display; });
    var hideT = setTimeout(function() { list.forEach(function(el) { el.style.display = 'none'; }); }, 160);
    list.forEach(function(el) { el.classList.add('so-c-leaving'); });
    return {
      restore: function() { clearTimeout(hideT); list.forEach(function(el, i) { el.classList.remove('so-c-leaving'); el.style.display = state[i]; }); },
      commit: function() { clearTimeout(hideT); list.forEach(function(el) { if (el.parentNode) el.parentNode.removeChild(el); }); }
    };
  };
  window.addEventListener('pagehide', run.flush);
})();
`;
