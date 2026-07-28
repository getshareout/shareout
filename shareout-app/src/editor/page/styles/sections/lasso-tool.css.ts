/**
 * ShareOut Visual Editor styles — Lasso selection tool styles
 * @module editor/page/styles/sections/lasso-tool
 */

/** CSS for the lasso tool section of the visual editor. */
export const lassoToolCss = `

/* ==========================================================================
   12. LASSO TOOL
   ========================================================================== */
.lasso-overlay {
  position: fixed;
  inset: 0;
  z-index: 500;
  cursor: crosshair;
}

.lasso-overlay[hidden] {
  display: none;
}

#lasso-canvas {
  width: 100%;
  height: 100%;
}

.lasso-popup {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  background: var(--bg-panel);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  padding: 24px;
  width: 400px;
  max-width: 90vw;
  z-index: 510;
}

.lasso-popup[hidden] {
  display: none;
}

#lasso-preview {
  width: 100%;
  max-height: 200px;
  object-fit: contain;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-light);
  margin-bottom: 16px;
}

#lasso-prompt {
  width: 100%;
  padding: 14px 16px;
  border: 2px solid var(--border-light);
  border-radius: var(--radius-md);
  font-size: 14px;
  resize: vertical;
  min-height: 80px;
  outline: none;
  transition: border-color var(--duration-fast);
}

#lasso-prompt:focus {
  border-color: var(--primary);
}

.lasso-actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
}
`;
