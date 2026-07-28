/**
 * Home page styles — Sticky top bar (search + controls + account, one row)
 * @module design-system/pages/home/sticky-top-bar-search-controls-account-one-row
 */

/** CSS rules for: Sticky top bar (search + controls + account, one row) */
export const stickyTopBarSearchControlsAccountOneRowStyles = `/* ── Sticky top bar (search + controls + account, one row) ── */
.topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; gap: var(--space-4);
  margin: 0 calc(-1 * var(--space-8));
  padding: var(--space-3) var(--space-8);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
}
.topbar-controls { flex: 1; min-width: 0; }
.topbar-controls[hidden] { display: none; }
/* Folder dropdown: a mobile-only toolbar control (desktop uses the folder
   strip instead). Visuals reuse the sort dropdown — see selectors below. */
.folder-dropdown { display: none; position: relative; }

/* Secondary views (My schedules/alerts, Activity, Datasets, Admin) have no toolbar.
   Float the account pill top-right so the page title sits on the avatar's row, flush
   to the top — instead of dropping below an empty topbar + the .main column gap. */
@media (min-width: 961px) {
  .main:has(> .topbar > .topbar-controls[hidden]) { position: relative; }
  .main:has(> .topbar > .topbar-controls[hidden]) > .topbar {
    position: absolute; top: var(--space-5); right: var(--space-8); left: auto;
    margin: 0; padding: 0; z-index: 50;
    backdrop-filter: none; -webkit-backdrop-filter: none;
  }
  .main:has(> .topbar > .topbar-controls[hidden]) > .view:not([hidden]) > .admin-head {
    padding-right: 210px;
  }
}

`;
