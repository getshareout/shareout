/**
 * Home page styles — Liquid glass surface
 * @module design-system/pages/home/liquid-glass-surface
 */

/** CSS rules for: Liquid glass surface */
export const liquidGlassSurfaceStyles = `/* ── Liquid glass surface ───────────────────────────── */
.glass {
  position: relative;
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  box-shadow: var(--glass-shadow);
  border-radius: var(--radius-xl);
}
.glass::before {
  content: '';
  position: absolute; inset: 0;
  border-radius: inherit; pointer-events: none;
  background: linear-gradient(120deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 38%, rgba(255,255,255,0) 62%, rgba(255,255,255,0.30) 100%);
  background-size: 220% 220%;
  mix-blend-mode: screen;
}

`;
