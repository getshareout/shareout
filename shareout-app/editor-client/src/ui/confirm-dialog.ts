/**
 * Studio confirm dialog — same product choices as window.confirm, studio chrome.
 * Primary = confirm (was OK); secondary = cancel.
 */
export interface ConfirmDialogOptions {
  title: string;
  body: string;
  /** Label for the primary action (default "OK"). */
  confirmLabel?: string;
  /** Label for the secondary action (default "Cancel"). */
  cancelLabel?: string;
  /** Destructive primary styling (delete-style). */
  danger?: boolean;
}

/**
 * Promise resolves true when the user picks the primary action, false for cancel
 * or dismiss (backdrop / Escape).
 */
export function showConfirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const existing = document.getElementById('so-studio-confirm');
    existing?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'so-studio-confirm';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'so-studio-confirm-title');
    overlay.style.cssText =
      'position:fixed;inset:0;background:rgba(0,0,0,0.45);z-index:20000;display:flex;align-items:center;justify-content:center;padding:24px;';

    const card = document.createElement('div');
    card.style.cssText =
      'background:var(--bg-primary,#fff);color:var(--text-primary,#111);max-width:440px;width:100%;border-radius:12px;padding:24px;box-shadow:0 16px 48px rgba(0,0,0,0.2);';

    const primaryClass = opts.danger ? 'so-c-btn so-c-btn--danger' : 'so-c-btn so-c-btn--primary';
    card.innerHTML = `
      <h3 id="so-studio-confirm-title" style="margin:0 0 8px;font-size:18px;"></h3>
      <p id="so-studio-confirm-body" style="margin:0 0 20px;font-size:14px;color:var(--text-muted,#666);line-height:1.5;white-space:pre-wrap;"></p>
      <div style="display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;">
        <button type="button" data-action="cancel" class="so-c-btn so-c-btn--secondary"></button>
        <button type="button" data-action="confirm" class="${primaryClass}"></button>
      </div>
    `;

    const titleEl = card.querySelector('#so-studio-confirm-title') as HTMLElement;
    const bodyEl = card.querySelector('#so-studio-confirm-body') as HTMLElement;
    const cancelBtn = card.querySelector('[data-action="cancel"]') as HTMLButtonElement;
    const confirmBtn = card.querySelector('[data-action="confirm"]') as HTMLButtonElement;
    titleEl.textContent = opts.title;
    bodyEl.textContent = opts.body;
    cancelBtn.textContent = opts.cancelLabel || 'Cancel';
    confirmBtn.textContent = opts.confirmLabel || 'OK';

    overlay.appendChild(card);
    document.body.appendChild(overlay);

    const finish = (value: boolean) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      resolve(value);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        finish(false);
      }
    };
    document.addEventListener('keydown', onKey);

    cancelBtn.addEventListener('click', () => finish(false));
    confirmBtn.addEventListener('click', () => finish(true));
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) finish(false);
    });

    // Focus primary so Enter works like native confirm
    requestAnimationFrame(() => confirmBtn.focus());
  });
}
