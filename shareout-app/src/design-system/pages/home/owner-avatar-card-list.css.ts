/**
 * Home page styles — Owner avatar (card + list)
 * @module design-system/pages/home/owner-avatar-card-list
 */

/** CSS rules for: Owner avatar (card + list) */
export const ownerAvatarCardListStyles = `/* ── Owner avatar (card + list) ─────────────────────── */
.card-owner { display: inline-flex; align-items: center; gap: 7px; min-width: 0; margin-top: 0.55rem; }
.owner-avatar {
  width: 22px; height: 22px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 50%; overflow: hidden;
  background: var(--color-primary-light); color: var(--color-primary);
  font-size: 0.62rem; font-weight: 700;
}
.owner-avatar img { width: 100%; height: 100%; object-fit: cover; }
.owner-name { font-size: 0.78rem; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

.card-meta {
  display: flex; align-items: center; flex-wrap: wrap; gap: 0.875rem;
  font-size: 0.75rem; color: var(--color-text-tertiary);
}
.card-meta-item { display: inline-flex; align-items: center; gap: 0.3rem; }
.card-meta-item svg { width: 13px; height: 13px; opacity: 0.7; }
.card-meta-item.role { color: var(--color-primary); font-weight: 600; }

.card-features {
  display: flex; flex-wrap: wrap; gap: 5px;
  margin-top: 0.75rem;
  padding-top: 0.75rem;
  border-top: 1px solid var(--color-border);
}
.feature {
  width: 24px; height: 24px;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  background: var(--color-surface);
  color: var(--color-text-secondary);
  transition: all var(--duration-normal);
}
.feature svg { width: 13px; height: 13px; }
.feature:hover { background: var(--color-primary-light); color: var(--color-primary); }

`;
