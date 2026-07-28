/**
 * Home page styles — Rich schedule cards (My schedules + Admin schedules, shared)
 * @module design-system/pages/home/rich-schedule-cards-my-schedules-admin-schedules-shared
 */

/** CSS rules for: Rich schedule cards (My schedules + Admin schedules, shared) */
export const richScheduleCardsMySchedulesAdminSchedulesSharedStyles = `/* ── Rich schedule cards (My schedules + Admin schedules, shared) ── */
.sched-list { display: flex; flex-direction: column; gap: 10px; }
.sched-card {
  display: grid; grid-template-columns: auto 1fr auto; align-items: start; gap: 14px;
  border: 1px solid var(--glass-border); border-radius: var(--radius-lg);
  background: rgba(255,255,255,0.55); padding: 14px 16px;
  transition: box-shadow var(--duration-normal), border-color var(--duration-normal);
}
.sched-card:hover { box-shadow: var(--shadow-sm); border-color: var(--color-border); }
.sched-card.is-off { opacity: 0.66; }
.sched-card-ico { position: relative; width: 40px; height: 40px; flex-shrink: 0; }
.sched-dest-logo { width: 40px; height: 40px; border-radius: var(--radius-md); object-fit: contain; background: var(--color-bg-elevated); padding: 4px; border: 1px solid var(--glass-border); }
.sched-dest-svg {
  display: flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: var(--radius-md);
  background: var(--color-primary-light); color: var(--color-primary); border: 1px solid var(--glass-border);
}
.sched-dest-svg svg { width: 20px; height: 20px; }
.sched-card-ico .ws-job-dot { position: absolute; right: -2px; bottom: -2px; box-shadow: 0 0 0 2px var(--color-bg-elevated); }
.sched-card-body { min-width: 0; }
.sched-card-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.sched-card-title { font-size: 0.95rem; font-weight: 700; color: var(--color-text); }
.sched-card-desc { margin-top: 2px; font-size: 0.82rem; color: var(--color-text-secondary); line-height: 1.4; }
.sched-card-tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 9px; }
.sched-chip {
  display: inline-flex; align-items: center; gap: 5px; max-width: 100%;
  padding: 3px 9px; border-radius: var(--radius-full);
  background: rgba(255,255,255,0.7); border: 1px solid var(--glass-border);
  font-size: 0.75rem; color: var(--color-text-secondary);
  font-variant-numeric: tabular-nums;
}
.sched-chip svg { width: 13px; height: 13px; flex-shrink: 0; opacity: 0.8; }
.sched-chip > span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px; }
.sched-chip.err { background: var(--color-error-light); border-color: var(--color-error); color: var(--color-error); }
.sched-chip.err svg { opacity: 1; }
.sched-art { color: var(--color-primary); text-decoration: none; }
.sched-art:hover { text-decoration: underline; }
.sched-dest-svg.crew { background: color-mix(in srgb, var(--color-primary) 16%, transparent); }
.crew-model-badge {
  display: inline-flex; align-items: center;
  padding: 2px 9px; border-radius: var(--radius-full);
  background: var(--color-primary-light); color: var(--color-primary);
  font-size: 0.7rem; font-weight: 700; white-space: nowrap;
}
.sched-card-actions { display: flex; flex-wrap: wrap; gap: 6px; justify-content: flex-end; align-content: flex-start; max-width: 230px; }
.sched-card .member-act:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
@media (max-width: 760px) {
  .sched-card { grid-template-columns: auto 1fr; }
  .sched-card-actions { grid-column: 1 / -1; max-width: none; justify-content: flex-start; }
}
.ws-job { border: 1px solid var(--glass-border); border-radius: var(--radius-md); background: rgba(255,255,255,0.5); padding: 10px 12px; display: flex; flex-direction: column; gap: 0.55rem; }
.ws-job.is-off { opacity: 0.7; }
.ws-job-main { display: flex; align-items: center; gap: 0.6rem; }
.ws-job-id { display: flex; flex-direction: column; gap: 0.1rem; min-width: 0; flex: 1; }
.ws-job-title { font-size: 0.86rem; font-weight: 600; color: var(--color-text); }
.ws-job-title code { font-family: var(--font-mono, monospace); font-size: 0.78rem; background: rgba(0,0,0,0.05); padding: 1px 5px; border-radius: 4px; }
.ws-job-sub { font-size: 0.76rem; color: var(--color-text-tertiary); }
.ws-job-art { color: var(--color-primary); text-decoration: none; }
.ws-job-art:hover { text-decoration: underline; }
.ws-job-badge { font-size: 0.68rem; font-weight: 600; padding: 2px 8px; border-radius: 999px; white-space: nowrap; }
.ws-job-badge.on { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.ws-job-badge.off { background: rgba(0,0,0,0.06); color: var(--color-text-tertiary); }
.ws-job-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; }
.ws-job-err { color: var(--color-error); cursor: help; }
.ws-job-dot { width: 9px; height: 9px; border-radius: 50%; flex: none; background: var(--color-text-tertiary); }
.ws-job-dot.ok { background: var(--color-success); }
.ws-job-dot.fail { background: var(--color-error); }
.ws-job-dot.run { background: var(--color-warning); }
.ws-job-dot.idle { background: var(--color-text-tertiary); }
.ws-runs-modal { width: min(640px, calc(100vw - 32px)); max-width: 640px; }
.ws-runs-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
.ws-runs-table th { text-align: left; font-weight: 600; color: var(--color-text-tertiary); padding: 6px 8px; border-bottom: 1px solid var(--glass-border); }
.ws-runs-table td { padding: 6px 8px; border-bottom: 1px solid var(--glass-border); vertical-align: top; }
.ws-runs-table td .ws-job-dot { display: inline-block; margin-right: 5px; }
.ws-runs-err { color: var(--color-error); max-width: 220px; word-break: break-word; }

`;
