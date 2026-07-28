/**
 * ShareOut Visual Editor styles — Floating glass topbar, version indicator, collaborators, and action buttons
 * @module editor/page/styles/sections/topbar
 */

/** CSS for the topbar section of the visual editor. */
export const topbarCss = `

/* ==========================================================================
   3. TOPBAR - Floating glass pill
   ========================================================================== */
.editor-topbar {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  height: 52px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-radius: 26px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.08),
    0 1px 4px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 8px 0 12px;
  z-index: 200;
  gap: 12px;
  transition: transform var(--duration-slow) var(--ease-out), opacity var(--duration-slow) var(--ease-out);
}

/* Auto-hidden while scrolling/working — reveals when the pointer nears the top */
.editor-topbar--hidden {
  transform: translate(-50%, calc(-100% - 24px));
  opacity: 0;
  pointer-events: none;
}

.topbar-left {
  display: flex;
  align-items: center;
  gap: 2px;
}

.topbar-center {
  display: flex;
  align-items: center;
  gap: 8px;
}

.topbar-right {
  display: flex;
  align-items: center;
  gap: 6px;
}

.toolbar-btn {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--text-secondary);
  transition: all var(--duration-fast);
}

.toolbar-btn:hover {
  background: rgba(0, 0, 0, 0.06);
  color: var(--text-primary);
}

/* Instant hover label (words-first, replaces native title tooltips) */
.toolbar-btn[data-label] { position: relative; }

.toolbar-btn[data-label]:hover::after {
  content: attr(data-label);
  position: absolute;
  top: calc(100% + 8px);
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

.toolbar-btn.active {
  background: var(--primary);
  color: white;
}

.toolbar-btn.fav-btn.active {
  background: transparent;
  color: #f59e0b;
}

.toolbar-btn.fav-btn.active svg {
  fill: #f59e0b;
}

.toolbar-btn.fav-btn.active:hover {
  background: rgba(245, 158, 11, 0.12);
  color: #f59e0b;
}

.toolbar-divider {
  width: 1px;
  height: 20px;
  background: rgba(0, 0, 0, 0.1);
  margin: 0 4px;
}

#btn-viewport[data-viewport="mobile"] {
  background: var(--primary-soft);
  color: var(--primary);
}

#btn-viewport .viewport-icon-mobile,
#btn-viewport .viewport-icon-desktop {
  display: none;
}

#btn-viewport[data-viewport="desktop"] .viewport-icon-mobile {
  display: block;
}

#btn-viewport[data-viewport="mobile"] .viewport-icon-desktop {
  display: block;
}

.artifact-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary);
  padding: 4px 8px;
  border-radius: 8px;
  outline: none;
  min-width: 40px;
  max-width: 160px;
  border: 2px solid transparent;
  background: transparent;
  transition: border-color var(--duration-fast), background var(--duration-fast);
}

.artifact-name:hover {
  background: rgba(0, 0, 0, 0.04);
}

.artifact-name:focus {
  background: rgba(255, 255, 255, 0.9);
  border-color: var(--primary);
}

.save-status {
  font-size: 11px;
  color: var(--text-muted);
  padding: 2px 6px;
  border-radius: var(--radius-pill);
  background: rgba(0, 0, 0, 0.04);
}

.save-status.saving {
  color: var(--warning);
  background: var(--warning-soft);
}

.save-status.saved {
  color: var(--success);
  background: var(--success-soft);
}

.save-status.error {
  color: var(--error);
  background: var(--error-soft);
}

/* Version Indicator */
.version-indicator {
  font-size: 11px;
  color: var(--text-muted);
  padding: 2px 8px;
  border-radius: var(--radius-pill);
  background: rgba(0, 0, 0, 0.04);
  cursor: pointer;
  transition: background var(--duration-fast), color var(--duration-fast);
}

.version-indicator:hover {
  background: rgba(0, 0, 0, 0.08);
  color: var(--text-secondary);
}

.version-indicator:empty {
  display: none;
}

/* Collaborators */
.collaborators {
  display: flex;
  align-items: center;
  margin-right: 8px;
}

.collaborator-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 2px solid var(--bg-panel);
  margin-left: -8px;
  font-size: 12px;
  font-weight: 600;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
}

.collaborator-avatar:first-child {
  margin-left: 0;
}

/* Menu Button */
.btn-menu {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--radius-md);
  color: var(--text-secondary);
  transition: background var(--duration-fast), color var(--duration-fast);
}

.btn-menu:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

/* Publish CTA — compact on narrow viewports (see responsive.css.ts) */
.topbar-right .so-c-btn--primary {
  min-height: 36px;
  font-size: 13px;
}

/* Implicit validation chip — hidden when all checks pass, surfaces only on a real problem */
.validity-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 9px;
  border-radius: var(--radius-pill);
  font-size: 11px;
  font-weight: 600;
  cursor: pointer;
  transition: all var(--duration-fast);
}

.validity-chip[hidden] {
  display: none;
}

.validity-chip svg {
  width: 13px;
  height: 13px;
  flex-shrink: 0;
}

.validity-chip[data-state="warning"] {
  color: var(--warning);
  background: var(--warning-soft);
}

.validity-chip[data-state="error"] {
  color: var(--error);
  background: var(--error-soft);
}

.validity-chip:hover {
  filter: brightness(0.97);
}

/* ==========================================================================
   3b. CANVAS TOOLS — floating glass pill, bottom-center (select · lasso · undo/redo · viewport)
   ========================================================================== */
.canvas-tools {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  height: 48px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  background: rgba(255, 255, 255, 0.85);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border-radius: 24px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow:
    0 4px 24px rgba(0, 0, 0, 0.10),
    0 1px 4px rgba(0, 0, 0, 0.04),
    inset 0 1px 0 rgba(255, 255, 255, 0.8);
  z-index: 60;
  transition: transform var(--duration-slow) var(--ease-out), opacity var(--duration-slow) var(--ease-out);
}

/* Tools sit at the bottom — flip their hover labels to appear above */
.canvas-tools .toolbar-btn[data-label]:hover::after {
  top: auto;
  bottom: calc(100% + 8px);
}
`;
