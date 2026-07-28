/**
 * Home page styles — Linked accounts dropdown
 * @module design-system/pages/home/linked-accounts-dropdown
 */

/** CSS rules for: Linked accounts dropdown */
export const linkedAccountsDropdownStyles = `/* ── Linked accounts dropdown ────────────────────────── */
.accounts-menu {
  position: absolute; top: calc(100% + 8px); right: 0; z-index: 1400;
  width: 320px; max-width: calc(100vw - 24px);
  background: var(--color-bg-elevated); border: 1px solid var(--color-border);
  border-radius: var(--radius-lg); box-shadow: var(--shadow-lg);
  padding: 1rem 1.1rem 1.1rem;
  animation: menu-pop 0.13s ease;
}
.accounts-menu[hidden] { display: none; }
.space-switcher {
  margin: -0.25rem -0.1rem 0.85rem; padding-bottom: 0.85rem;
  border-bottom: 1px solid var(--color-border);
}
.space-switcher-title {
  font-size: 0.72rem; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--color-text-tertiary); margin: 0 0 0.45rem;
}
.space-switch-item {
  display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
  width: 100%; text-align: left; border: 1px solid transparent; background: none;
  border-radius: var(--radius-md); padding: 8px 10px; cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.space-switch-item:hover { background: var(--color-surface); }
.space-switch-item.active {
  background: var(--color-primary-light); border-color: color-mix(in srgb, var(--color-primary) 25%, transparent);
}
.space-switch-name { font-size: 0.88rem; font-weight: 600; color: var(--color-text); }
.space-switch-desc { font-size: 0.75rem; color: var(--color-text-secondary); line-height: 1.35; }
.space-switch-item.active .space-switch-name { color: var(--color-primary); }
.accounts-head { display: flex; align-items: center; justify-content: space-between; }
.accounts-title { font-family: var(--font-display); font-size: 0.95rem; font-weight: 600; margin: 0; }
.accounts-sub { color: var(--color-text-secondary); font-size: 0.8rem; margin: 0.35rem 0 0.9rem; }
.accounts-list { display: flex; flex-direction: column; gap: 6px; margin-bottom: 0.9rem; }
.acct-row { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border-radius: var(--radius-md); background: var(--color-surface); }
.acct-av { width: 28px; height: 28px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center; font-size: 0.8rem; font-weight: 600; background: var(--color-primary-light); color: var(--color-primary); overflow: hidden; }
.acct-av img { width: 100%; height: 100%; object-fit: cover; }
.acct-email { flex: 1; min-width: 0; font-size: 0.85rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acct-tag { font-size: 0.7rem; color: var(--color-text-tertiary); }
.acct-unlink { border: none; background: none; color: var(--color-text-tertiary); font-size: 0.78rem; cursor: pointer; padding: 2px 4px; }
.acct-unlink:hover { color: var(--color-error); }
.accounts-empty { color: var(--color-text-tertiary); font-size: 0.85rem; padding: 6px 2px; }
.accounts-actions { display: flex; flex-direction: column; gap: 8px; margin-bottom: 0.75rem; }
.accounts-email-row { display: flex; gap: 8px; margin-bottom: 8px; }
.accounts-email-row .so-c-input { flex: 1; min-width: 0; }
.accounts-email-row .so-c-btn { flex-shrink: 0; }
.accounts-msg { font-size: 0.8rem; color: var(--color-text-secondary); min-height: 1em; }
.accounts-msg.error { color: var(--color-error); }
.accounts-msg.ok { color: var(--color-success); }

`;
