/**
 * Home page styles — Card tags
 * @module design-system/pages/home/card-tags
 */

/** CSS rules for: Card tags */
export const cardTagsStyles = `/* ── Card tags ──────────────────────────────────────── */
.card-tags { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 0.7rem; }
.card-tag {
  appearance: none; border: none; cursor: pointer; font: inherit;
  padding: 2px 9px;
  font-size: 0.7rem; font-weight: 600;
  color: var(--color-text-secondary);
  background: var(--color-surface);
  border-radius: var(--radius-full);
  transition: all var(--duration-fast);
  max-width: 140px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.card-tag:hover { background: var(--color-primary-light); color: var(--color-primary); }
.card-action-btn.danger:hover { background: var(--color-danger, var(--color-error)); color: var(--color-text-inverse); }

`;
