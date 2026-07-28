/**
 * Home page styles — Responsive
 * @module design-system/pages/home/responsive
 */

/** CSS rules for: Responsive */
export const responsiveStyles = `/* ── Responsive ─────────────────────────────────────────
   Page-level mobile layout + touch ergonomics live in
   home.mobile.css.ts (appended to homePageStyles below). */

.artifact-card.is-removing {
  pointer-events: none;
  z-index: 0;
  animation: cardRemove 0.34s cubic-bezier(0.4, 0, 0.6, 1) forwards;
}
@keyframes cardRemove {
  40% { transform: scale(1.015); }
  to { transform: scale(0.86); opacity: 0; filter: blur(3px); }
}

@media (prefers-reduced-motion: reduce) {
  .artifact-card, .toast, .rail-create, .empty-cta { transition: none; }
  .artifact-card:hover { transform: none; }
  .stats-overlay-panel { animation: none; }
  .glass::before { animation: none; }
  .cmdbar, .detail-drawer { transition: opacity 0.2s ease; }
  .confirm-panel, .confirm-icon { animation: none; }
  .artifact-card.is-removing { animation: none; opacity: 0; }
  .detail-regen.loading svg { animation: none; }
  .accounts-menu, .notif-menu, .sort-menu, .fnav-menu { animation: none; }
  .scope-chip, .lib-seg, .sk-market-tab, .notif-btn, .sched-card { transition: none; }
}

@media (prefers-color-scheme: dark) {
  .stats-overlay-panel { background: rgba(30,30,30,0.85); border-color: rgba(255,255,255,0.1); }
  .stats-card, .stats-chart { background: rgba(255,255,255,0.05); border-color: rgba(255,255,255,0.08); }
  .accounts-panel { background: rgba(30,30,30,0.92); border-color: rgba(255,255,255,0.1); }
  .acct-row { background: rgba(255,255,255,0.05); }
}

`;
