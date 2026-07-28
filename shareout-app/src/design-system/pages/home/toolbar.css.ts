/**
 * Home page styles — Toolbar
 * @module design-system/pages/home/toolbar
 */

/** CSS rules for: Toolbar */
export const toolbarStyles = `/* ── Toolbar ────────────────────────────────────────── */
.toolbar {
  display: flex; align-items: center; gap: var(--space-4);
  flex-wrap: wrap;
}
.toolbar-left { display: flex; align-items: center; gap: var(--space-4); flex: 1; min-width: 240px; }
.toolbar-right { display: flex; align-items: center; gap: 0.625rem; }

.scope-chips {
  display: inline-flex; align-items: center; gap: 2px; flex-shrink: 0;
  padding: 3px; border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.5); border: 1px solid var(--glass-border);
}
.scope-chip {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px; border: none; background: transparent; cursor: pointer;
  font: 500 0.85rem var(--font-body); color: var(--color-text-secondary);
  border-radius: var(--radius-full); white-space: nowrap;
  transition: background var(--duration-normal), color var(--duration-normal);
}
.scope-chip:hover { color: var(--color-text); }
.scope-chip.active { background: var(--color-bg-elevated); color: var(--color-primary); box-shadow: var(--shadow-sm); }
.scope-chip:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.scope-chip-count {
  font-size: 0.75rem; font-weight: 600; color: var(--color-text-tertiary);
  font-variant-numeric: tabular-nums;
}
.scope-chip.active .scope-chip-count { color: var(--color-primary); }
@media (max-width: 640px) {
  .scope-chip span:first-child { font-size: 0.8rem; }
  .scope-chip { padding: 6px 9px; }
}

.search-box { position: relative; flex: 1; max-width: 360px; min-width: 180px; }
.search-box input {
  width: 100%;
  padding: 10px 36px 10px 40px;
  background: var(--color-bg-elevated);
  border: 1.5px solid var(--color-border-strong);
  border-radius: var(--radius-lg);
  font-size: 0.9rem; color: var(--color-text);
  box-shadow: var(--shadow-sm);
  transition: all var(--duration-normal);
}
.search-box input:hover { border-color: var(--color-text-tertiary); }
.search-box input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.search-box input::placeholder { color: var(--color-text-secondary); }
.search-box > svg { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); width: 17px; height: 17px; color: var(--color-text-secondary); pointer-events: none; }
.search-clear {
  position: absolute; right: 8px; top: 50%; transform: translateY(-50%);
  display: none; align-items: center; justify-content: center;
  width: 22px; height: 22px;
  border: none; border-radius: var(--radius-full);
  background: var(--color-surface); color: var(--color-text-secondary);
  cursor: pointer; padding: 0;
  transition: background var(--duration-fast), color var(--duration-fast);
}
.search-clear svg { width: 14px; height: 14px; }
.search-clear:hover { background: var(--color-border); color: var(--color-text); }
.search-box.has-value .search-clear { display: flex; }

.sort-dropdown { position: relative; }
.sort-trigger, .folder-nav-trigger {
  display: flex; align-items: center; gap: 6px;
  padding: 10px 12px 10px 14px;
  background-color: var(--glass-bg-strong);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  font: inherit; font-size: 0.85rem; font-weight: 500; color: var(--color-text);
  cursor: pointer; white-space: nowrap;
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  transition: border-color var(--duration-normal), background var(--duration-normal);
}
.sort-trigger:hover, .folder-nav-trigger:hover { border-color: var(--color-text-tertiary); }
.sort-dropdown.open .sort-trigger,
.folder-dropdown.open .folder-nav-trigger { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.folder-nav-trigger { padding: 10px; }
.folder-nav-trigger > svg:first-child { width: 17px; height: 17px; }
.sort-icon { display: none; width: 17px; height: 17px; color: var(--color-text-secondary); }
.sort-caret { width: 15px; height: 15px; color: var(--color-text-secondary); transition: transform var(--duration-normal); }
.sort-dropdown.open .sort-caret,
.folder-dropdown.open .sort-caret { transform: rotate(180deg); }
.fnav-count { font-style: normal; color: var(--color-text-tertiary); font-weight: 500; margin-left: 4px; }
.fnav-new { color: var(--color-primary); font-weight: 600; border-top: 1px solid var(--color-border); margin-top: 2px; border-radius: 0 0 var(--radius-sm) var(--radius-sm); }
.sort-menu {
  position: absolute; top: calc(100% + 6px); right: 0; z-index: 1200;
  min-width: 184px; padding: 5px;
  background: var(--color-bg-elevated); border: 1px solid var(--color-border);
  border-radius: var(--radius-md); box-shadow: var(--shadow-lg);
  display: flex; flex-direction: column; gap: 1px;
  animation: menu-pop 0.13s ease;
}
.sort-menu[hidden] { display: none; }
.sort-menu-item {
  display: flex; align-items: center; justify-content: space-between; gap: 12px;
  text-align: left; border: none; background: none; cursor: pointer;
  padding: 9px 10px; border-radius: var(--radius-sm); font: inherit; font-size: 0.875rem;
  color: var(--color-text);
}
.sort-menu-item:hover { background: var(--color-surface); }
.sort-menu-item.active { color: var(--color-primary); font-weight: 600; }
.sort-check { width: 16px; height: 16px; color: var(--color-primary); opacity: 0; flex-shrink: 0; }
.sort-menu-item.active .sort-check { opacity: 1; }
@keyframes menu-pop { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: translateY(0); } }

.view-toggle {
  display: flex; gap: 2px;
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  padding: 3px;
}
.view-btn {
  width: 34px; height: 32px;
  display: flex; align-items: center; justify-content: center;
  border: none; background: transparent;
  border-radius: var(--radius-md);
  color: var(--color-text-tertiary);
  cursor: pointer;
  transition: all var(--duration-normal);
}
.view-btn svg { width: 17px; height: 17px; }
.view-btn:hover { color: var(--color-text-secondary); }
.view-btn.active { background: var(--color-bg-elevated); color: var(--color-primary); box-shadow: var(--shadow-sm); }

`;
