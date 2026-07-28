/**
 * Home page styles — Folder scope badge & drag-and-drop
 * @module design-system/pages/home/folder-scope-badge-drag-and-drop
 */

/** CSS rules for: Folder scope badge & drag-and-drop */
export const folderScopeBadgeDragAndDropStyles = `/* ── Folder scope badge & drag-and-drop ─────────────── */
.folders-scope { flex-shrink: 0; display: inline-flex; align-items: center; font-size: 0.72rem; font-weight: 600; padding: 3px 9px; border-radius: 999px; white-space: nowrap; cursor: help; }
.folders-scope[hidden] { display: none; }
.folders-scope[data-scope="personal"] { color: var(--color-text-secondary); background: rgba(0,0,0,0.05); }
.folders-scope[data-scope="workspace"] { color: var(--color-primary); background: var(--color-primary-light); }
.artifact-card.dragging { opacity: 0.45; }
.folder-chip.drag-over { border-color: var(--color-primary); background: var(--color-primary-light); box-shadow: var(--shadow-sm); }
.drag-ghost {
  position: fixed; top: -9999px; left: -9999px; pointer-events: none;
  display: inline-flex; align-items: center; gap: 8px; max-width: 240px;
  padding: 8px 13px; border-radius: var(--radius-md);
  background: var(--color-bg-elevated); border: 1px solid var(--color-primary);
  box-shadow: var(--shadow-md); font-size: 0.85rem; font-weight: 600; color: var(--color-text);
}
.drag-ghost svg { width: 15px; height: 15px; color: var(--color-primary); flex-shrink: 0; }
.drag-ghost span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

`;
