/**
 * Home page styles — Card selection
 * @module design-system/pages/home/card-selection
 */

/** CSS rules for: Card selection */
export const cardSelectionStyles = `/* ── Card selection ─────────────────────────────────── */
.card-select {
  position: absolute; top: 10px; left: 10px; z-index: 3;
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border: 2px solid var(--color-border-strong);
  border-radius: 7px;
  background: rgba(255, 255, 255, 0.92);
  color: transparent;
  cursor: pointer;
  opacity: 0;
  transition: opacity var(--duration-fast), background var(--duration-fast), border-color var(--duration-fast);
}
.card-select svg { width: 14px; height: 14px; }
.artifact-card:hover .card-select,
body.selecting .card-select { opacity: 1; }
.artifact-card.is-selected .card-select {
  opacity: 1;
  background: var(--color-primary);
  border-color: var(--color-primary);
  color: var(--color-text-inverse);
}
.artifact-card.is-selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 2px var(--color-primary), var(--shadow-md);
}
.type-chip { transition: opacity var(--duration-fast); }
.artifact-card:hover .type-chip,
body.selecting .type-chip,
.artifact-card.is-selected .type-chip { opacity: 0; }
.browser[data-view="list"] .card-select { position: static; opacity: 1; order: -1; }
.browser[data-view="list"] .type-chip { display: none; }
@media (max-width: 600px) { .card-select { opacity: 1; } }

`;
