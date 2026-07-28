/**
 * Home page styles — Folder context menu
 * @module design-system/pages/home/folder-context-menu
 */

/** CSS rules for: Folder context menu */
export const folderContextMenuStyles = `/* ── Folder context menu ────────────────────────────── */
.folder-menu {
  position: absolute; z-index: 1400; min-width: 156px; padding: 5px;
  background: var(--color-bg-elevated); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
  display: none; flex-direction: column; gap: 1px;
  animation: menu-pop 0.13s ease;
}
.folder-menu.open { display: flex; }
.folder-menu-item { display: flex; align-items: center; gap: 9px; text-align: left; border: none; background: none; cursor: pointer; padding: 9px 10px; border-radius: var(--radius-sm); font: inherit; font-size: 0.875rem; color: var(--color-text); }
.folder-menu-item svg { width: 15px; height: 15px; flex-shrink: 0; }
.folder-menu-item:hover { background: var(--color-surface); }
.folder-menu-item.danger { color: var(--color-error); }
.folder-menu-item.danger:hover { background: color-mix(in srgb, var(--color-error) 8%, transparent); }

`;
