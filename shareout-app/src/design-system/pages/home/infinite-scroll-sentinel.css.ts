/**
 * Home page styles — Infinite scroll sentinel
 * @module design-system/pages/home/infinite-scroll-sentinel
 */

/** CSS rules for: Infinite scroll sentinel */
export const infiniteScrollSentinelStyles = `/* ── Infinite scroll sentinel ───────────────────────── */
.scroll-sentinel { display: flex; justify-content: center; align-items: center; padding: var(--space-6) 0; }
.scroll-sentinel[hidden] { display: none; }
.scroll-spinner {
  width: 22px; height: 22px; border-radius: 50%;
  border: 2.5px solid var(--color-border-strong);
  border-top-color: var(--color-primary);
  animation: scrollSpin 0.7s linear infinite;
}
@keyframes scrollSpin { to { transform: rotate(360deg); } }

`;
