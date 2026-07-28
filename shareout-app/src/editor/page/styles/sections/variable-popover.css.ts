/**
 * ShareOut Visual Editor styles — Variable info popover
 * @module editor/page/styles/sections/variable-popover
 */

/** CSS for the variable popover section of the visual editor. */
export const variablePopoverCss = `

/* ==========================================================================
   15. VARIABLE INFO POPOVER
   ========================================================================== */
.variable-popover {
  background: var(--bg-panel);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-radius: 12px;
  border: 1px solid var(--border-light);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  overflow: hidden;
  animation: variablePopoverIn 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

@keyframes variablePopoverIn {
  from {
    opacity: 0;
    transform: translateY(8px) scale(0.96);
  }
  to {
    opacity: 1;
    transform: translateY(0) scale(1);
  }
}

.variable-popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
  background: var(--bg-hover);
}

.variable-popover-type {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 20px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.5px;
}

.variable-type-icon {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 700;
}

.variable-popover-close {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  color: var(--text-muted);
  transition: all 0.15s;
}

.variable-popover-close:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.variable-popover-content {
  padding: 16px;
}

.variable-popover-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
}

.variable-popover-description {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 16px;
  line-height: 1.4;
}

.variable-popover-sources {
  margin-bottom: 16px;
}

.variable-source-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border-radius: 8px;
  border: 1px solid;
  margin: 4px 4px 0 0;
  font-size: 12px;
}

.source-icon {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-weight: 700;
  font-size: 11px;
}

.source-name {
  font-weight: 600;
  color: var(--text-primary);
}

.source-type {
  font-size: 10px;
  color: var(--text-muted);
  text-transform: uppercase;
}

.variable-popover-raw {
  background: rgba(0, 0, 0, 0.04);
  border-radius: 8px;
  padding: 8px 12px;
  overflow-x: auto;
  margin-top: 8px;
}

.variable-popover-raw code {
  font-family: 'SF Mono', 'Monaco', 'Consolas', monospace;
  font-size: 11px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.variable-popover-footer {
  padding: 10px 16px;
  background: rgba(0, 0, 0, 0.02);
  border-top: 1px solid rgba(0, 0, 0, 0.04);
}

.variable-popover-hint {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-muted);
}

.variable-popover-hint svg {
  flex-shrink: 0;
  opacity: 0.6;
}

.variable-popover-action {
  width: 100%;
  justify-content: center;
  gap: 6px;
  background: var(--popover-accent, var(--primary));
  border-color: var(--popover-accent, var(--primary));
}

.variable-popover-action-icon {
  font-size: 16px;
  line-height: 1;
}

.variable-popover-warning {
  background: var(--color-warning-light);
  border: 1px solid color-mix(in srgb, var(--color-warning) 35%, transparent);
  border-radius: 6px;
  padding: 8px 12px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}

.variable-popover-warning svg {
  flex-shrink: 0;
  stroke: var(--color-warning);
}

.variable-popover-warning-text {
  color: color-mix(in srgb, var(--color-warning) 80%, var(--color-text));
  font-size: 13px;
  font-weight: 500;
}

.variable-popover-lead {
  font-weight: 600;
  margin-bottom: 4px;
}

.variable-popover-sources-label {
  font-size: 11px;
  text-transform: uppercase;
  color: var(--text-muted);
  margin-bottom: 6px;
}

.variable-source-chip {
  border-radius: 6px;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 1px solid var(--border-light);
  background: var(--bg-hover);
}

.variable-source-chip[data-source-type="table"] {
  border-color: color-mix(in srgb, var(--success) 35%, transparent);
  background: color-mix(in srgb, var(--success) 8%, var(--bg-panel));
}

.variable-source-chip[data-source-type="json"] {
  border-color: color-mix(in srgb, var(--primary) 35%, transparent);
  background: color-mix(in srgb, var(--primary) 8%, var(--bg-panel));
}

.source-icon {
  font-size: 18px;
}

.source-name {
  font-weight: 600;
  color: var(--text-primary);
}

.source-type {
  font-size: 11px;
  color: var(--text-muted);
}

.variable-popover-details {
  margin-top: 12px;
}

.variable-popover-details summary {
  font-size: 11px;
  color: var(--text-muted);
  cursor: pointer;
}

.variable-popover-type[data-type="json"] {
  background: color-mix(in srgb, var(--primary) 12%, transparent);
  color: var(--primary);
}

.variable-popover-type[data-type="table"] {
  background: color-mix(in srgb, var(--success) 12%, transparent);
  color: var(--success);
}

.variable-popover-type[data-type="computed"] {
  background: color-mix(in srgb, var(--primary-hover) 12%, transparent);
  color: var(--primary-hover);
}

.variable-popover-type[data-type="multi"] {
  background: color-mix(in srgb, var(--warning) 12%, transparent);
  color: var(--warning);
}

.variable-popover-type[data-type="legacy"],
.variable-popover-type[data-type="default"] {
  background: color-mix(in srgb, var(--text-muted) 12%, transparent);
  color: var(--text-secondary);
}

/* Dark mode support */
[data-theme="dark"] .variable-popover {
  background: var(--bg-panel);
  border-color: var(--border-light);
}

[data-theme="dark"] .variable-popover-header {
  background: var(--bg-hover);
}

[data-theme="dark"] .variable-popover-raw {
  background: rgba(255, 255, 255, 0.04);
}

[data-theme="dark"] .variable-popover-footer {
  background: rgba(255, 255, 255, 0.02);
}
`;
