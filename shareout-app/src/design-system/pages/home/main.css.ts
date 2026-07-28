/**
 * Home page styles — Main
 * @module design-system/pages/home/main
 */

/** CSS rules for: Main */
export const mainStyles = `/* ── Main ───────────────────────────────────────────── */
.main {
  min-width: 0;
  padding: var(--space-5) var(--space-8) var(--space-16);
  display: flex; flex-direction: column;
  gap: var(--space-8);
}
.view { min-width: 0; display: flex; flex-direction: column; gap: var(--space-5); }
.view[hidden] { display: none; }

`;
