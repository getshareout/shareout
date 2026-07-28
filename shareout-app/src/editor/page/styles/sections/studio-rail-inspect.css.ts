/**
 * ShareOut Visual Editor styles — Studio rail inspect pane — property controls and SDK editors
 * @module editor/page/styles/sections/studio-rail-inspect
 */

/** CSS for the studio rail inspect section of the visual editor. */
export const studioRailInspectCss = `

/* Inspect pane — property panel */
.inspect-actions {
  display: flex;
  gap: 6px;
  margin-bottom: 12px;
}

.inspect-action {
  flex: 1;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--border-light);
  background: var(--bg-panel);
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  transition: all var(--duration-fast);
}

.inspect-action:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
  color: var(--text-primary);
}

.inspect-action-danger:hover {
  border-color: var(--error);
  background: var(--error-soft);
  color: var(--error);
}

.property-group {
  background: var(--bg-panel);
  border: 1px solid var(--border-light);
  border-radius: var(--radius-md);
  padding: 14px;
  margin-bottom: 12px;
}

.property-group-title {
  font-family: var(--font-display);
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.4px;
  color: var(--text-muted);
  margin-bottom: 10px;
}

.property-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.property-row:last-child {
  margin-bottom: 0;
}

.property-label {
  flex: 0 0 64px;
  font-size: 13px;
  color: var(--text-secondary);
}

.property-input {
  flex: 1;
  min-width: 0;
  padding: 7px 10px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-canvas);
  font-size: 13px;
  color: var(--text-primary);
  outline: none;
  transition: border-color var(--duration-fast), box-shadow var(--duration-fast);
}

.property-input:focus {
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-soft);
}

.color-swatch {
  flex: 0 0 32px;
  width: 32px;
  height: 32px;
  padding: 2px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  cursor: pointer;
  background: var(--bg-canvas);
}

.empty-state {
  text-align: center;
  padding: 40px 20px;
  color: var(--text-muted);
  font-size: 14px;
}

/* Humanized inspect controls */
.control-row {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 10px;
}

.control-row:last-child {
  margin-bottom: 0;
}

.control-row-stack {
  align-items: flex-start;
}

.control-label {
  flex: 0 0 56px;
  font-size: 13px;
  color: var(--text-secondary);
  padding-top: 2px;
}

.control-slider {
  flex: 1;
  height: 4px;
  border-radius: 2px;
  background: var(--border-light);
  appearance: none;
  -webkit-appearance: none;
  cursor: pointer;
}

.control-slider::-webkit-slider-thumb {
  appearance: none;
  -webkit-appearance: none;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--primary);
  box-shadow: 0 1px 3px rgba(0,0,0,0.2);
}

.control-readout {
  flex: 0 0 38px;
  text-align: right;
  font-size: 12px;
  font-family: var(--font-mono);
  color: var(--text-muted);
}

/* Segmented control (alignment) */
.seg {
  display: flex;
  gap: 2px;
  padding: 2px;
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
}

.seg-btn {
  width: 32px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 14px;
  color: var(--text-secondary);
  transition: all var(--duration-fast);
}

.seg-btn:hover {
  color: var(--text-primary);
}

.seg-btn.active {
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

/* Color swatches */
.swatch-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  flex: 1;
}

.swatch {
  width: 24px;
  height: 24px;
  border-radius: 7px;
  border: 1px solid var(--border-light);
  cursor: pointer;
  transition: transform var(--duration-fast);
  position: relative;
}

.swatch:hover {
  transform: scale(1.12);
}

.swatch.active {
  box-shadow: 0 0 0 2px var(--bg-panel), 0 0 0 4px var(--primary);
}

.swatch-transparent {
  background: repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 8px 8px;
}

.swatch-custom {
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: conic-gradient(red, yellow, lime, aqua, blue, magenta, red);
}

.swatch-custom input[type="color"] {
  width: 200%;
  height: 200%;
  border: none;
  padding: 0;
  cursor: pointer;
  opacity: 0;
}

/* Stepper */
.stepper {
  display: flex;
  align-items: center;
  gap: 2px;
  background: var(--bg-hover);
  border-radius: var(--radius-sm);
  padding: 2px;
}

.stepper-btn {
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 8px;
  font-size: 16px;
  color: var(--text-secondary);
  transition: all var(--duration-fast);
}

.stepper-btn:hover {
  background: var(--bg-panel);
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
}

.stepper-val {
  min-width: 32px;
  text-align: center;
  font-size: 13px;
  font-family: var(--font-mono);
  color: var(--text-primary);
}

/* Bound element callout */
.property-group-bound {
  background: var(--success-soft);
  border-color: transparent;
}

.property-group-bound .property-group-title {
  color: var(--success);
}

.bound-value {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-panel);
  padding: 3px 8px;
  border-radius: 6px;
}

.bound-note {
  font-size: 12px;
  color: var(--text-secondary);
  margin-top: 6px;
}

/* Advanced fold */
.property-advanced {
  margin-bottom: 12px;
}

.property-advanced > summary {
  font-size: 12px;
  font-weight: 600;
  color: var(--text-muted);
  cursor: pointer;
  padding: 6px 2px;
  list-style: none;
  user-select: none;
}

.property-advanced > summary::-webkit-details-marker {
  display: none;
}

.property-advanced > summary::before {
  content: '▸ ';
}

.property-advanced[open] > summary::before {
  content: '▾ ';
}

/* SDK components inside Inspect */
.sdk-editors-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.sdk-editor-btn {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  text-align: left;
  padding: 10px 12px;
  border: 1px solid var(--border-light);
  border-radius: var(--radius-sm);
  background: var(--bg-canvas);
  font-size: 13px;
  font-weight: 500;
  color: var(--text-primary);
  transition: all var(--duration-fast);
}

.sdk-editor-btn:hover {
  border-color: var(--primary);
  background: var(--primary-soft);
}

.sdk-icon {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--primary);
}

.chart-binding-fields.is-hidden,
.chart-data-btn.is-hidden,
.chart-categories.is-hidden {
  display: none !important;
}

.chart-data-btn {
  display: flex;
}

.chart-add-series-btn {
  margin-top: 8px;
}

.chart-categories {
  margin-top: 16px;
}
`;
