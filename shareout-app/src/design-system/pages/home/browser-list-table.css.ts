/**
 * Home page styles — Browser: list (table)
 * @module design-system/pages/home/browser-list-table
 */

/** CSS rules for: Browser: list (table) */
export const browserListTableStyles = `/* ── Browser: list (table) ──────────────────────────── */
.browser[data-view="list"] .artifacts-grid {
  display: flex; flex-direction: column;
  gap: 0;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
}
/* Each row is its own grid; fixed column widths keep every row aligned.
   card-body + card-top use display:contents so their children become row columns:
   [select] [thumb] [title 1fr] [owner] [meta]. Actions float right on hover. */
.browser[data-view="list"] .artifact-card {
  position: relative;
  display: grid;
  grid-template-columns: 26px 40px minmax(0, 1fr) 156px 184px;
  align-items: center;
  column-gap: var(--space-4);
  border: none;
  border-bottom: 1px solid var(--color-border);
  border-radius: 0;
  padding: 0.6rem 1rem;
}
.browser[data-view="list"] .artifact-card:last-child { border-bottom: none; }
.browser[data-view="list"] .artifact-card:hover { transform: none; box-shadow: none; background: var(--color-surface); }
.browser[data-view="list"] .card-body { display: contents; }
.browser[data-view="list"] .card-top { display: contents; }
.browser[data-view="list"] .card-type-icon { display: none; }
.browser[data-view="list"] .card-tags,
.browser[data-view="list"] .card-description,
.browser[data-view="list"] .card-features { display: none; }
.browser[data-view="list"] .card-preview-wrap {
  position: relative;
  width: 40px; height: 28px;
}
.browser[data-view="list"] .card-preview {
  width: 100%; height: 100%;
  border-radius: var(--radius-sm);
}
.browser[data-view="list"] .card-preview img { display: block; }
.browser[data-view="list"] .card-preview-fallback svg { width: 17px; height: 17px; }
/* In grid view, hide the badge duplicated inside card-top */
.card-top .card-preview-badge { display: none; }

/* In list view: move badge from thumbnail to title row */
.browser[data-view="list"] .card-preview-wrap .card-preview-badge { display: none; }
.browser[data-view="list"] .card-top { display: flex; align-items: center; gap: 6px; min-width: 0; }
.browser[data-view="list"] .card-top .card-title { flex: 0 1 auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.browser[data-view="list"] .card-top .card-preview-badge {
  display: inline-flex;
  position: static;
  font-size: 0.72rem;
  padding: 2px 8px;
  flex-shrink: 0;
  box-shadow: none;
}
.browser[data-view="list"] .card-top .card-preview-badge svg { width: 10px; height: 10px; display: inline; }
.browser[data-view="list"] .type-chip { display: none; }
.browser[data-view="list"] .card-title { font-size: 0.9rem; }
.browser[data-view="list"] .card-owner { margin-top: 0; }
.browser[data-view="list"] .card-meta { flex-wrap: nowrap; }
/* Actions float at the right edge, revealed on row hover (always on touch). */
.browser[data-view="list"] .card-actions {
  position: absolute; right: 12px; top: 50%; transform: translateY(-50%);
  display: flex; gap: 4px;
  padding: 4px 6px; border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-md, 0 4px 12px rgba(0,0,0,0.08));
  opacity: 0; pointer-events: none;
  transition: opacity var(--duration-fast);
}
.browser[data-view="list"] .artifact-card:hover .card-actions { opacity: 1; pointer-events: auto; }
.browser[data-view="list"] .card-action-btn { box-shadow: none; background: var(--color-surface); }
.browser[data-view="list"] .card-action-btn:hover { background: var(--color-primary); color: var(--color-text-inverse); }
@media (pointer: coarse) {
  .browser[data-view="list"] .card-actions { opacity: 1; pointer-events: auto; }
}
@media (max-width: 860px) {
  .browser[data-view="list"] .artifact-card { grid-template-columns: 26px 40px minmax(0, 1fr) 156px; }
  .browser[data-view="list"] .card-owner { display: none; }
  .browser[data-view="list"] .card-meta { display: none; }
}
@media (max-width: 560px) {
  .browser[data-view="list"] .artifact-card { grid-template-columns: 26px 40px minmax(0, 1fr) auto; }
}

`;
