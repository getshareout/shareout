/**
 * Home page styles — Analytics view
 * @module design-system/pages/home/analytics-view
 */

/** CSS rules for: Analytics view */
export const analyticsViewStyles = `/* ── Analytics view ─────────────────────────────────── */
.an-head { display: flex; align-items: flex-start; justify-content: space-between; gap: var(--space-4); flex-wrap: wrap; }
.an-range { display: inline-flex; gap: 2px; padding: 3px; border-radius: var(--radius-full); background: rgba(255,255,255,0.5); border: 1px solid var(--glass-border); }
.an-range-btn { border: none; background: transparent; padding: 6px 14px; border-radius: var(--radius-full); font: 600 0.82rem var(--font-body); color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-normal), color var(--duration-normal); }
.an-range-btn:hover { color: var(--color-text); }
.an-range-btn.active { background: var(--color-bg-elevated); color: var(--color-primary); box-shadow: var(--shadow-sm); }
.an-range-btn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }

.an-kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 0 0 var(--space-4); }
.an-kpi { border: 1px solid var(--glass-border); border-radius: var(--radius-lg); background: rgba(255,255,255,0.55); padding: 14px 16px; }
.an-kpi-top { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.an-kpi-value { font-size: 1.7rem; font-weight: 700; color: var(--color-text); font-variant-numeric: tabular-nums; line-height: 1.1; }
.an-kpi-label { margin-top: 3px; font-size: 0.82rem; font-weight: 600; color: var(--color-text-secondary); }
.an-kpi-sub { margin-top: 2px; font-size: 0.72rem; color: var(--color-text-tertiary); }
.an-delta { font-size: 0.75rem; font-weight: 700; padding: 1px 6px; border-radius: var(--radius-full); white-space: nowrap; }
.an-delta.up { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.an-delta.down { background: var(--color-error-light); color: var(--color-error); }
.an-delta.flat { background: rgba(0,0,0,0.05); color: var(--color-text-tertiary); }

.an-card { margin: 0 0 var(--space-4); }
.an-card-title { font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); margin: 0 0 12px; display: flex; align-items: center; gap: 8px; }
.an-card-note { text-transform: none; letter-spacing: 0; font-size: 0.68rem; font-weight: 700; color: var(--color-success); background: color-mix(in srgb, var(--color-success) 14%, transparent); padding: 1px 7px; border-radius: var(--radius-full); }
.an-chart { width: 100%; }
.an-svg { display: block; width: 100%; height: 180px; }
.an-axis { display: flex; align-items: center; justify-content: space-between; margin-top: 8px; font-size: 0.72rem; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
.an-legend { display: inline-flex; align-items: center; gap: 6px; }
.an-leg { display: inline-block; width: 14px; height: 0; border-top-width: 2px; border-top-style: solid; }
.an-leg-views { border-top-color: var(--color-primary); }
.an-leg-uniq { border-top-style: dashed; border-top-color: var(--color-primary); opacity: 0.5; }

.an-2col { display: grid; grid-template-columns: 1.4fr 1fr; gap: var(--space-4); align-items: start; }
.an-stack { display: flex; flex-direction: column; }

.an-table { display: flex; flex-direction: column; }
.an-row { display: grid; grid-template-columns: minmax(0,2.4fr) 70px 80px 90px; align-items: center; gap: 12px; padding: 10px 8px; border-bottom: 1px solid var(--color-border); text-align: left; }
.an-row:last-child { border-bottom: none; }
.an-row--head { font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); padding-bottom: 8px; }
.an-row--click { border: none; border-bottom: 1px solid var(--color-border); background: transparent; cursor: pointer; font: inherit; width: 100%; border-radius: var(--radius-sm); transition: background var(--duration-normal); }
.an-row--click:hover { background: rgba(255,255,255,0.55); }
.an-row--click:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.an-c-name { font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.an-c-num { text-align: right; font-variant-numeric: tabular-nums; color: var(--color-text-secondary); }
.an-c-last { text-align: right; font-variant-numeric: tabular-nums; color: var(--color-text-tertiary); font-size: 0.8rem; }

.an-bars { display: flex; flex-direction: column; gap: 9px; }
.an-bar-row { display: grid; grid-template-columns: minmax(0,1fr) 2.2fr auto; align-items: center; gap: 10px; font-size: 0.82rem; }
.an-bar-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--color-text-secondary); }
.an-bar-track { height: 8px; border-radius: var(--radius-full); background: rgba(0,0,0,0.06); overflow: hidden; }
.an-bar-fill { display: block; height: 100%; border-radius: var(--radius-full); background: var(--color-primary); opacity: 0.55; }
.an-bar-val { font-variant-numeric: tabular-nums; color: var(--color-text-tertiary); font-size: 0.78rem; }

.an-back { border: none; background: transparent; color: var(--color-primary); font: 600 0.82rem var(--font-body); cursor: pointer; padding: 0 0 6px; }
.an-back:hover { text-decoration: underline; }
.an-back:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.an-live { display: inline-flex; align-items: center; gap: 6px; vertical-align: middle; margin-left: 10px; font-size: 0.72rem; font-weight: 700; color: var(--color-success); background: var(--color-success-light); padding: 2px 9px; border-radius: var(--radius-full); }
.an-live-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-success); box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 55%, transparent); animation: an-live-pulse 1.8s ease-out infinite; }
@keyframes an-live-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 55%, transparent); } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }
@media (prefers-reduced-motion: reduce) { .an-live-dot { animation: none; } }

@media (max-width: 860px) {
  .an-kpis { grid-template-columns: repeat(2, 1fr); }
  .an-2col { grid-template-columns: 1fr; }
}
@media (prefers-reduced-motion: reduce) { .an-range-btn, .an-row--click { transition: none; } }

`;
