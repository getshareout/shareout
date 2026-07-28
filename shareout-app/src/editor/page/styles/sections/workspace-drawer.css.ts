/**
 * ShareOut Visual Editor styles — Workspace drawer slide-over shell and sections
 * @module editor/page/styles/sections/workspace-drawer
 */

/** CSS for the workspace drawer section of the visual editor. */
export const workspaceDrawerCss = `

/* ==========================================================================
   10. WORKSPACE DRAWER - Slide over
   ========================================================================== */
.workspace-drawer {
  position: fixed;
  inset: 0;
  z-index: 400;
}

.workspace-drawer[hidden] {
  display: none;
}

.drawer-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.3);
  backdrop-filter: blur(4px);
  animation: fadeIn var(--duration-normal) var(--ease-out);
}

.drawer-panel {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 420px;
  max-width: 90vw;
  background: var(--bg-panel);
  box-shadow: -8px 0 32px rgba(0, 0, 0, 0.15);
  display: flex;
  flex-direction: column;
  animation: slideIn var(--duration-slow) var(--ease-out);
}

@keyframes slideIn {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

.drawer-header {
  height: 64px;
  padding: 0 24px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border-light);
  flex-shrink: 0;
}

.drawer-header h2 {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
}

.drawer-close {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: all var(--duration-fast);
}

.drawer-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.drawer-content {
  flex: 1;
  overflow-y: auto;
  padding: 24px;
}

/* Drawer section styles */
.drawer-section {
  margin-bottom: 24px;
}

.drawer-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.setting-row {
  padding: 8px 0;
}

.setting-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  cursor: pointer;
}

.setting-hint {
  font-size: 12px;
  color: var(--text-muted);
}

.share-link-row {
  display: flex;
  gap: 8px;
}

.share-link-row .input {
  flex: 1;
}

.empty-hint {
  color: var(--text-muted);
  font-size: 13px;
  padding: 8px 0;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
  margin-bottom: 16px;
}

.stat-card {
  background: var(--bg-hover);
  border-radius: var(--radius-md);
  padding: 16px;
  text-align: center;
}

.stat-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  display: block;
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
}

.viewer-tracking-wrap {
  overflow-x: auto;
  margin-top: 8px;
}

.viewer-tracking-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.viewer-tracking-table th,
.viewer-tracking-table td {
  padding: 8px 6px;
  text-align: left;
  border-bottom: 1px solid var(--border-light);
}

.viewer-tracking-table th {
  color: var(--text-muted);
  font-weight: 500;
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.viewer-email {
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.viewer-status {
  display: inline-block;
  padding: 2px 8px;
  border-radius: 999px;
  font-size: 11px;
  font-weight: 500;
}

.viewer-status.viewed {
  background: rgba(34, 197, 94, 0.15);
  color: #16a34a;
}

.viewer-status.not-viewed {
  background: rgba(148, 163, 184, 0.2);
  color: var(--text-muted);
}

.storage-row {
  display: flex;
  justify-content: space-between;
  padding: 10px 0;
  border-bottom: 1px solid var(--border-light);
  font-size: 13px;
}

.storage-row:last-child {
  border-bottom: none;
}

.storage-count {
  font-weight: 600;
  color: var(--text-primary);
}

.field {
  margin-bottom: 16px;
}

.field-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  display: block;
  margin-bottom: 6px;
}

.drawer-section-danger {
  border-top: 1px solid var(--error);
  padding-top: 24px;
}
`;
