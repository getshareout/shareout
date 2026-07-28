/**
 * Keyboard shortcuts modal (editor-client toolbar).
 */

export const shortcutsHelpCss = `
.shortcuts-modal {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.shortcuts-dialog {
  background: var(--bg-panel);
  border-radius: var(--radius-md);
  padding: 24px;
  max-width: 400px;
  max-height: 80vh;
  overflow: auto;
  border: 1px solid var(--border-light);
  box-shadow: var(--shadow-lg);
}

.shortcuts-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.shortcuts-head h2 {
  margin: 0;
  font-size: 18px;
  font-family: var(--font-display);
  color: var(--text-primary);
}

.shortcuts-close {
  border: none;
  background: none;
  font-size: 24px;
  cursor: pointer;
  color: var(--text-muted);
  line-height: 1;
  padding: 0 4px;
  border-radius: var(--radius-sm);
}

.shortcuts-close:hover {
  color: var(--text-primary);
  background: var(--bg-hover);
}

.shortcuts-table {
  width: 100%;
  border-collapse: collapse;
}

.shortcuts-table td {
  padding: 8px 0;
  font-size: 13px;
  color: var(--text-primary);
}

.shortcuts-table td:first-child {
  padding-right: 12px;
  font-family: var(--font-mono);
  white-space: nowrap;
  color: var(--text-secondary);
}
`;
