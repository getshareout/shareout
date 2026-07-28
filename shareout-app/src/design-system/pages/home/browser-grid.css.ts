/**
 * Home page styles — Browser: grid
 * @module design-system/pages/home/browser-grid
 */

/** CSS rules for: Browser: grid */
export const browserGridStyles = `/* ── Browser: grid ──────────────────────────────────── */
.artifacts-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: var(--space-5);
}
/* Client-side filter (search box + tag filter) hides non-matches via [hidden]. */
.artifact-card[hidden], .wsx-tr[hidden] { display: none !important; }

.artifact-card {
  position: relative;
  cursor: pointer;
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--glass-shadow);
  overflow: hidden;
  transition: transform var(--duration-normal), box-shadow var(--duration-normal), background var(--duration-normal), border-color var(--duration-normal);
}
.artifact-card:hover {
  transform: translateY(-3px);
  background: var(--glass-bg-hover);
  border-color: rgba(255, 255, 255, 0.8);
  box-shadow: 0 22px 50px -18px rgba(28, 25, 23, 0.30), inset 0 1px 0 rgba(255, 255, 255, 0.9);
}

.card-preview-wrap { position: relative; }

.card-preview {
  display: flex; align-items: center; justify-content: center;
  height: 130px;
  position: relative;
  background: linear-gradient(135deg, color-mix(in srgb, var(--type-color) 12%, var(--color-surface)) 0%, var(--color-surface) 100%);
  text-decoration: none;
}
.card-preview img { width: 100%; height: 100%; object-fit: cover; }
.card-preview-fallback { display: flex; align-items: center; justify-content: center; }
.card-preview-fallback svg { width: 34px; height: 34px; color: var(--type-color); opacity: 0.55; }

.type-chip {
  position: absolute; top: 10px; left: 10px;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px 3px 7px;
  background: var(--color-bg-elevated);
  color: var(--type-color);
  border-radius: var(--radius-full);
  font-size: 0.68rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.03em;
  box-shadow: var(--shadow-sm);
}
.type-chip svg { width: 12px; height: 12px; }

.card-actions {
  position: absolute; top: 88px; right: 10px;
  display: flex; gap: 4px;
  opacity: 0;
  transition: opacity var(--duration-normal);
  z-index: 2;
}
.artifact-card:hover .card-actions { opacity: 1; }
body.selecting .card-actions { opacity: 0 !important; pointer-events: none; }

.card-action-btn {
  width: 30px; height: 30px;
  display: flex; align-items: center; justify-content: center;
  border: none; border-radius: var(--radius-md);
  background: var(--color-bg-elevated);
  box-shadow: var(--shadow-sm);
  color: var(--color-text-secondary);
  cursor: pointer; text-decoration: none;
  transition: all var(--duration-fast);
}
.card-action-btn svg { width: 15px; height: 15px; }
.card-action-btn:hover { background: var(--color-primary); color: var(--color-text-inverse); }
.card-action-btn.loading { pointer-events: none; }
.card-action-btn.loading svg { animation: spin 0.9s linear infinite; }
.card-action-btn.fav-toggle.active { color: var(--color-warning); }
.card-action-btn.fav-toggle.active:hover { background: var(--color-primary); color: var(--color-text-inverse); }

.card-body { padding: 0.875rem 1rem 1rem; }

.card-top { display: flex; align-items: flex-start; gap: 0.5rem; margin-bottom: 0.6rem; }
.card-type-icon {
  width: 26px; height: 26px; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: var(--radius-sm);
  background: color-mix(in srgb, var(--type-color) 14%, transparent);
  color: var(--type-color);
  margin-top: 0.1rem;
}
.card-type-icon svg { width: 15px; height: 15px; }
.card-title {
  flex: 1; min-width: 0;
  font-family: var(--font-display);
  font-size: 0.95rem; font-weight: 600; line-height: 1.35;
  color: var(--color-text);
  text-decoration: none;
  white-space: normal;
  overflow: visible;
  word-break: break-word;
}
.card-title:hover { color: var(--color-primary); }
.card-description {
  margin: 0.5rem 0 0;
  font-size: 0.8rem; line-height: 1.4;
  color: var(--color-text-secondary);
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-badge {
  flex-shrink: 0;
  display: inline-flex; align-items: center; gap: 4px;
  padding: 3px 9px 3px 7px;
  border-radius: var(--radius-full);
  font-size: 0.66rem; font-weight: 700;
  letter-spacing: 0.01em; white-space: nowrap;
  border: none;
  font-family: inherit;
}
.card-badge svg { width: 12px; height: 12px; }
.card-preview-badge {
  position: absolute; top: 10px; right: 10px;
  z-index: 3;
  box-shadow: 0 2px 8px rgba(28, 25, 23, 0.16);
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}
/* Opaque fills on cover thumbnails — translucent token backgrounds bleed into previews. */
.card-preview-badge.badge-private {
  background: var(--color-bg-elevated);
  color: var(--color-text-secondary);
  border: 1px solid var(--color-border);
}
.card-preview-badge.badge-workspace {
  background: var(--color-primary-light);
  color: var(--color-primary-hover);
  border: 1px solid color-mix(in srgb, var(--color-primary) 35%, transparent);
}
button.card-badge.vis-toggle {
  cursor: pointer;
  transition: transform var(--duration-fast), box-shadow var(--duration-fast), background var(--duration-fast), border-color var(--duration-fast);
}
button.card-badge.vis-toggle:hover {
  transform: scale(1.04);
  box-shadow: var(--shadow-md);
}
button.card-preview-badge.vis-toggle.badge-private:hover {
  background: var(--color-bg-elevated);
  border-color: var(--color-border-strong);
}
button.card-preview-badge.vis-toggle.badge-workspace:hover {
  background: color-mix(in srgb, var(--color-primary) 25%, transparent);
  border-color: color-mix(in srgb, var(--color-primary) 45%, transparent);
}
button.card-badge.vis-toggle:active { transform: scale(0.97); }
.badge-public { background: var(--color-success-light); color: var(--color-success); }
.badge-private { background: var(--color-surface); color: var(--color-text-secondary); border: 1px solid var(--color-border); }
.badge-workspace { background: var(--color-primary-light); color: var(--color-primary); }
.badge-restricted, .badge-unlisted { background: var(--color-primary-light); color: var(--color-primary-hover); }
/* Moderation status chips — amber while held under review, red when blocked. Sit
   top-left on the preview so they don't overlap the top-right visibility badge. */
.badge-review { background: var(--color-warning-light); color: var(--color-warning); border: 1px solid color-mix(in srgb, var(--color-warning) 35%, transparent); }
.badge-blocked { background: var(--color-error-light); color: var(--color-error); border: 1px solid color-mix(in srgb, var(--color-error) 35%, transparent); }
.card-preview-badge.badge-review, .card-preview-badge.badge-blocked { left: 10px; right: auto; }

`;
