/**
 * ShareOut Visual Editor styles — Workspace menu glass dropdown
 * @module editor/page/styles/sections/workspace-menu
 */

/** CSS for the workspace menu section of the visual editor. */
export const workspaceMenuCss = `

/* ==========================================================================
   4. WORKSPACE MENU (glass dropdown)
   ========================================================================== */
.workspace-menu {
  position: fixed;
  top: 76px;
  right: calc(50% - 200px);
  background: rgba(255, 255, 255, 0.9);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  padding: 8px;
  min-width: 200px;
  z-index: 300;
  animation: fadeIn var(--duration-fast) var(--ease-out);
}

.workspace-menu[hidden] {
  display: none;
}

.menu-item {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 12px 16px;
  border-radius: 12px;
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  text-align: left;
  transition: background var(--duration-fast);
}

.menu-item:hover {
  background: rgba(0, 0, 0, 0.05);
}

.menu-item svg {
  color: var(--text-secondary);
  flex-shrink: 0;
}

.menu-divider {
  height: 1px;
  background: rgba(0, 0, 0, 0.08);
  margin: 8px 0;
}
`;
