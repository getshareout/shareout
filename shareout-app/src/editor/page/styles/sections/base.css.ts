/**
 * ShareOut Visual Editor styles — Reset and base element styles for the editor shell
 * @module editor/page/styles/sections/base
 */

/** CSS for the base section of the visual editor. */
export const baseCss = `

/* ==========================================================================
   2. RESET & BASE
   ========================================================================== */
*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body {
  height: 100%;
  overflow: hidden;
  background: var(--bg-canvas);
  font-family: var(--font-sans);
  font-size: 15px;
  line-height: 1.5;
  color: var(--text-primary);
  -webkit-font-smoothing: antialiased;
}

button {
  font-family: inherit;
  cursor: pointer;
  border: none;
  background: none;
}

input, textarea {
  font-family: inherit;
  font-size: inherit;
}
`;
