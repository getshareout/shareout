/**
 * ShareOut Visual Editor styles — Inline style popover (glass)
 * @module editor/page/styles/sections/style-popover
 */

/** CSS for the style popover section of the visual editor. */
export const stylePopoverCss = `

/* ==========================================================================
   8. STYLE POPOVER (glass)
   ========================================================================== */
.style-popover {
  position: fixed;
  background: rgba(255, 255, 255, 0.92);
  backdrop-filter: blur(20px) saturate(180%);
  -webkit-backdrop-filter: blur(20px) saturate(180%);
  border-radius: 16px;
  border: 1px solid rgba(255, 255, 255, 0.6);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.1),
    inset 0 1px 0 rgba(255, 255, 255, 0.9);
  padding: 16px;
  width: 240px;
  z-index: 110;
  animation: floatIn var(--duration-normal) var(--ease-bounce);
}

.style-popover[hidden] {
  display: none;
}

.popover-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-secondary);
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 12px;
}

.popover-close {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 6px;
  color: var(--text-muted);
  transition: all var(--duration-fast);
}

.popover-close:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.popover-row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.popover-row label {
  font-size: 13px;
  color: var(--text-secondary);
  min-width: 70px;
}

.popover-row input[type="color"] {
  width: 36px;
  height: 36px;
  border: 2px solid var(--border-light);
  border-radius: var(--radius-sm);
  cursor: pointer;
  padding: 2px;
}

.popover-row input[type="range"] {
  flex: 1;
  height: 6px;
  border-radius: 3px;
  background: var(--border-light);
  appearance: none;
  cursor: pointer;
}

.popover-row input[type="range"]::-webkit-slider-thumb {
  appearance: none;
  width: 18px;
  height: 18px;
  background: var(--primary);
  border-radius: 50%;
  cursor: pointer;
}

.size-value {
  font-size: 12px;
  color: var(--text-muted);
  min-width: 36px;
  text-align: right;
}

.popover-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid var(--border-light);
}
`;
