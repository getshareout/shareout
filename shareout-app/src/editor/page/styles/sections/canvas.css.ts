/**
 * ShareOut Visual Editor styles — Full-viewport canvas and device-frame preview modes
 * @module editor/page/styles/sections/canvas
 */

/** CSS for the canvas section of the visual editor. */
export const canvasCss = `

/* ==========================================================================
   5. CANVAS - Full viewport
   ========================================================================== */
.editor-canvas {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--bg-canvas);
  overflow: hidden;
}

.canvas-scroll {
  width: 100%;
  height: 100%;
  overflow: hidden;
  display: flex;
  justify-content: center;
  padding: 0;
}

/* Full-bleed live canvas — the page as it will publish, edge to edge */
.canvas {
  position: relative;
  background: var(--bg-panel);
  width: 100%;
  height: 100%;
  max-width: none;
  overflow: hidden;
  transition: max-width var(--duration-slow) var(--ease-out);
}

/* Device-frame toggle keeps the centered, shadowed "phone" preview */
.canvas.canvas-mobile {
  max-width: 375px;
  margin: 24px auto;
  height: calc(100% - 48px);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-lg), 0 0 0 1px var(--border-light);
}

#canvas-frame {
  width: 100%;
  height: 100%;
  border: none;
  background: white;
  transition: opacity 0.3s ease-out;
}

.canvas.canvas-mobile #canvas-frame {
  border-radius: var(--radius-lg);
}

.selection-overlay,
.cursor-overlay {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
}

.canvas-loading {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  transition: opacity 0.3s ease-out;
}

.canvas-loading.hidden {
  opacity: 0;
  pointer-events: none;
}

.canvas-loading-spinner {
  width: 40px;
  height: 40px;
  border: 4px solid #e5e7eb;
  border-top-color: #2563eb;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
`;
