/**
 * ShareOut Visual Editor styles — Studio rail data pane, rich-text toolbar, chat, and agent plan
 * @module editor/page/styles/sections/studio-rail-data
 */

/** CSS for the studio rail data section of the visual editor. */
export const studioRailDataCss = `
}

/* Data pane — storage browser */
.data-section {
  margin-bottom: 18px;
}

.data-section-head {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.data-section-title {
  flex: 1;
  font-family: var(--font-display);
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}

.data-add {
  font-size: 12px;
  font-weight: 600;
  color: var(--primary);
  padding: 4px 8px;
  border-radius: var(--radius-sm);
  transition: background var(--duration-fast);
}

.data-add:hover {
  background: var(--primary-soft);
}

.data-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.data-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
}

.data-row-name {
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 120px;
}

.data-row-value {
  flex: 1;
  min-width: 0;
  padding: 5px 8px;
  border: 1px solid var(--border-light);
  border-radius: 8px;
  background: var(--bg-canvas);
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-secondary);
  outline: none;
}

.data-row-value:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.data-row-meta {
  flex: 1;
  font-size: 12px;
  color: var(--text-muted);
}

.data-row-btn {
  flex-shrink: 0;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-secondary);
  padding: 4px 8px;
  border-radius: 8px;
  transition: all var(--duration-fast);
}

.data-row-btn:hover {
  background: var(--primary-soft);
  color: var(--primary);
}

.data-row-btn-danger {
  font-size: 16px;
  line-height: 1;
}

.data-row-btn-danger:hover {
  background: var(--error-soft);
  color: var(--error);
}

.data-empty {
  font-size: 13px;
  color: var(--text-muted);
  padding: 8px 2px;
}

/* Inline rich-text toolbar */
.format-toolbar {
  position: fixed;
  z-index: 120;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: var(--glass-bg);
  backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(140%);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-md);
  box-shadow: var(--glass-shadow);
  animation: fadeIn var(--duration-normal) var(--ease-out);
}

.format-toolbar[hidden] {
  display: none;
}

.fmt-btn {
  min-width: 30px;
  height: 30px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 7px;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-secondary);
  transition: all var(--duration-fast);
}

.fmt-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

.fmt-btn.active {
  background: var(--primary);
  color: var(--text-inverse);
}

.fmt-sep {
  width: 1px;
  height: 18px;
  background: var(--glass-border);
  margin: 0 2px;
}

/* Chat Messages */
.chat-message {
  display: flex;
  flex-direction: column;
  max-width: 88%;
}

.chat-message-user {
  align-self: flex-end;
}

.chat-message-ai {
  align-self: flex-start;
}

.chat-message-content {
  padding: 11px 16px;
  font-size: 14px;
  line-height: 1.65;
  color: var(--color-text);
  word-break: break-word;
  overflow-wrap: anywhere;
}

.chat-message-user .chat-message-content {
  background: color-mix(in srgb, var(--color-primary) 14%, var(--color-bg-elevated));
  border-radius: 20px 20px 6px 20px;
  white-space: pre-wrap;
}

.chat-message-ai .chat-message-content {
  background: var(--color-bg-elevated);
  border-radius: 20px 20px 20px 6px;
  box-shadow: 0 1px 2px rgba(28, 25, 23, 0.05), 0 10px 28px -14px rgba(28, 25, 23, 0.22);
}

/* Agent plan — tool actions shown as plan→doing→done */
.agent-plan {
  list-style: none;
  margin: 8px 0 0;
  padding: 10px 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.agent-step {
  display: flex;
  align-items: center;
  gap: 9px;
  font-size: 13px;
  color: var(--text-secondary);
}

.agent-step-dot {
  flex-shrink: 0;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  border: 2px solid var(--border-strong);
  transition: all var(--duration-fast);
}

.agent-step.doing .agent-step-dot {
  border-color: var(--primary);
  border-right-color: transparent;
  animation: spin 0.7s linear infinite;
}

.agent-step.done {
  color: var(--text-primary);
}

.agent-step.done .agent-step-dot {
  border-color: var(--success);
  background: var(--success);
}

.agent-step.error .agent-step-dot {
  border-color: var(--error);
  background: var(--error);
}

.chat-message-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  margin-top: 8px;
}

.chat-message-actions button {
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--radius-sm);
}

.chat-action-result {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 500;
  border-radius: var(--radius-sm);
  animation: fadeIn 0.2s ease-out;
}

.chat-action-applied {
  color: var(--success);
  background: rgba(34, 197, 94, 0.1);
}

.chat-action-rejected {
  color: var(--text-secondary);
  background: var(--bg-hover);
}

.chat-action-warning {
  color: var(--warning);
  background: var(--warning-soft);
}

@keyframes fadeIn {
  from { opacity: 0; transform: translateY(-4px); }
  to { opacity: 1; transform: translateY(0); }
}

.chat-context-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 10px;
}

.chat-context-chips:empty {
  display: none;
}

.context-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: var(--primary-soft);
  color: var(--primary);
  border-radius: var(--radius-pill);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  user-select: none;
  transition: all var(--duration-fast) var(--ease-out);
}

.context-chip:hover {
  background: rgba(37, 99, 235, 0.18);
}

.context-chip:active {
  transform: scale(0.92);
  background: rgba(37, 99, 235, 0.25);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, 0.1);
}

.context-chip-remove {
  width: 16px;
  height: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  color: var(--primary);
  transition: background var(--duration-fast);
}

.context-chip-remove:hover {
  background: rgba(37, 99, 235, 0.2);
}

.chat-input-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 6px 6px 18px;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: 26px;
  box-shadow: 0 1px 2px rgba(28, 25, 23, 0.05), 0 12px 32px -16px rgba(28, 25, 23, 0.28);
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}

.chat-input-row:focus-within {
  border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary) 12%, transparent), 0 12px 32px -16px rgba(28, 25, 23, 0.28);
}

#chat-input {
  flex: 1;
  min-width: 0;
  padding: 7px 0;
  background: transparent;
  border: 0;
  font: 400 16px/1.45 var(--font-sans);
  color: var(--color-text);
  resize: none;
  max-height: 184px;
  outline: none;
  caret-color: var(--color-primary);
}

#chat-input::placeholder {
  color: var(--color-text-tertiary);
}

.chat-send {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: var(--color-surface);
  color: var(--color-text-tertiary);
  display: grid;
  place-items: center;
  flex-shrink: 0;
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast), transform 120ms;
}

#chat-input:not(:placeholder-shown) ~ .chat-send:not(:disabled) {
  background: var(--color-text);
  color: var(--color-bg-elevated);
}

#chat-input:not(:placeholder-shown) ~ .chat-send:not(:disabled):hover {
  background: var(--color-primary);
  color: var(--color-text-inverse);
}

.chat-send:active:not(:disabled) {
  transform: scale(0.94);
}

.chat-send:disabled {
  cursor: default;
}

.chat-send:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

/* Data pane — Sources (rail/sources-section.ts): what the published page reads */
.data-src-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.data-src {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-panel);
  transition: border-color var(--duration-fast);
}

.data-src:hover,
.data-src:focus-within {
  border-color: var(--primary);
}

.data-src:focus-visible {
  outline: 2px solid var(--color-primary);
  outline-offset: 2px;
}

.data-src-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.data-src-tag {
  margin-left: 4px;
  padding: 1px 6px;
  border-radius: var(--radius-pill);
  background: var(--bg-muted);
  color: var(--text-secondary);
  font-size: 11px;
  font-weight: 500;
}

.data-src-meta {
  font-size: 12px;
  color: var(--text-secondary);
  overflow-wrap: anywhere;
}

.data-src-stale {
  width: fit-content;
  padding: 1px 8px;
  border-radius: var(--radius-pill);
  background: var(--warning-soft);
  color: var(--text-primary);
  font-size: 11px;
  font-weight: 500;
}

.data-src-feeds summary,
.data-src-more summary {
  font-size: 12px;
  color: var(--text-secondary);
  cursor: pointer;
}

.data-src-more summary {
  color: var(--primary);
  font-weight: 500;
}

.data-src-feeds ul {
  margin: 4px 0 0;
  padding: 0;
  list-style: none;
}

.data-src-feed {
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--text-primary);
}

.data-src-feed:hover {
  background: var(--primary-soft);
  color: var(--primary);
}

.data-src-more pre {
  max-height: 160px;
  margin: 6px 0;
  padding: 8px;
  overflow: auto;
  border-radius: 8px;
  background: var(--bg-muted);
  font: 11px/1.5 var(--font-mono);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.data-src-more dl {
  display: grid;
  grid-template-columns: auto 1fr;
  gap: 2px 8px;
  margin: 6px 0 0;
  font-size: 12px;
}

.data-src-more dt {
  font-weight: 600;
  color: var(--text-secondary);
}

.data-src-more dd {
  margin: 0;
  color: var(--text-primary);
  overflow-wrap: anywhere;
}

.data-src-links {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 12px;
  margin-top: 6px;
  font-size: 12px;
}

.data-src-links a {
  color: var(--primary);
  font-weight: 500;
}

.data-src-note {
  margin: 6px 0 0;
  font-size: 11px;
  color: var(--text-secondary);
}
`;
