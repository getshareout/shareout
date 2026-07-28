/**
 * Publish-approval picker overlay (editor visibility flow).
 */

export const approvalPickerCss = `
#editor-appr-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
}

.editor-appr-dialog {
  background: var(--bg-panel);
  color: var(--text-primary);
  max-width: 440px;
  width: 90%;
  border-radius: var(--radius-md);
  padding: 20px;
  box-shadow: var(--shadow-lg);
  border: 1px solid var(--border-light);
}

.editor-appr-dialog h3 {
  margin: 0 0 8px;
  font-size: 16px;
  font-family: var(--font-display);
}

.editor-appr-dialog p {
  margin: 0 0 12px;
  font-size: 13px;
  color: var(--text-secondary);
}

.editor-appr-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 0 8px;
  min-height: 24px;
}

.editor-appr-chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 3px 8px;
  border-radius: 6px;
  background: var(--primary-soft);
  font-size: 13px;
  color: var(--text-primary);
}

.editor-appr-chip-rm {
  border: 0;
  background: none;
  cursor: pointer;
  font-size: 14px;
  line-height: 1;
  color: var(--text-muted);
  padding: 0;
}

.editor-appr-chip-rm:hover {
  color: var(--text-primary);
}

.editor-appr-empty {
  font-size: 13px;
  color: var(--text-muted);
}

.editor-appr-input {
  width: 100%;
  box-sizing: border-box;
}

.editor-appr-suggest {
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  margin-top: 4px;
  max-height: 180px;
  overflow: auto;
}

.editor-appr-suggest-item {
  display: block;
  width: 100%;
  text-align: left;
  border: 0;
  background: none;
  padding: 8px;
  cursor: pointer;
  font-size: 14px;
  border-bottom: 1px solid var(--border-light);
  color: var(--text-primary);
}

.editor-appr-suggest-item:hover {
  background: var(--bg-hover);
}

.editor-appr-suggest-sub {
  opacity: 0.6;
  font-size: 12px;
}

.editor-appr-actions {
  display: flex;
  gap: 10px;
  align-items: center;
  margin-top: 14px;
}

.editor-appr-msg {
  font-size: 12px;
  color: var(--text-muted);
}
`;
