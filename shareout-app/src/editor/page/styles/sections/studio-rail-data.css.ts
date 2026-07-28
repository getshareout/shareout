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
  max-width: 85%;
}

.chat-message-user {
  align-self: flex-end;
}

.chat-message-ai {
  align-self: flex-start;
}

.chat-message-content {
  padding: 12px 16px;
  border-radius: var(--radius-lg);
  font-size: 14px;
  line-height: 1.5;
}

.chat-message-user .chat-message-content {
  background: var(--primary);
  color: var(--text-inverse);
  border-bottom-right-radius: 4px;
}

.chat-message-ai .chat-message-content {
  background: var(--bg-muted);
  color: var(--text-primary);
  border-bottom-left-radius: 4px;
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
}

#chat-input {
  flex: 1;
  padding: 14px 20px;
  background: rgba(0, 0, 0, 0.04);
  border: 2px solid rgba(0, 0, 0, 0.08);
  border-radius: 24px;
  font-size: 16px;
  line-height: 1.4;
  resize: none;
  max-height: 120px;
  outline: none;
  transition: all var(--duration-fast);
  caret-color: var(--primary);
}

#chat-input:focus {
  background: #ffffff;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft), 0 2px 8px rgba(0, 0, 0, 0.08);
}

#chat-input::placeholder {
  color: var(--text-muted);
}

.chat-send {
  width: 48px;
  height: 48px;
  background: var(--primary);
  border-radius: 50%;
  color: var(--text-inverse);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all var(--duration-fast);
  box-shadow: 0 4px 12px rgba(37, 99, 235, 0.3);
}

.chat-send:hover {
  background: var(--primary-hover);
  transform: scale(1.08);
  box-shadow: 0 6px 16px rgba(37, 99, 235, 0.4);
}

.chat-send:active {
  transform: scale(0.95);
}

.chat-send:disabled {
  background: var(--border-medium);
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}
`;
