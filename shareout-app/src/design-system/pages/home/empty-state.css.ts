/**
 * Home page styles — Empty state
 * @module design-system/pages/home/empty-state
 */

/** CSS rules for: Empty state */
export const emptyStateStyles = `/* ── Empty state ────────────────────────────────────── */
.empty-state { text-align: center; padding: var(--space-16) var(--space-6); }
.empty-icon { width: 56px; height: 56px; margin: 0 auto var(--space-5); color: var(--color-text-tertiary); }
.empty-title { font-family: var(--font-display); font-size: 1.35rem; font-weight: 700; margin-bottom: 0.5rem; }
.empty-description { font-size: 1rem; color: var(--color-text-secondary); max-width: 380px; margin: 0 auto var(--space-6); }
.empty-cta {
  display: inline-flex; align-items: center; gap: 0.5rem;
  padding: 13px 26px;
  background: var(--color-primary); color: var(--color-text-inverse);
  border: none; border-radius: var(--radius-lg);
  font-size: 0.95rem; font-weight: 600; cursor: pointer;
  transition: all var(--duration-normal);
}
.empty-cta:hover { background: var(--color-primary-hover); transform: translateY(-1px); }
.empty-cta svg { width: 18px; height: 18px; }

`;
