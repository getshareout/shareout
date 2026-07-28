// ShareOut Design Tokens
const PRIMARY = '#2563eb';
const PRIMARY_HOVER = '#1d4ed8';
const PRIMARY_LIGHT = 'rgba(37, 99, 235, 0.15)';
const PRIMARY_GLOW = 'rgba(37, 99, 235, 0.25)';

// Custom select cursor SVG (pointer with selection box indicator)
const SELECT_CURSOR_SVG = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <path d="M4 4L4 18L8 14L11 20L13 19L10 13L15 13L4 4Z" fill="black" stroke="white" stroke-width="1.5"/>
  <rect x="15" y="15" width="6" height="6" rx="1" fill="none" stroke="${PRIMARY}" stroke-width="1.5" stroke-dasharray="2 1"/>
</svg>`)}`;

// Crosshair cursor for lasso tool
const LASSO_CURSOR_SVG = `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none">
  <circle cx="12" cy="12" r="8" fill="none" stroke="${PRIMARY}" stroke-width="1.5" stroke-dasharray="3 2"/>
  <line x1="12" y1="2" x2="12" y2="6" stroke="${PRIMARY}" stroke-width="1.5"/>
  <line x1="12" y1="18" x2="12" y2="22" stroke="${PRIMARY}" stroke-width="1.5"/>
  <line x1="2" y1="12" x2="6" y2="12" stroke="${PRIMARY}" stroke-width="1.5"/>
  <line x1="18" y1="12" x2="22" y2="12" stroke="${PRIMARY}" stroke-width="1.5"/>
  <circle cx="12" cy="12" r="2" fill="${PRIMARY}"/>
</svg>`)}`;

export const CANVAS_EDITOR_STYLE = `
  [data-editor-hover] {
    outline: 3px dashed ${PRIMARY} !important;
    outline-offset: 2px;
    box-shadow: 0 0 0 6px ${PRIMARY_LIGHT} !important;
  }
  * {
    cursor: url('${SELECT_CURSOR_SVG}') 4 4, default !important;
    caret-color: ${PRIMARY} !important;
  }
  input, textarea, [contenteditable="true"], [contenteditable=""] {
    caret-color: ${PRIMARY} !important;
    caret-width: 3px;
  }
  @supports (caret-shape: bar) {
    input, textarea, [contenteditable="true"], [contenteditable=""] {
      caret-shape: bar;
    }
  }
  [data-editor-selected] {
    outline: 3px solid ${PRIMARY} !important;
    outline-offset: 2px;
    box-shadow: 0 0 0 6px ${PRIMARY_GLOW}, 0 0 12px ${PRIMARY_LIGHT} !important;
    cursor: move !important;
  }
  /* Visual indicator for links - shows they're in edit mode */
  a[href] {
    position: relative;
  }
  a[href]::after {
    content: '⚡';
    position: absolute;
    top: -10px;
    right: -10px;
    font-size: 11px;
    background: ${PRIMARY};
    color: white;
    border-radius: 50%;
    width: 20px;
    height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: opacity 0.15s;
    pointer-events: none;
  }
  a[href]:hover::after {
    opacity: 1;
  }
  /* Visual indicator for data-bound elements (including data-shareout-binding) */
  [data-shareout-binding], [data-key], [data-json-key], [data-field], [data-sdk-value], [data-bind], .summary-value {
    position: relative;
    cursor: pointer !important;
  }
  /* Variable badge indicator - solid color, no gradient */
  [data-shareout-binding]::before, [data-key]::before, [data-json-key]::before, [data-field]::before, [data-sdk-value]::before, [data-bind]::before, .summary-value::before {
    content: 'ƒx';
    position: absolute;
    top: -14px;
    right: -14px;
    font-size: 11px;
    font-weight: 600;
    font-family: 'JetBrains Mono', 'SF Mono', monospace;
    background: ${PRIMARY};
    color: white;
    border-radius: 8px;
    padding: 3px 8px;
    display: flex;
    align-items: center;
    justify-content: center;
    opacity: 0;
    transition: all 0.15s cubic-bezier(0, 0, 0.2, 1);
    pointer-events: none;
    box-shadow: 0 2px 8px ${PRIMARY_GLOW};
    z-index: 1000;
    transform: scale(0.9);
  }
  [data-shareout-binding]:hover::before, [data-key]:hover::before, [data-json-key]:hover::before, [data-field]:hover::before, [data-sdk-value]:hover::before, [data-bind]:hover::before, .summary-value:hover::before {
    opacity: 1;
    transform: scale(1);
  }
  /* Bound element selection style */
  [data-shareout-binding][data-editor-hover], [data-key][data-editor-hover], [data-json-key][data-editor-hover], [data-field][data-editor-hover], [data-sdk-value][data-editor-hover], [data-bind][data-editor-hover], .summary-value[data-editor-hover] {
    outline-color: ${PRIMARY} !important;
    box-shadow: 0 0 0 6px ${PRIMARY_LIGHT}, 0 0 12px ${PRIMARY_GLOW} !important;
  }
  [data-shareout-binding][data-editor-hover]::before, [data-key][data-editor-hover]::before, [data-json-key][data-editor-hover]::before, [data-field][data-editor-hover]::before, [data-sdk-value][data-editor-hover]::before, [data-bind][data-editor-hover]::before, .summary-value[data-editor-hover]::before {
    opacity: 1;
    transform: scale(1);
  }
  /* Selected bound element */
  [data-shareout-binding][data-editor-selected], [data-key][data-editor-selected], [data-json-key][data-editor-selected], [data-field][data-editor-selected], [data-sdk-value][data-editor-selected], [data-bind][data-editor-selected], .summary-value[data-editor-selected] {
    outline-color: ${PRIMARY} !important;
    cursor: pointer !important;
  }
  [data-shareout-binding][data-editor-selected]::before, [data-key][data-editor-selected]::before, [data-json-key][data-editor-selected]::before, [data-field][data-editor-selected]::before, [data-sdk-value][data-editor-selected]::before, [data-bind][data-editor-selected]::before, .summary-value[data-editor-selected]::before {
    opacity: 1;
    transform: scale(1);
  }
`;

export const CANVAS_LASSO_STYLE = `
  * {
    cursor: url('${LASSO_CURSOR_SVG}') 12 12, crosshair !important;
    user-select: none !important;
    -webkit-user-select: none !important;
  }
`;

export function injectCanvasEditorStyles(doc: Document): void {
  if (!doc.head) return;
  const style = doc.createElement('style');
  style.setAttribute('data-shareout-editor', 'true');
  style.textContent = CANVAS_EDITOR_STYLE;
  doc.head.appendChild(style);
}

export function setCanvasToolCursor(doc: Document, tool: 'select' | 'lasso'): void {
  if (!doc.head) return;
  let style = doc.querySelector('style[data-shareout-tool-cursor]') as HTMLStyleElement;
  if (!style) {
    style = doc.createElement('style');
    style.setAttribute('data-shareout-tool-cursor', 'true');
    doc.head.appendChild(style);
  }
  style.textContent = tool === 'lasso' ? CANVAS_LASSO_STYLE : '';
}
