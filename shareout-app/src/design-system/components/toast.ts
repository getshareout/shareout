/**
 * Shared Toast component (Design/system/components.md "Success toast").
 * `toastClasses` styles the toast; `toastScript` defines
 * window.showToast(msg, type?, opts?) which every surface feature-detects.
 *
 * opts.action = { label, run } adds one inline button (Undo / Retry); clicking it
 * closes the toast and runs the callback. opts.duration overrides the auto-dismiss.
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
  span.textContent = msg;
  el.appendChild(span);
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
