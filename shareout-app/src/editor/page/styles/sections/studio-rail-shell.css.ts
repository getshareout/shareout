/**
 * ShareOut Visual Editor styles — Studio rail shell — layout, tabs, panes, version history, empty states
 * @module editor/page/styles/sections/studio-rail-shell
 */

/** CSS for the studio rail shell section of the visual editor. */
export const studioRailShellCss = `


/* ==========================================================================
   9. STUDIO RAIL — warm glass panel (Agent · Inspect · Data)
   ========================================================================== */
.studio-rail {
  position: fixed;
  top: 76px;
  right: 16px;
  bottom: 16px;
  width: var(--rail-width);
  display: flex;
  flex-direction: column;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--glass-shadow);
  z-index: 50;
  overflow: hidden;
  transition: transform var(--duration-slow) var(--ease-out), opacity var(--duration-slow) var(--ease-out);
}

.studio-rail[data-collapsed="true"] {
  transform: translateX(calc(100% + 24px));
  opacity: 0;
  pointer-events: none;
}

.rail-collapse {
  position: absolute;
  top: 10px;
  right: 10px;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--text-muted);
  transition: all var(--duration-fast);
  z-index: 2;
}

.rail-collapse:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

/* Peek tab — shown when the rail is collapsed */
.rail-peek {
  position: fixed;
  top: 50%;
  right: 16px;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
  color: var(--primary);
  z-index: 49;
}

.rail-peek[hidden] {
  display: none;
}

.rail-peek:hover {
  color: var(--primary-hover);
}

/* Tabs */
.rail-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 12px 44px 12px 12px;
  flex-shrink: 0;
}

.rail-tab {
  padding: 7px 14px;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  transition: all var(--duration-fast);
}

.rail-tab:hover:not(:disabled) {
  background: rgba(0, 0, 0, 0.05);
  color: var(--text-primary);
}

.rail-tab.active {
  background: var(--primary);
  color: var(--text-inverse);
}

.rail-tab:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

/* Panes */
.rail-body {
  flex: 1;
  overflow-y: auto;
  min-height: 0;
}

.rail-pane {
  padding: 4px 16px 12px;
}

.rail-pane[hidden] {
  display: none;
}

/* In panel mode the tabs give way to a titled panel with a back button */
.studio-rail[data-mode="panel"] .rail-tabs {
  display: none;
}

.rail-panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 14px 4px 12px;
}

.rail-panel-back {
  width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-sm);
  color: var(--text-secondary);
  transition: all var(--duration-fast);
}

.rail-panel-back:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.rail-panel-title {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

/* Version history list */
.version-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.version-item {
  padding: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}

.version-item-info {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.version-item-no {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.version-item-date {
  font-size: 12px;
  color: var(--text-muted);
}

.version-item-actions {
  display: flex;
  gap: 8px;
}

/* Connections (EDIT-08 Stage B) */
.connect-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.connect-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}

.connect-item-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.connect-item-name {
  font-weight: 600;
  font-size: 14px;
  color: var(--text-primary);
}

.connect-item-type {
  font-size: 12px;
  color: var(--text-muted);
}

.connect-item-scope {
  font-size: 11px;
  color: var(--text-secondary);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: var(--bg-hover);
  white-space: nowrap;
}

.connect-add {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 12px;
  margin-bottom: 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
}

.connect-add-title {
  font-weight: 600;
  font-size: 13px;
  color: var(--text-primary);
}

.connect-add-status:empty {
  display: none;
}

/* Empty state inside a pane */
.rail-empty {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-secondary);
}

.rail-empty-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.rail-empty-hint {
  font-size: 13px;
  color: var(--text-muted);
}

/* Artifact actions footer — Ship + Doc, quiet icon strip at the rail's base */
.rail-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 8px 12px;
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

.rail-actions-group {
  display: flex;
  align-items: center;
  gap: 2px;
}

.rail-actions-spacer {
  flex: 1;
}

.rail-action {
  position: relative;
  width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 9px;
  color: var(--text-secondary);
  transition: all var(--duration-fast);
}

.rail-action:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.rail-action.fav-btn.active {
  color: #f59e0b;
}

.rail-action.fav-btn.active svg {
  fill: #f59e0b;
}

.rail-action.fav-btn.active:hover {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

/* Hover labels appear above (footer sits at the rail's base) */
.rail-action[data-label]:hover::after {
  content: attr(data-label);
  position: absolute;
  bottom: calc(100% + 8px);
  left: 50%;
  transform: translateX(-50%);
  padding: 4px 8px;
  background: var(--text-primary);
  color: var(--text-inverse);
  font-size: 11px;
  font-weight: 500;
  border-radius: 6px;
  white-space: nowrap;
  pointer-events: none;
  z-index: 300;
  box-shadow: var(--shadow-md);
}
`;
