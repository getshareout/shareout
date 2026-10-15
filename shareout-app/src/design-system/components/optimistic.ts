/**
 * Optimistic actions — the one pattern every async UI action uses.
 *
 *   soOptimistic({
 *     key,        // per-item guard: repeat calls while in flight (or in the undo window) are ignored
 *     apply,      // update the UI now (item leaves, name changes, toggle flips, modal closes)
 *     rollback,   // undo exactly what apply did
 *     request,    // () => Promise<Response|any>; a non-ok Response or a rejection is a failure
 *     success,    // optional toast on success (with undo: the "Deleted · Undo" toast text)
 *     error,      // toast headline on failure (string or fn(err) => string); the reason goes on
 *                 // a second line and the action fits it (see "Failures" below)
 *     errors,     // optional { CODE|status: text } — a call-site reason for a specific failure
 *     undo,       // destructive: the request waits until the Undo toast expires
 *     done,       // optional fn(result) after the request succeeds
 *   }) => Promise<boolean>
 *
 * `soOptimistic.busy(key)` is true while an action on `key` is pending; list renderers
 * use it to keep a reload from flashing a just-deleted row back in.
 * `soOptimistic.leave(els)` fades rows out in place and returns { restore, commit }.
 * Labels (Undo / Retry / the reasons below) come from `soOptimistic.labels`, set by each
 * surface's i18n; the English defaults here keep every other page readable.
 *
 * Failures: a non-ok Response is read for the API error envelope
 * ({ success:false, error, code, request_id?, hint? } — src/http/api-error.ts) and mapped
 * once, in `describe(err)`:
 *   401            → "session expired" + Sign in again
 *   403            → who can do it + Ask an admin (when the surface set adminRequestUrl)
 *   404            → "deleted or moved" + Refresh
 *   409 / 400      → the server's message (name taken, field invalid, …)
 *   413 / quota    → the limit, in the server's words
 *   429            → "wait a moment" + Retry
 *   5xx / network  → "our side" / "offline" + Retry, with a copyable request reference
 * Retry only appears where retrying can work. Other code reuses the same mapping:
 *   fetch(...).then(soOptimistic.check)            // non-ok → rejects with the mapped error
 *   .catch(function (e) { soOptimistic.report(e, headline, retryFn); })
 *   soOptimistic.text(e, headline)                 // headline + reason for an inline form error
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
  function toast(msg, type, action, ms, more) {
    if (typeof window.showToast !== 'function' || !msg) return { close: function() {} };
    var opts = { action: action, duration: ms };
    if (more) { opts.detail = more.detail; opts.ref = more.ref; }
    return window.showToast(msg, type, opts) || { close: function() {} };
  }
  function isResponse(x) { return !!x && typeof x === 'object' && typeof x.ok === 'boolean' && typeof x.status === 'number'; }
  // Keep the API error envelope on the Error instead of a bare "HTTP 403".
  function fromResponse(res) {
    var e = new Error('HTTP ' + res.status); e.status = res.status; e.response = res;
    var body;
    try { body = res.clone().json(); } catch (_) { body = null; }
    return Promise.resolve(body).catch(function() { return null; }).then(function(b) {
      var inner = b && b.error && typeof b.error === 'object' ? b.error : null;
      if (b && typeof b === 'object') {
        var code = typeof b.code === 'string' ? b.code : inner && typeof inner.code === 'string' ? inner.code : '';
        var msg = typeof b.error === 'string' ? b.error : inner && typeof inner.message === 'string' ? inner.message : typeof b.message === 'string' ? b.message : '';
        if (code) e.code = code;
        if (msg && !BARE.test(msg)) e.serverMessage = msg;
        if (typeof b.request_id === 'string') e.requestId = b.request_id;
      }
      if (!e.requestId && res.headers && typeof res.headers.get === 'function') e.requestId = res.headers.get('X-Request-Id') || undefined;
      return e;
    });
  }
  function check(res) { return isResponse(res) && !res.ok ? fromResponse(res).then(function(e) { throw e; }) : res; }
  // A 4xx message that only restates the status ("Forbidden") says nothing; use our own copy.
  // (5xx never shows the server's text.)
  var BARE = /^(forbidden|not found|unauthorized|bad request|conflict|http \\d+)\\.?$/i;
  var RATE = /RATE_LIMIT/;
  var LIMIT = /QUOTA|LIMIT|TOO_LARGE|_CAP$/;
  function describe(err, own) {
    err = err || {};
    var s = err.status || 0, c = err.code || '', m = err.serverMessage || '', d;
    if (!s) {
      // fetch() rejects with a TypeError when the request never reached the server.
      if (err.name === 'TypeError' || err.network) d = { kind: 'network', retry: true, detail: typeof navigator !== 'undefined' && navigator.onLine === false ? label('offline', "You're offline. Check your connection, then try again.") : label('network', "Couldn't reach the server. Check your connection.") };
      else d = { kind: 'other', retry: !err.noRetry };
    }
    else if (s === 401) d = { kind: 'auth', detail: label('session', 'Your session expired. Log in again to continue.') };
    else if (s === 429 || RATE.test(c)) d = { kind: 'rate', retry: true, detail: label('rateLimited', 'Too many requests. Wait a moment, then try again.') };
    else if (s === 413 || s === 402 || LIMIT.test(c)) d = { kind: 'limit', detail: m || label('limit', "That's over this workspace's limit.") };
    else if (s === 403) d = { kind: 'forbidden', ask: true, detail: c === 'ADMIN_REQUIRED' ? label('adminOnly', 'Only workspace admins can do this.') : m || label('forbidden', "You don't have permission to do this.") };
    else if (s === 404) d = { kind: 'gone', detail: label('notFound', 'It may have been deleted or moved.') };
    else if (s === 409) d = { kind: 'conflict', detail: m || label('conflict', 'That already exists, or someone else just changed it.') };
    else if (s >= 500) d = { kind: 'server', retry: true, ref: err.requestId, detail: label('server', 'Something went wrong on our side.') };
    else d = { kind: 'invalid', detail: m || label('invalid', 'Check what you entered and try again.') };
    var mine = own && (own[c] || own[s]);
    if (mine) d.detail = mine;
    d.status = s; d.code = c; d.server = m;
    return d;
  }
  // Call-site copy often ends in a retry nudge ("Couldn't X. Try again?"). When retrying
  // can't help, drop that closing question so the toast doesn't contradict its action.
  function headline(msg, retry) { return retry ? msg : String(msg).replace(/([.!])\\s+[^.!?]*\\?$/, '$1'); }
  function signIn() { location.href = '/auth/login?redirect=' + encodeURIComponent(location.pathname + location.search); }
  // "Ask an admin": the surface sets soOptimistic.adminRequestUrl (the workspace's
  // admin-requests endpoint); the admins get a bell row + email, this toast confirms.
  function askAdmin(d, head) {
    run({
      key: 'ask-admin:' + (d.code || d.status), noAsk: true, retry: false,
      request: function() { return fetch(run.adminRequestUrl, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: d.code || 'FORBIDDEN', action: head, message: d.server || d.detail || '' }) }); },
      success: label('askSent', 'Request sent to your workspace admins.'),
      error: label('askFailed', "Couldn't send the request."),
    });
  }
  function report(head, d, retryFn, o) {
    o = o || {};
    var retry = !!(d.retry && retryFn && o.retry !== false);
    var top = headline(head || label('failed', 'Something went wrong. Try again?'), retry);
    var act = null;
    if (d.kind === 'auth') act = { label: label('signIn', 'Log in again'), run: signIn };
    else if (d.ask && run.adminRequestUrl && !o.noAsk) act = { label: label('askAdmin', 'Ask an admin'), run: function() { askAdmin(d, top); } };
    else if (retry) act = { label: label('retry', 'Retry'), run: retryFn };
    else if (d.kind === 'gone') act = { label: label('refresh', 'Refresh'), run: function() { location.reload(); } };
    return toast(top, 'error', act, act ? 8000 : 6000, { detail: d.detail, ref: d.ref ? { id: d.ref, label: label('ref', 'Ref'), copied: label('copied', 'Copied') } : null });
  }
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
        if (msg !== false) report(msg, describe(err, o.errors), function() { run(o); }, o);
        settle(false);
      }
      function send() {
        var p;
        try { p = Promise.resolve(o.request()); } catch (e) { p = Promise.reject(e); }
        p.then(check).then(function(res) {
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
  run.describe = describe;
  run.check = check;
  run.report = function(err, head, retryFn, own) { return report(head, describe(err, own), retryFn); };
  // Headline + reason as one line, for inline form errors.
  run.text = function(err, head, own) { var d = describe(err, own), h = head ? headline(head, d.retry) : ''; return d.detail ? (h ? h + ' ' : '') + d.detail : h; };
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
