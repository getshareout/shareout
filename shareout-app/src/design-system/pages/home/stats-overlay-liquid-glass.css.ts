/**
 * Home page styles — Stats overlay (liquid glass)
 * @module design-system/pages/home/stats-overlay-liquid-glass
 */

/** CSS rules for: Stats overlay (liquid glass) */
export const statsOverlayLiquidGlassStyles = `/* ── Stats overlay (liquid glass) ───────────────────── */
.stats-overlay { position: fixed; inset: 0; z-index: 1250; display: none; align-items: flex-end; justify-content: center; padding: 1rem; }
.stats-overlay.open { display: flex; }
.stats-overlay-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,0.3); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px); }
.stats-overlay-panel {
  position: relative; width: 100%; max-width: 460px; max-height: 85vh;
  background: rgba(255,255,255,0.8);
  backdrop-filter: blur(20px) saturate(180%); -webkit-backdrop-filter: blur(20px) saturate(180%);
  border: 1px solid rgba(255,255,255,0.4);
  border-radius: 24px 24px 16px 16px;
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: slideUp 0.3s cubic-bezier(0.32, 0.72, 0, 1);
}
@keyframes slideUp { from { transform: translateY(100%); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
.stats-overlay-header { display: flex; align-items: center; justify-content: space-between; padding: 1.25rem 1.5rem; border-bottom: 1px solid rgba(0,0,0,0.06); }
.stats-overlay-title { font-family: var(--font-display); font-size: 1.05rem; font-weight: 600; margin: 0; }
.stats-overlay-close { width: 32px; height: 32px; border: none; border-radius: 50%; background: rgba(0,0,0,0.05); cursor: pointer; display: flex; align-items: center; justify-content: center; }
.stats-overlay-close:hover { background: rgba(0,0,0,0.1); }
.stats-overlay-close svg { width: 18px; height: 18px; color: var(--color-text-secondary); }
.stats-overlay-content { padding: 1.5rem; overflow-y: auto; max-height: calc(85vh - 80px); }
.stats-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 1rem; margin-bottom: 1.25rem; }
.stats-card { background: rgba(255,255,255,0.55); border: 1px solid rgba(0,0,0,0.05); border-radius: var(--radius-xl); padding: 1.25rem; text-align: center; }
.stats-card-value { font-size: 1.75rem; font-weight: 700; line-height: 1; }
.stats-card-label { font-size: 0.72rem; color: var(--color-text-secondary); margin-top: 0.5rem; text-transform: uppercase; letter-spacing: 0.05em; }
.stats-chart { background: rgba(255,255,255,0.55); border: 1px solid rgba(0,0,0,0.05); border-radius: var(--radius-xl); padding: 1.25rem; }
.stats-chart-title { font-size: 0.82rem; font-weight: 600; margin-bottom: 1rem; }
.stats-chart-bars { display: flex; align-items: flex-end; gap: 4px; height: 90px; }
.stats-chart-bar { flex: 1; background: var(--color-primary); border-radius: 3px 3px 0 0; min-height: 4px; }
.stats-loading { text-align: center; padding: 2rem; color: var(--color-text-secondary); }
.stats-note { font-size: 0.68rem; color: var(--color-text-secondary); margin-top: 0.4rem; }

`;
