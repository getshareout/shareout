/**
 * Shared Toast component (Design/system/components.md "Success toast").
 * `toastClasses` styles the toast; `toastScript` defines
 * window.showToast(msg, type?, opts?) which every surface feature-detects.
 *
 * opts.action = { label, run } adds one inline button (Undo / Retry / Sign in again /
 * Ask an admin); clicking it closes the toast and runs the callback.
 * opts.detail adds a quieter second line (why it failed). opts.ref = { id, label, copied }
 * adds a short request reference that copies the full id on click (for support).
 * opts.duration overrides the auto-dismiss.
 * Returns { close() } so callers (soOptimistic) can dismiss it early.
 */

export const toastClasses = `
.so-c-toast-container {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 2147483646;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  max-width: calc(100vw - 32px);
  pointer-events: none;
}
.so-c-toast {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 500;
  color: var(--color-text);
  background: var(--color-bg-elevated, var(--color-surface));
  border: 1px solid var(--color-border);
  box-shadow: var(--shadow-lg);
  pointer-events: auto;
  animation: so-c-toast-in var(--duration-slow, 300ms) var(--ease-out, ease-out);
  transition: opacity var(--duration-normal, 150ms) var(--ease-out, ease-out);
}
.so-c-toast.is-leaving { opacity: 0; }
.so-c-toast svg { flex: none; }
.so-c-toast--success { background: var(--color-success-light); border-color: var(--color-success); }
.so-c-toast--success svg { color: var(--color-success); }
.so-c-toast--error { background: var(--color-error-light); border-color: var(--color-error); }
.so-c-toast--error svg { color: var(--color-error); }
.so-c-toast__act {
  margin-left: 4px;
  padding: 2px 4px;
  border: none;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--color-primary);
  text-decoration: underline;
  text-underline-offset: 2px;
  cursor: pointer;
}
.so-c-toast__body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.so-c-toast__detail { font-weight: 400; color: var(--color-text-secondary); }
.so-c-toast__ref {
  align-self: flex-start;
  padding: 0;
  border: none;
  background: none;
  font-family: var(--font-mono, monospace);
  font-size: 0.75rem;
  color: var(--color-text-tertiary, var(--color-text-secondary));
  cursor: copy;
}
.so-c-toast__ref:focus-visible,
.so-c-toast__act:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; border-radius: 2px; }
@keyframes so-c-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .so-c-toast { animation: none; } }
`;

export const toastScript = `
window.showToast = function(msg, type, opts) {
  opts = opts || {};
  var box = document.getElementById('so-c-toast-container');
  if (!box) {
    box = document.createElement('div');
    box.id = 'so-c-toast-container';
    box.className = 'so-c-toast-container';
    box.setAttribute('aria-live', 'polite');
    document.body.appendChild(box);
  }
  var el = document.createElement('div');
  el.className = 'so-c-toast' + (type ? ' so-c-toast--' + type : '');
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  if (type === 'success' || type === 'error') {
    el.innerHTML = type === 'success'
      ? '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
      : '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>';
  }
  var span = document.createElement('span');
  span.className = 'so-c-toast__msg';
  span.textContent = msg;
  if (opts.detail || (opts.ref && opts.ref.id)) {
    var bodyEl = document.createElement('span');
    bodyEl.className = 'so-c-toast__body';
    bodyEl.appendChild(span);
    if (opts.detail) {
      var det = document.createElement('span');
      det.className = 'so-c-toast__detail';
      det.textContent = opts.detail;
      bodyEl.appendChild(det);
    }
    if (opts.ref && opts.ref.id) {
      var ref = document.createElement('button');
      ref.type = 'button';
      ref.className = 'so-c-toast__ref';
      ref.textContent = (opts.ref.label || 'Ref') + ' ' + String(opts.ref.id).slice(0, 8);
      ref.title = String(opts.ref.id);
      ref.addEventListener('click', function(e) {
        e.stopPropagation();
        try { navigator.clipboard.writeText(String(opts.ref.id)); ref.textContent = opts.ref.copied || 'Copied'; } catch (_) {}
      });
      bodyEl.appendChild(ref);
    }
    el.appendChild(bodyEl);
  } else {
    el.appendChild(span);
  }
  var closed = false, tmr = null;
  function close() {
    if (closed) return;
    closed = true;
    if (tmr) clearTimeout(tmr);
    el.remove();
  }
  if (opts.action && opts.action.label) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'so-c-toast__act';
    b.textContent = opts.action.label;
    b.addEventListener('click', function(e) { e.stopPropagation(); close(); opts.action.run(); });
    el.appendChild(b);
  }
  box.appendChild(el);
  var ms = opts.duration || (opts.action ? 5000 : 2400);
  setTimeout(function() { el.classList.add('is-leaving'); }, Math.max(0, ms - 150));
  tmr = setTimeout(close, ms);
  return { close: close };
};
`;
