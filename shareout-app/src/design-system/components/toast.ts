/**
 * Shared Toast component.
 * `toastClasses` styles the toast; `toastScript` defines window.showToast(msg, type)
 * which existing code (e.g. share-modal) already feature-detects.
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
  gap: 8px;
  pointer-events: none;
}
.so-c-toast {
  padding: 10px 16px;
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 0.85rem;
  font-weight: 600;
  color: var(--color-text-inverse);
  background: var(--color-text);
  box-shadow: var(--shadow-lg);
}
.so-c-toast--success { background: var(--color-success); }
.so-c-toast--error { background: var(--color-error); }
.so-c-toast--info { background: var(--color-primary); }
`;

export const toastScript = `
window.showToast = function(msg, type) {
  var box = document.getElementById('so-c-toast-container');
  if (!box) {
    box = document.createElement('div');
    box.id = 'so-c-toast-container';
    box.className = 'so-c-toast-container';
    document.body.appendChild(box);
  }
  var el = document.createElement('div');
  el.className = 'so-c-toast' + (type ? ' so-c-toast--' + type : '');
  el.textContent = msg;
  box.appendChild(el);
  setTimeout(function() { el.remove(); }, 2400);
};
`;
