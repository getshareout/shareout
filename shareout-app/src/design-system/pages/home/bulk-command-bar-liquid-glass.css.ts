/**
 * Home page styles — Bulk command bar (liquid glass)
 * @module design-system/pages/home/bulk-command-bar-liquid-glass
 */

/** CSS rules for: Bulk command bar (liquid glass) */
export const bulkCommandBarLiquidGlassStyles = `/* ── Bulk command bar (liquid glass) ────────────────── */
.cmdbar {
  position: fixed; left: 50%; bottom: 26px;
  transform: translateX(-50%) translateY(140%);
  z-index: 1100;
  display: flex; align-items: center; gap: 0.75rem;
  padding: 8px 8px 8px 18px;
  border-radius: var(--radius-full);
  opacity: 0;
  transition: transform 0.34s cubic-bezier(0.32, 0.72, 0, 1), opacity 0.24s ease;
}
.cmdbar.show { transform: translateX(-50%) translateY(0); opacity: 1; }
/* Center over the main content area (offset by the sidebar), not the viewport */
@media (min-width: 961px) {
  .cmdbar { left: calc(50% + 150px); }
  html.rail-collapsed .cmdbar { left: calc(50% + 38px); }
}
.cmdbar-count { font-size: 0.85rem; font-weight: 700; color: var(--color-text); white-space: nowrap; }
.cmdbar-count span { color: var(--color-primary); }
.cmdbar-sep { width: 1px; align-self: stretch; background: rgba(28, 25, 23, 0.12); margin: 4px 0; }
.cmdbar-actions { display: flex; align-items: center; gap: 4px; }
.cmdbar-btn {
  display: inline-flex; align-items: center; gap: 0.4rem;
  padding: 8px 12px;
  border: none; border-radius: var(--radius-full);
  background: transparent;
  color: var(--color-text); font: inherit;
  font-size: 0.82rem; font-weight: 600;
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}
.cmdbar-btn svg { width: 16px; height: 16px; }
.cmdbar-btn:hover { background: rgba(255, 255, 255, 0.75); }
.cmdbar-btn.danger { color: var(--color-danger, var(--color-error)); }
.cmdbar-btn.danger:hover { background: var(--color-danger, var(--color-error)); color: var(--color-text-inverse); }
.cmdbar-clear {
  width: 34px; height: 34px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%;
  background: rgba(28, 25, 23, 0.06);
  color: var(--color-text-secondary); cursor: pointer;
  transition: all var(--duration-fast);
}
.cmdbar-clear svg { width: 16px; height: 16px; }
.cmdbar-clear:hover { background: rgba(28, 25, 23, 0.12); color: var(--color-text); }

`;
