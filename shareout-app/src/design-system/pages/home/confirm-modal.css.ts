/**
 * Home page styles — Confirm modal
 * @module design-system/pages/home/confirm-modal
 */

/** CSS rules for: Confirm modal */
export const confirmModalStyles = `/* ── Confirm modal ──────────────────────────────────── */
.confirm-overlay { position: fixed; inset: 0; z-index: 1300; display: none; align-items: center; justify-content: center; padding: 1.5rem; }
.confirm-overlay.open { display: flex; }
.confirm-backdrop { position: absolute; inset: 0; background: rgba(0, 0, 0, 0.32); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.confirm-panel {
  position: relative; width: 100%; max-width: 420px;
  background: var(--color-bg-elevated);
  border-radius: var(--radius-xl);
  padding: var(--space-8) var(--space-6) var(--space-6);
  text-align: center;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
  animation: confirmPop 0.24s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes confirmPop { from { transform: scale(0.94) translateY(8px); opacity: 0; } to { transform: scale(1) translateY(0); opacity: 1; } }
.confirm-icon {
  width: 56px; height: 56px; margin: 0 auto var(--space-5);
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%;
  background: var(--color-error-light); color: var(--color-error);
  box-shadow: 0 0 0 8px color-mix(in srgb, var(--color-error) 8%, transparent);
  animation: confirmIconPop 0.36s 0.04s cubic-bezier(0.34, 1.56, 0.64, 1) both;
}
@keyframes confirmIconPop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.confirm-icon svg { width: 24px; height: 24px; }
.confirm-title { font-family: var(--font-display); font-size: 1.2rem; font-weight: 700; margin: 0 0 var(--space-2); color: var(--color-text); letter-spacing: -0.01em; }
.confirm-text { font-size: 0.925rem; color: var(--color-text-secondary); margin: 0 0 var(--space-6); line-height: 1.55; }
.trash-panel { max-width: 460px; text-align: left; }
.trash-list { display: flex; flex-direction: column; gap: 6px; max-height: 50vh; overflow-y: auto; margin-bottom: var(--space-6); }
.trash-item { display: flex; align-items: center; gap: 0.75rem; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
.trash-item-info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.trash-item-name { font-size: 0.925rem; font-weight: 600; color: var(--color-text-primary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.trash-item-meta { font-size: 0.8rem; color: var(--color-text-secondary); }
.trash-item button { flex: 0 0 auto; min-height: 36px; width: auto; padding: 8px 14px; }
.trash-empty { text-align: center; padding: 1.5rem; color: var(--color-text-secondary); font-size: 0.9rem; }
.confirm-actions { display: flex; gap: 0.625rem; }
.confirm-actions .so-c-btn { flex: 1; }
.confirm-actions .so-c-btn:active { transform: scale(0.98); }
.input-panel { text-align: left; }
.input-panel .confirm-title { text-align: left; }
.confirm-input {
  width: 100%; box-sizing: border-box;
  padding: 11px 14px; margin: 0 0 var(--space-6);
  background: var(--color-bg-elevated);
  border: 1.5px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  font: inherit; font-size: 0.95rem; color: var(--color-text);
}
.confirm-input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }

`;
