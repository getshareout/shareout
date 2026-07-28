/**
 * Home page styles — API token (self-serve)
 * @module design-system/pages/home/api-token-self-serve
 */

/** CSS rules for: API token (self-serve) */
export const apiTokenSelfServeStyles = `/* ── API token (self-serve) ─────────────────────────── */
.accounts-token { border-top: 1px solid var(--color-border); padding-top: 0.75rem; margin-bottom: 0.25rem; }
.token-row { display: flex; gap: 8px; }
.token-row .so-c-btn { flex: 1; min-width: 0; }
.token-regen {
  flex-shrink: 0; width: 38px; display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--color-border); background: var(--color-surface);
  border-radius: var(--radius-md); color: var(--color-text-secondary); cursor: pointer;
  transition: color 0.15s, border-color 0.15s;
}
.token-regen[hidden] { display: none; }
.token-regen:hover { color: var(--color-primary); border-color: var(--color-primary); }
.token-hint { font-size: 0.78rem; color: var(--color-text-tertiary); margin: 0.5rem 0 0; }
.token-hint.error { color: var(--color-error); }
.token-hint.ok { color: var(--color-success); }
.token-reveal { display: flex; gap: 8px; align-items: center; margin-top: 8px; }
.token-reveal[hidden] { display: none; }
.token-value {
  flex: 1; min-width: 0; font-family: var(--font-mono, ui-monospace, monospace);
  font-size: 0.72rem; background: var(--color-surface); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); padding: 7px 9px; overflow-x: auto; white-space: nowrap;
}
.token-copy {
  flex-shrink: 0; border: 1px solid var(--color-border); background: var(--color-bg-elevated);
  border-radius: var(--radius-md); padding: 7px 10px; font-size: 0.78rem; cursor: pointer;
  color: var(--color-text-secondary);
}
.token-copy:hover { color: var(--color-primary); border-color: var(--color-primary); }

`;
