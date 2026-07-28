/**
 * ShareOut Visual Editor styles — Validation panel — success state, issues, and dark mode
 * @module editor/page/styles/sections/validation-panel
 */

/** CSS for the validation panel section of the visual editor. */
export const validationPanelCss = `

/* ==========================================================================
   17. VALIDATION PANEL
   ========================================================================== */

/* Success state */
.validation-success {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 48px 24px;
}

.validation-success .success-icon {
  font-size: 48px;
  margin-bottom: 16px;
}

.validation-success .success-message {
  font-size: 16px;
  font-weight: 600;
  color: var(--success);
  margin-bottom: 4px;
}

/* Validation summary */
.validation-summary {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 0;
  border-bottom: 1px solid var(--border-light);
  margin-bottom: 16px;
}

.summary-badge {
  display: inline-flex;
  align-items: center;
  padding: 4px 10px;
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 600;
}

.badge-error {
  background: var(--error-soft);
  color: var(--error);
}

.badge-warning {
  background: var(--warning-soft);
  color: var(--warning);
}

.badge-info {
  background: var(--primary-soft);
  color: var(--primary);
}

/* Issue sections */
.issue-section {
  margin-bottom: 20px;
}

.issue-section .drawer-section-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

/* Issue items */
.issue-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.issue-item {
  padding: 12px;
  border-radius: var(--radius-md);
  border-left: 3px solid transparent;
  background: var(--bg-hover);
  transition: background var(--duration-fast);
}

.issue-item:hover {
  background: var(--bg-active);
}

.issue-item-error {
  border-left-color: var(--error);
  background: rgba(220, 38, 38, 0.05);
}

.issue-item-error:hover {
  background: rgba(220, 38, 38, 0.1);
}

.issue-item-warning {
  border-left-color: var(--warning);
  background: rgba(202, 138, 4, 0.05);
}

.issue-item-warning:hover {
  background: rgba(202, 138, 4, 0.1);
}

.issue-item-info {
  border-left-color: var(--primary);
  background: rgba(37, 99, 235, 0.05);
}

.issue-item-info:hover {
  background: rgba(37, 99, 235, 0.1);
}

.issue-header {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 6px;
}

.issue-category-icon {
  flex-shrink: 0;
  font-size: 14px;
}

.issue-message {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  line-height: 1.4;
}

.issue-suggestion {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  margin-bottom: 8px;
  padding-left: 22px;
}

.suggestion-label {
  font-weight: 600;
  color: var(--success);
  flex-shrink: 0;
}

.suggestion-text {
  line-height: 1.4;
}

.issue-locate-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  font-size: 11px;
  font-weight: 500;
  color: var(--primary);
  background: var(--primary-soft);
  border-radius: var(--radius-sm);
  margin-left: 22px;
  transition: all var(--duration-fast);
}

.issue-locate-btn:hover {
  background: var(--primary);
  color: var(--text-inverse);
}

/* Validation panel wrapper */
.validation-panel {
  display: flex;
  flex-direction: column;
}

/* Dark mode */
[data-theme="dark"] .issue-item-error {
  background: rgba(220, 38, 38, 0.1);
}

[data-theme="dark"] .issue-item-error:hover {
  background: rgba(220, 38, 38, 0.15);
}

[data-theme="dark"] .issue-item-warning {
  background: rgba(202, 138, 4, 0.1);
}

[data-theme="dark"] .issue-item-warning:hover {
  background: rgba(202, 138, 4, 0.15);
}

[data-theme="dark"] .issue-item-info {
  background: rgba(37, 99, 235, 0.1);
}

[data-theme="dark"] .issue-item-info:hover {
  background: rgba(37, 99, 235, 0.15);
}
`;
