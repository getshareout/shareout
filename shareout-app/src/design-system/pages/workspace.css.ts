/**
 * ShareOut Design System - Workspace Landing Page Styles
 * Public, read-only showcase of a workspace's published pages.
 * Echoes the home dashboard's card language (preview thumbnails, type chips)
 * on a warm canvas. Use with baseStyles from shell.ts.
 */

const workspacePageComponents = `
.ws {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}

/* ── Top bar ─────────────────────────────────────────── */
.ws-topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--space-4) var(--space-6);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-elevated);
  position: sticky;
  top: 0;
  z-index: 10;
}

.brand {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.brand-name {
  font: 700 17px var(--font-display);
  color: var(--color-text);
  letter-spacing: -0.01em;
}

.ws-signin {
  font: 500 15px var(--font-body);
  color: var(--color-text-secondary);
  padding: var(--space-2) var(--space-4);
  border-radius: var(--radius-md);
  transition: background var(--duration-fast) var(--ease-out),
              color var(--duration-fast) var(--ease-out);
}

.ws-signin:hover {
  background: var(--color-surface);
  color: var(--color-text);
}

/* ── Body ────────────────────────────────────────────── */
.ws-main {
  flex: 1;
  width: 100%;
  max-width: var(--max-width);
  margin: 0 auto;
  padding: var(--space-16) var(--space-6) var(--space-24);
}

/* ── Hero ────────────────────────────────────────────── */
.ws-hero {
  margin-bottom: var(--space-12);
}

.ws-monogram {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 56px;
  height: 56px;
  border-radius: var(--radius-lg);
  background: var(--color-primary);
  color: #fff;
  font: 700 26px var(--font-display);
  margin-bottom: var(--space-5);
  box-shadow: var(--shadow-md);
}

.ws-logo {
  display: block;
  max-width: 200px;
  max-height: 64px;
  width: auto;
  height: auto;
  object-fit: contain;
  margin-bottom: var(--space-5);
}

.ws-badge {
  display: inline-block;
  background: var(--color-primary-light);
  color: var(--color-primary);
  font: 600 12px var(--font-body);
  padding: var(--space-1) var(--space-3);
  border-radius: var(--radius-full);
  margin-left: var(--space-3);
  letter-spacing: 0.04em;
  text-transform: uppercase;
  vertical-align: middle;
}

.ws-title {
  font: 700 44px/1.05 var(--font-display);
  color: var(--color-text);
  letter-spacing: -0.02em;
  margin-top: var(--space-4);
}

.ws-description {
  font: 400 19px/1.5 var(--font-body);
  color: var(--color-text-secondary);
  max-width: 620px;
  margin-top: var(--space-3);
}

.ws-count {
  font: 500 14px var(--font-body);
  color: var(--color-text-tertiary);
  margin-top: var(--space-4);
}

/* ── Grid ────────────────────────────────────────────── */
.ws-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
  gap: var(--space-6);
}

.card {
  display: flex;
  flex-direction: column;
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  overflow: hidden;
  box-shadow: var(--shadow-sm);
  transition: transform var(--duration-normal) var(--ease-out),
              box-shadow var(--duration-normal) var(--ease-out),
              border-color var(--duration-normal) var(--ease-out);
}

.card:hover {
  transform: translateY(-3px);
  box-shadow: var(--shadow-lg);
  border-color: var(--color-border-strong);
}

.card:active {
  transform: translateY(-1px);
}

/* ── Card preview ────────────────────────────────────── */
.card-preview {
  position: relative;
  display: block;
  aspect-ratio: 16 / 10;
  background: var(--color-surface);
  overflow: hidden;
}

.card-preview-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: top center;
}

.card-preview-fallback {
  position: absolute;
  inset: 0;
  align-items: center;
  justify-content: center;
  color: var(--type-color, var(--color-text-tertiary));
  background: color-mix(in srgb, var(--type-color, #6366f1) 8%, var(--color-surface));
}

.card-preview-fallback svg {
  width: 40px;
  height: 40px;
  opacity: 0.7;
}

.type-chip {
  position: absolute;
  top: var(--space-3);
  left: var(--space-3);
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 10px;
  border-radius: var(--radius-full);
  background: rgba(255, 255, 255, 0.92);
  color: var(--type-color, var(--color-text-secondary));
  font: 600 12px var(--font-body);
  box-shadow: var(--shadow-sm);
  backdrop-filter: blur(8px);
}

.type-chip svg {
  width: 13px;
  height: 13px;
}

/* ── Card body ───────────────────────────────────────── */
.card-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-2);
  padding: var(--space-5);
}

.card-title {
  font: 600 17px var(--font-display);
  color: var(--color-text);
  letter-spacing: -0.01em;
}

.card-description {
  font: 400 14px/1.5 var(--font-body);
  color: var(--color-text-secondary);
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.card-meta {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  margin-top: var(--space-1);
  font: 400 13px var(--font-body);
  color: var(--color-text-tertiary);
}

.card-meta-item {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.card-meta-item svg {
  width: 14px;
  height: 14px;
}

/* ── Empty ───────────────────────────────────────────── */
.ws-empty {
  text-align: center;
  padding: var(--space-24) var(--space-6);
}

.ws-empty-icon {
  width: 48px;
  height: 48px;
  color: var(--color-text-tertiary);
  margin: 0 auto var(--space-5);
}

.ws-empty-title {
  font: 600 20px var(--font-display);
  color: var(--color-text);
  margin-bottom: var(--space-2);
}

.ws-empty-text {
  font: 400 16px var(--font-body);
  color: var(--color-text-secondary);
}

/* ── Footer ──────────────────────────────────────────── */
.ws-footer {
  border-top: 1px solid var(--color-border);
  padding: var(--space-8) var(--space-6);
  text-align: center;
}

.ws-footer-cta {
  font: 500 14px var(--font-body);
  color: var(--color-text-tertiary);
  transition: color var(--duration-fast) var(--ease-out);
}

.ws-footer-cta:hover {
  color: var(--color-primary);
}

/* ── Responsive ──────────────────────────────────────── */
@media (max-width: 640px) {
  .ws-main {
    padding: var(--space-10) var(--space-4) var(--space-16);
  }
  .ws-title {
    font-size: 34px;
  }
  .ws-description {
    font-size: 17px;
  }
  .ws-grid {
    grid-template-columns: 1fr;
  }
}

@media (prefers-reduced-motion: reduce) {
  .card {
    transition: none;
  }
}
`;

export const workspacePageStyles = workspacePageComponents;
