/**
 * Home page styles — Admin page (workspace)
 * @module design-system/pages/home/admin-page-workspace
 */

/** CSS rules for: Admin page (workspace) */
export const adminPageWorkspaceStyles = `/* ── Admin page (workspace) ─────────────────────────── */
.admin-head { margin-bottom: var(--space-5); }
.admin-title { font-family: var(--font-display); font-size: 1.4rem; font-weight: 700; margin: 0; color: var(--color-text); }
.admin-sub { font-size: 0.9rem; color: var(--color-text-secondary); margin: 0.35rem 0 0; }
.admin-tabs { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--color-border); margin-bottom: var(--space-5); }
.admin-tab {
  appearance: none; border: none; background: none; cursor: pointer;
  padding: 0.6rem 0.9rem; margin-bottom: -1px;
  font: inherit; font-size: 0.9rem; font-weight: 600;
  color: var(--color-text-secondary);
  border-bottom: 2px solid transparent;
  transition: color var(--duration-fast), border-color var(--duration-fast);
}
.admin-tab:hover { color: var(--color-text); }
.admin-tab.active { color: var(--color-primary); border-bottom-color: var(--color-primary); }
.admin-panel { display: flex; flex-direction: column; gap: var(--space-5); }
.admin-panel[hidden] { display: none; }

/* Features (read-only) tab */
.ws-features { display: flex; flex-direction: column; gap: var(--space-5); }
.ws-feat-group { display: flex; flex-direction: column; gap: 2px; }
.ws-feat-cat { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); margin: 0 0 0.4rem; font-weight: 700; }
.ws-feat-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: 0.6rem 0; border-bottom: 1px solid var(--color-border); }
.ws-feat-meta { display: flex; flex-direction: column; min-width: 0; }
.ws-feat-name { font-size: 0.92rem; font-weight: 600; color: var(--color-text); }
.ws-feat-desc { font-size: 0.78rem; color: var(--color-text-tertiary); }
.ws-feat-pill { flex-shrink: 0; font-size: 0.72rem; font-weight: 700; border-radius: 999px; padding: 2px 10px; }
.ws-feat-pill.on { color: var(--color-success); background: var(--color-success-light); }
.ws-feat-pill.off { color: var(--color-text-tertiary); background: rgba(0,0,0,0.05); }

/* Knowledge files tab */
.ws-file-table { width: 100%; border-collapse: collapse; font-size: 0.88rem; }
.ws-file-table th { text-align: left; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-tertiary); font-weight: 700; padding: 0 0.6rem 0.5rem; border-bottom: 1px solid var(--color-border); }
.ws-file-row td { padding: 0.65rem 0.6rem; border-bottom: 1px solid var(--color-border); vertical-align: middle; }
.ws-file-name { font-weight: 600; color: var(--color-text); font-family: var(--font-mono, monospace); }
.ws-file-ico { display: inline-flex; vertical-align: -3px; margin-right: 0.45rem; color: var(--color-text-tertiary); }
.ws-file-ico svg { width: 15px; height: 15px; }
.ws-file-size, .ws-file-upd { color: var(--color-text-tertiary); white-space: nowrap; width: 1%; }
.ws-file-actions { text-align: right; white-space: nowrap; width: 1%; }
.ws-file-actions .member-act { margin-left: 0.35rem; }
.ws-file-badge { font-size: 0.66rem; font-weight: 700; padding: 1px 7px; border-radius: 999px; vertical-align: middle; }
.ws-file-badge.entry { color: var(--color-primary); background: var(--color-primary-light); }
.ws-file-modal { max-width: 640px; width: 92vw; }
.ws-file-text { width: 100%; font-family: var(--font-mono, monospace); font-size: 0.82rem; line-height: 1.5; resize: vertical; min-height: 280px; }
.ws-file-foot-meta { display: flex; justify-content: space-between; gap: var(--space-4); margin-top: 0.4rem; font-size: 0.74rem; color: var(--color-text-tertiary); }
.ws-file-hint { color: var(--color-text-tertiary); }

`;
