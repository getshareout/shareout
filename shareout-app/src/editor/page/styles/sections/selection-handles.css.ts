/**
 * ShareOut Visual Editor styles — Selection box, handles, and drag-to-reorder affordances
 * @module editor/page/styles/sections/selection-handles
 */

/** CSS for the selection handles section of the visual editor. */
export const selectionHandlesCss = `

/* ==========================================================================
   11. SELECTION HANDLES
   ========================================================================== */
.selection-box {
  position: absolute;
  border: 3px solid var(--primary);
  background: rgba(37, 99, 235, 0.08);
  pointer-events: none;
  border-radius: 4px;
  box-shadow: 0 0 0 4px rgba(37, 99, 235, 0.15), 0 0 16px rgba(37, 99, 235, 0.25);
}

.selection-label {
  position: absolute;
  top: -22px;
  left: -2px;
  font-size: 11px;
  font-style: italic;
  font-weight: 500;
  color: var(--text-muted);
  background: var(--bg-panel);
  padding: 2px 6px;
  border-radius: 3px;
  white-space: nowrap;
  box-shadow: var(--shadow-sm);
  pointer-events: none;
}

.resize-handle {
  position: absolute;
  width: 10px;
  height: 10px;
  background: var(--bg-panel);
  border: 2px solid var(--primary);
  border-radius: 2px;
  pointer-events: auto;
}

.resize-handle.nw { top: -5px; left: -5px; cursor: nwse-resize; }
.resize-handle.n { top: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.resize-handle.ne { top: -5px; right: -5px; cursor: nesw-resize; }
.resize-handle.e { top: 50%; right: -5px; transform: translateY(-50%); cursor: ew-resize; }
.resize-handle.se { bottom: -5px; right: -5px; cursor: nwse-resize; }
.resize-handle.s { bottom: -5px; left: 50%; transform: translateX(-50%); cursor: ns-resize; }
.resize-handle.sw { bottom: -5px; left: -5px; cursor: nesw-resize; }
.resize-handle.w { top: 50%; left: -5px; transform: translateY(-50%); cursor: ew-resize; }

/* Drag-to-reorder handle (shown when parent is data-shareout-sortable) */
.drag-handle {
  position: absolute;
  top: -11px;
  left: 50%;
  transform: translateX(-50%);
  width: 26px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--primary);
  color: var(--text-inverse);
  border-radius: 6px;
  box-shadow: var(--shadow-md);
  cursor: grab;
  pointer-events: auto;
}

.drag-handle:active {
  cursor: grabbing;
}

/* Drop indicator line shown while reordering */
.drop-indicator {
  position: absolute;
  display: none;
  background: var(--primary);
  border-radius: 2px;
  box-shadow: 0 0 0 2px rgba(37, 99, 235, 0.25);
  pointer-events: none;
  z-index: 2;
}

.drop-indicator::before,
.drop-indicator::after {
  content: '';
  position: absolute;
  width: 7px;
  height: 7px;
  background: var(--primary);
  border-radius: 50%;
  top: 50%;
  transform: translateY(-50%);
}

.drop-indicator::before { left: -3px; }
.drop-indicator::after { right: -3px; }
`;
