/**
 * Shared Modal component.
 * - `modalClasses`: overlay/panel/head/body/foot CSS (consumes --color-* vars).
 * - `modalShell()`: server-rendered declarative modal (hidden until soModalOpen).
 * - `modalScript`: defines window.soModalOpen / soModalClose with Escape +
 *   backdrop-click handling, shared by every declarative modal on the page.
 *
 * Client scripts that build modals dynamically (e.g. the viewer toolbar) emit
 * the same `.so-c-modal-*` class names instead of inline style strings.
 */

export const modalClasses = `
.so-c-modal-overlay {
  position: fixed;
  inset: 0;
  z-index: 1100;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 1rem;
  background: var(--soc-overlay-bg, rgba(28, 25, 23, 0.45));
  backdrop-filter: var(--soc-overlay-blur, none);
}
.so-c-modal-overlay--top { z-index: 2147483600; }
.so-c-modal {
  position: relative;
  width: var(--soc-modal-width, min(440px, calc(100vw - 32px)));
  max-height: calc(100vh - 48px);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  background: var(--soc-modal-bg, var(--color-bg-elevated));
  border: 1px solid var(--soc-modal-border, var(--color-border));
  border-radius: var(--soc-modal-radius, var(--radius-lg));
  box-shadow: var(--soc-modal-shadow, var(--shadow-xl));
  color: var(--color-text);
  font: inherit;
}
.so-c-modal__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--color-border);
  font-weight: 600;
}
.so-c-modal__title { font-family: var(--font-display); font-weight: 700; font-size: 1rem; }
.so-c-modal__close {
  border: none;
  background: none;
  font-size: 1.2rem;
  line-height: 1;
  cursor: pointer;
  color: var(--color-text-secondary);
}
.so-c-modal__body { padding: 8px 16px 14px; overflow: auto; flex: 1 1 auto; min-height: 0; }
.so-c-modal__foot {
  display: flex;
  gap: 0.5rem;
  padding: 12px 16px;
  border-top: 1px solid var(--color-border);
}
.so-c-modal__foot .so-c-btn { flex: 1; }
`;

export interface ModalShellOptions {
  id: string;
  title: string;
  body: string;
  footer: string;
  top?: boolean;
}

export function modalShell(opts: ModalShellOptions): string {
  const overlayCls = `so-c-modal-overlay${opts.top ? ' so-c-modal-overlay--top' : ''}`;
  return `<div id="${opts.id}" class="${overlayCls}" role="dialog" aria-modal="true" style="display:none;" data-so-modal>
  <div class="so-c-modal">
    <div class="so-c-modal__head"><span class="so-c-modal__title">${opts.title}</span><button type="button" class="so-c-modal__close" aria-label="Close" onclick="soModalClose('${opts.id}')">&times;</button></div>
    <div class="so-c-modal__body">${opts.body}</div>
    <div class="so-c-modal__foot">${opts.footer}</div>
  </div>
</div>`;
}

export const modalScript = `
window.soModalOpen = function(id) {
  var ov = document.getElementById(id);
  if (ov) ov.style.display = 'flex';
};
window.soModalClose = function(id) {
  var ov = document.getElementById(id);
  if (ov) ov.style.display = 'none';
};
(function() {
  if (window.__soModalInit) return;
  window.__soModalInit = true;
  document.addEventListener('click', function(e) {
    var ov = e.target;
    if (ov && ov.hasAttribute && ov.hasAttribute('data-so-modal') && e.target === ov) {
      ov.style.display = 'none';
    }
  });
  document.addEventListener('keydown', function(e) {
    if (e.key !== 'Escape') return;
    var open = document.querySelectorAll('[data-so-modal]');
    for (var i = open.length - 1; i >= 0; i--) {
      var ov = open[i];
      if (ov.style.display !== 'none' && ov.style.display !== '') { ov.style.display = 'none'; break; }
    }
  });
})();
`;
