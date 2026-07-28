/**
 * Home page styles — Workspace schedules & automations (admin)
 * @module design-system/pages/home/workspace-schedules-automations-admin
 */

/** CSS rules for: Workspace schedules & automations (admin) */
export const workspaceSchedulesAutomationsAdminStyles = `/* ── Workspace schedules & automations (admin) ──────── */
.ws-jobs-list { display: flex; flex-direction: column; gap: 0.55rem; }
/* Live human-readable preview inside the cron edit modal. */
.cron-preview { font-size: 0.82rem; color: var(--color-text-secondary); min-height: 1.15em; }
.cron-preview:not(:empty)::before { content: "↻ "; color: var(--color-text-tertiary); }
`;
