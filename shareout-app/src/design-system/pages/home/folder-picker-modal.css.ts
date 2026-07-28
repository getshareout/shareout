/**
 * Home page styles — Folder picker modal
 * @module design-system/pages/home/folder-picker-modal
 */

/** CSS rules for: Folder picker modal */
export const folderPickerModalStyles = `/* ── Folder picker modal ────────────────────────────── */
.folder-picker-panel { text-align: left; }
.folder-picker-list { display: flex; flex-direction: column; gap: 4px; max-height: 320px; overflow-y: auto; margin: 0.75rem 0; }
.folder-picker-heading { font-size: 0.72rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--color-text-tertiary); margin: 8px 2px 4px; }
.folder-picker-item { display: flex; align-items: center; gap: 10px; padding: 9px 11px; border: 1px solid rgba(0,0,0,0.08); border-radius: var(--radius-md); background: var(--color-bg-elevated); cursor: pointer; font: inherit; font-size: 0.88rem; text-align: left; color: var(--color-text); }
.folder-picker-item:hover { border-color: var(--color-primary); background: var(--color-primary-light); }
.folder-picker-item svg { width: 16px; height: 16px; color: var(--color-primary); flex-shrink: 0; }

@media (prefers-color-scheme: dark) {
  .folder-chip, .folder-picker-item { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.1); }
  .folder-chip-count { background: rgba(255,255,255,0.08); }
  .folders-scope[data-scope="personal"] { background: rgba(255,255,255,0.08); }
  .folder-chip-menu:hover, .folder-menu-item:hover { background: rgba(255,255,255,0.08); }
}

`;
