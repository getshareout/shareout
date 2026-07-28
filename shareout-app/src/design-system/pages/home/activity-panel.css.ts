/**
 * Home page styles — Activity panel
 * @module design-system/pages/home/activity-panel
 */

/** CSS rules for: Activity panel */
export const activityPanelStyles = `/* ── Activity panel ─────────────────────────────────── */
.activity-panel {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-xl);
  box-shadow: var(--glass-shadow);
  padding: var(--space-6);
}
.panel-title {
  font-family: var(--font-display);
  font-size: 0.8rem; font-weight: 700;
  text-transform: uppercase; letter-spacing: 0.05em;
  color: var(--color-text-secondary);
  margin: 0 0 var(--space-4);
}
.activity-table { display: flex; flex-direction: column; font-size: 0.875rem; }
.activity-row {
  display: grid;
  grid-template-columns: minmax(0, 2.4fr) minmax(0, 1fr) minmax(0, 1fr) auto;
  align-items: center; gap: var(--space-4);
  padding: 0.7rem 0.25rem;
  border-bottom: 1px solid var(--color-border);
}
.activity-row:last-child { border-bottom: none; }
.activity-row--head {
  font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--color-text-tertiary); padding-bottom: 0.5rem;
}
.activity-row:not(.activity-row--head):hover { background: rgba(255, 255, 255, 0.45); }
.activity-c-name { display: flex; align-items: center; gap: 0.6rem; min-width: 0; }
.activity-c-name strong { font-weight: 600; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.activity-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-success); flex-shrink: 0; }
.activity-c-event { color: var(--color-text-secondary); text-transform: capitalize; }
.activity-c-loc { color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.activity-c-time { font-size: 0.78rem; color: var(--color-text-tertiary); text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }

`;
