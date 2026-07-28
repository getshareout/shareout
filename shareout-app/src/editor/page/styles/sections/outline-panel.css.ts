/**
 * ShareOut Visual Editor styles — Outline panel inside the workspace drawer
 * @module editor/page/styles/sections/outline-panel
 */

/** CSS for the outline panel section of the visual editor. */
export const outlinePanelCss = `

/* ==========================================================================
   10a. OUTLINE PANEL
   ========================================================================== */
.outline-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 12px;
}

.outline-count {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
}

.outline-hint {
  font-size: 11px;
  color: var(--text-muted);
}

.hint-subtext {
  font-size: 12px;
  color: var(--text-muted);
  line-height: 1.6;
  margin-top: 8px;
}

.hint-subtext code {
  background: var(--bg-hover);
  padding: 2px 6px;
  border-radius: 4px;
  font-family: var(--font-mono);
  font-size: 11px;
}

.outline-tree {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.outline-node {
  display: flex;
  flex-direction: column;
}

.outline-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  padding-left: calc(12px + var(--depth, 0) * 16px);
  border: none;
  background: transparent;
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
  width: 100%;
  transition: background var(--duration-fast);
}

.outline-item:hover {
  background: var(--bg-hover);
}

.outline-node.active > .outline-item {
  background: var(--primary-soft);
}

.outline-icon {
  flex-shrink: 0;
  color: var(--text-muted);
  display: flex;
  align-items: center;
}

.outline-icon svg {
  width: 14px;
  height: 14px;
}

.outline-label {
  flex: 1;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.outline-type {
  font-size: 10px;
  font-weight: 500;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.3px;
  padding: 2px 6px;
  background: var(--bg-hover);
  border-radius: 4px;
}

.outline-children {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
`;
