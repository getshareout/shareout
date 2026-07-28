/**
 * ShareOut Visual Editor styles — Studio rail agent pane — share form, suggestions, welcome, lasso card
 * @module editor/page/styles/sections/studio-rail-agent
 */

/** CSS for the studio rail agent section of the visual editor. */
export const studioRailAgentCss = `
}

/* Share panel form */
.rail-form {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 4px 0;
}
.rail-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rail-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary);
}
.rail-form .rail-input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px 12px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: 13px;
  color: var(--text-primary);
}
.rail-form textarea.rail-input {
  resize: vertical;
  min-height: 56px;
}
.rail-link-row {
  display: flex;
  gap: 8px;
}
.rail-link-row .rail-input {
  flex: 1;
}
.rail-radio {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}

/* Proactive suggestion chips */
.rail-suggestions {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px 0 4px;
}

.rail-suggestions:empty {
  display: none;
}

.rail-suggestion {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 10px 14px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  transition: all var(--duration-fast);
}

.rail-suggestion:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.rail-suggestion-icon {
  color: var(--primary);
  flex-shrink: 0;
}

/* Persistent agent input strip */
.rail-input-bar {
  padding: 12px 16px;
  border-top: 1px solid var(--glass-border);
  flex-shrink: 0;
}

/* Lasso selection card (shown above the input after a lasso) */
.lasso-card {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 10px;
  margin-bottom: 10px;
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-sm);
}

.lasso-thumb {
  width: 72px;
  height: 54px;
  object-fit: cover;
  border-radius: 8px;
  border: 1px solid var(--border-light);
  flex-shrink: 0;
}

.lasso-card-body {
  flex: 1;
  min-width: 0;
}

.lasso-card-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-secondary);
  margin-bottom: 6px;
}

.lasso-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.lasso-pill {
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--primary);
  background: var(--primary-soft);
  padding: 2px 7px;
  border-radius: var(--radius-pill);
  white-space: nowrap;
}

.lasso-pill-more {
  color: var(--text-muted);
  background: var(--bg-hover);
}

.lasso-card-remove {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 7px;
  font-size: 16px;
  line-height: 1;
  color: var(--text-muted);
  transition: all var(--duration-fast);
}

.lasso-card-remove:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.chat-messages {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding-bottom: 16px;
}

/* Off-screen rows skip layout/paint — keeps long threads responsive. [14] */
.chat-messages > * {
  content-visibility: auto;
  contain-intrinsic-size: auto 48px;
}

/* Jump-to-latest pill — appears when the reader scrolls away mid-stream. [8,9] */
.chat-jump {
  position: absolute;
  right: 16px;
  bottom: 84px;
  z-index: 5;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 32px;
  padding: 0 12px;
  border-radius: 16px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  font-size: 12px;
  transition: color var(--duration-fast), border-color var(--duration-fast);
}

.chat-jump:hover {
  color: var(--primary);
  border-color: var(--primary);
}

.chat-jump[hidden] {
  display: none;
}

.chat-jump-count:empty {
  display: none;
}

/* Welcome State */
.chat-welcome {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 32px 20px;
  color: var(--text-secondary);
}

.welcome-icon {
  width: 56px;
  height: 56px;
  background: var(--primary-soft);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--primary);
  margin-bottom: 16px;
}

.welcome-text {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 6px;
}

.welcome-hint {
  font-size: 13px;
  color: var(--text-muted);
`;
