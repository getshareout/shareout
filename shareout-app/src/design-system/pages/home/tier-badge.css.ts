/**
 * Home page styles — Tier badge
 * @module design-system/pages/home/tier-badge
 */

/** CSS rules for: Tier badge */
export const tierBadgeStyles = `/* ── Tier badge ─────────────────────────────────────── */
.rail-tier { display: flex; align-items: center; gap: 7px; margin: auto 0 0; padding: 10px 12px; border-top: 1px solid var(--color-border); font: 500 0.78rem var(--font-body); }
.rail-tier-dot { width: 7px; height: 7px; border-radius: 50%; flex-shrink: 0; background: var(--color-text-tertiary); }
.rail-tier-dot--active { background: var(--color-success, #22c55e); }
.rail-tier-dot--pulse { background: var(--color-primary); animation: tier-pulse 1.6s ease-in-out infinite; }
.rail-tier--urgent .rail-tier-dot--pulse { background: #f59e0b; }
.rail-tier-label { flex: 1; color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.rail-tier-manage { color: var(--color-primary); font-weight: 600; text-decoration: none; white-space: nowrap; }
.rail-tier-manage:hover { text-decoration: underline; }
html.rail-collapsed .rail-tier { justify-content: center; padding: 10px 0; border-top: 1px solid var(--color-border); }
html.rail-collapsed .rail-tier-label, html.rail-collapsed .rail-tier-manage { display: none; }
@keyframes tier-pulse { 0%, 100% { opacity: 1; transform: scale(1); } 50% { opacity: 0.4; transform: scale(1.35); } }

`;
