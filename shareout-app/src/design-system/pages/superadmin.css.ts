/**
 * ShareOut Design System - Super-Admin Portal Styles
 * Platform control plane. Use with baseStyles from shell.ts via renderHtmlPage().
 */

const superadminComponents = `
/* Layout: fixed sidebar + scrolling main */
.sa-layout { display: flex; min-height: 100vh; }
.sa-pill {
  font: 600 10px var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-primary);
  background: var(--color-primary-light);
  padding: 2px 6px;
  border-radius: var(--radius-full);
}

.sa-sidebar {
  position: sticky;
  top: 0;
  align-self: flex-start;
  height: 100vh;
  width: 232px;
  flex-shrink: 0;
  background: var(--color-bg-elevated);
  border-right: 1px solid var(--color-border);
  display: flex;
  flex-direction: column;
  padding: var(--space-5) var(--space-3);
}
.sa-logo { display: flex; align-items: center; gap: var(--space-2); padding: 0 var(--space-2) var(--space-5); }
/* Canonical brand lockup (mark + wordmark) — see src/brand */
.brand { display: inline-flex; align-items: center; gap: 9px; text-decoration: none; color: inherit; }
.brand-mark { display: block; width: 26px; height: 26px; flex-shrink: 0; border-radius: 7px; }
.brand-name { font: 700 17px var(--font-display); letter-spacing: -0.02em; color: var(--color-primary); line-height: 1; }
.sa-nav { display: flex; flex-direction: column; gap: 2px; flex: 1; }
.sa-nav-item {
  display: flex; align-items: center; gap: var(--space-3);
  padding: 9px var(--space-3);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font: 500 14px var(--font-body);
  text-decoration: none;
}
.sa-nav-item svg { width: 18px; height: 18px; flex-shrink: 0; opacity: 0.8; }
.sa-nav-item:hover { background: var(--color-surface); color: var(--color-text); }
.sa-nav-item.active { background: var(--color-primary-light); color: var(--color-primary); font-weight: 600; }
.sa-nav-item.active svg { opacity: 1; }
.sa-sidebar-foot { border-top: 1px solid var(--color-border); padding-top: var(--space-3); margin-top: var(--space-3); }
.sa-sidebar-email { font: 500 12px var(--font-body); color: var(--color-text-secondary); padding: 0 var(--space-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sa-signout { display: inline-block; padding: var(--space-1) var(--space-2); font: 500 12px var(--font-body); color: var(--color-text-tertiary); text-decoration: none; }
.sa-signout:hover { color: var(--color-text); }

.sa-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sa-topbar {
  position: sticky; top: 0; z-index: 50;
  display: flex; align-items: center; justify-content: space-between;
  height: 64px; padding: 0 var(--space-8);
  background: var(--color-bg-elevated); border-bottom: 1px solid var(--color-border);
}
.sa-topbar h1 { font: 700 24px var(--font-display); letter-spacing: -0.02em; margin: 0; }
.sa-content { padding: var(--space-6) var(--space-8) var(--space-16); max-width: 1180px; }
.sa-subhead {
  font: 600 13px var(--font-mono); text-transform: uppercase; letter-spacing: 0.06em;
  color: var(--color-text-tertiary); margin: var(--space-10) 0 var(--space-4);
}

.sa-range { display: inline-flex; background: var(--color-surface); border-radius: var(--radius-md); padding: 2px; }
.sa-range-btn {
  font: 600 12px var(--font-body);
  color: var(--color-text-secondary);
  padding: 5px 10px;
  border-radius: var(--radius-sm);
  text-decoration: none;
}
.sa-range-btn.active { background: var(--color-bg-elevated); color: var(--color-text); box-shadow: var(--shadow-sm); }

.sa-pos { color: var(--color-success); }
.sa-neg { color: var(--color-error); }
.sa-note { font-size: 12px; color: var(--color-text-tertiary); margin-top: var(--space-3); }

.sa-cost-table td.sa-num { white-space: nowrap; }
.sa-cost-total td { border-top: 2px solid var(--color-border); background: var(--color-bg-elevated); }

/* Brief dim while a fragment loads (usually skipped — prefetched on hover). */
.sa-content { transition: opacity var(--duration-fast) var(--ease-out); }
.sa-content.sa-loading { opacity: 0.5; pointer-events: none; }

@media (max-width: 760px) {
  .sa-layout { flex-direction: column; }
  .sa-sidebar {
    position: static; height: auto; width: 100%;
    flex-direction: row; align-items: center; overflow-x: auto;
    border-right: none; border-bottom: 1px solid var(--color-border);
    padding: var(--space-2) var(--space-3); gap: var(--space-1);
  }
  .sa-logo { padding: 0 var(--space-3) 0 var(--space-2); }
  .sa-logo .brand-name { display: none; }
  .sa-nav { flex-direction: row; flex: 1; }
  .sa-nav-item span { display: none; }
  .sa-nav-item { padding: 8px; }
  .sa-sidebar-foot { border-top: none; margin-top: 0; padding-top: 0; }
  .sa-sidebar-email { display: none; }
  .sa-topbar { padding: 0 var(--space-4); }
  .sa-content { padding: var(--space-4); }
}

/* Stat cards */
.sa-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: var(--space-4); }
.sa-stat {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  padding: var(--space-5);
  box-shadow: var(--shadow-sm);
}
.sa-stat-value { font: 700 30px var(--font-display); color: var(--color-text); line-height: 1.1; }
.sa-stat-label { font: 500 13px var(--font-body); color: var(--color-text-secondary); margin-top: var(--space-2); }
.sa-stat-sub { font: 500 12px var(--font-body); color: var(--color-text-tertiary); margin-top: var(--space-1); }

/* Card grid */
.sa-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--space-4); }
.sa-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--space-4); }
@media (max-width: 860px) { .sa-grid, .sa-grid-3 { grid-template-columns: 1fr; } }
.sa-card {
  background: var(--color-bg-elevated);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-xl);
  padding: var(--space-6);
  box-shadow: var(--shadow-sm);
}
.sa-card h3 { font: 600 16px var(--font-display); margin: 0 0 var(--space-4); letter-spacing: -0.01em; }

/* Bar chart (vertical) */
.sa-chart { display: flex; align-items: flex-end; gap: 3px; height: 120px; }
.sa-chart-bar { flex: 1; min-height: 2px; background: var(--color-primary); border-radius: 3px 3px 0 0; opacity: 0.85; }
.sa-chart-bar:hover { opacity: 1; }
.sa-chart-empty { color: var(--color-text-tertiary); font-size: 13px; padding: var(--space-8) 0; text-align: center; }

/* Horizontal bar list (distribution) */
.sa-bars { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--space-3); }
.sa-bars li { display: grid; grid-template-columns: 110px 1fr 56px; align-items: center; gap: var(--space-3); }
.sa-bars .sa-bar-label { font: 500 13px var(--font-body); color: var(--color-text-secondary); text-transform: capitalize; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.sa-bars .sa-bar-track { background: var(--color-surface); border-radius: var(--radius-full); height: 8px; overflow: hidden; }
.sa-bars .sa-bar-fill { height: 100%; background: var(--color-primary); border-radius: var(--radius-full); }
.sa-bars .sa-bar-count { font: 600 13px var(--font-mono); color: var(--color-text); text-align: right; }

/* Tables */
.sa-table { width: 100%; border-collapse: collapse; font-size: 14px; }
.sa-table th {
  text-align: left;
  font: 600 11px var(--font-mono);
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--color-text-tertiary);
  padding: var(--space-2) var(--space-3);
  border-bottom: 1px solid var(--color-border);
}
.sa-table td { padding: var(--space-3); border-bottom: 1px solid var(--color-border); color: var(--color-text); vertical-align: middle; }
.sa-table tr:last-child td { border-bottom: none; }
.sa-table .sa-muted { color: var(--color-text-tertiary); }
.sa-table .sa-num { font-family: var(--font-mono); text-align: right; }

/* Badges, inputs, selects, buttons, and the confirm modal now use the shared
   so-c-* components, skinned by the .so-theme-admin scope on .sa-layout
   (design-system/components/themes.ts). Only layout containers and the few
   admin-specific bridge rules below remain here. */

/* Toolbar / search */
.sa-toolbar { display: flex; gap: var(--space-3); margin-bottom: var(--space-4); align-items: center; }
#sa-user-search, #sa-art-search, #sa-feat-search { flex: 1; }
.sa-actions { display: flex; gap: var(--space-2); align-items: center; flex-wrap: wrap; }

/* Confirm modal: shared .so-c-modal, toggled via .open (the admin JS adds/removes
   the class); ID specificity keeps it hidden until opened. */
#sa-modal-bg { display: none; }
#sa-modal-bg.open { display: flex; }
#sa-modal-bg h3 { font: 700 18px var(--font-display); margin: 0 0 var(--space-3); }
#sa-modal-bg p { color: var(--color-text-secondary); font-size: 14px; line-height: 1.5; }

.sa-empty { color: var(--color-text-tertiary); font-size: 13px; padding: var(--space-6) 0; text-align: center; }
.sa-gate { max-width: 420px; margin: 12vh auto; text-align: center; padding: var(--space-8); }
.sa-gate-brand { display: flex; justify-content: center; margin-bottom: var(--space-6); }
.sa-gate h1 { font: 700 24px var(--font-display); letter-spacing: -0.02em; }
.sa-gate p { color: var(--color-text-secondary); }
.sa-gate a { color: var(--color-primary); font-weight: 600; }

/* Features view */
.sa-feat-toolbar { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); margin-bottom: var(--space-5); flex-wrap: wrap; }
.sa-feat-target { display: flex; align-items: center; gap: var(--space-3); flex-wrap: wrap; }
.sa-feat-tab.active { background: var(--color-primary); color: #fff; border-color: var(--color-primary); }
.sa-feat-ws { position: relative; }
.sa-feat-results { position: absolute; z-index: 5; top: calc(100% + 4px); left: 0; min-width: 280px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: 12px; box-shadow: var(--shadow-lg); overflow: hidden; }
.sa-feat-results:empty { display: none; }
.sa-feat-result { display: block; width: 100%; text-align: left; padding: 9px var(--space-3); background: none; border: none; font: 500 13px var(--font-body); color: var(--color-text-primary); cursor: pointer; }
.sa-feat-result:hover { background: var(--color-primary-light); }
.sa-feat-current { font-size: 13px; color: var(--color-text-secondary); }
.sa-feat-group { margin-bottom: var(--space-6); }
.sa-feat-cat { font: 600 12px var(--font-mono); text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); margin: 0 0 var(--space-3); }
.sa-feat-row { display: flex; align-items: center; justify-content: space-between; gap: var(--space-4); padding: var(--space-3) 0; border-bottom: 1px solid var(--color-border); }
.sa-feat-meta { min-width: 0; }
.sa-feat-label { font: 600 14px var(--font-body); }
.sa-feat-desc { font-size: 12px; color: var(--color-text-tertiary); margin-top: 2px; }
.sa-feat-control { display: flex; align-items: center; gap: var(--space-3); flex-shrink: 0; }
.sa-seg { display: inline-flex; border: 1px solid var(--color-border); border-radius: 9px; overflow: hidden; }
.sa-seg-btn { padding: 6px 12px; background: var(--color-bg-elevated); border: none; border-right: 1px solid var(--color-border); font: 500 12px var(--font-body); color: var(--color-text-secondary); cursor: pointer; }
.sa-seg-btn:last-child { border-right: none; }
.sa-seg-btn.active { background: var(--color-primary); color: #fff; }
.sa-feat-hint { font-size: 12px; color: var(--color-text-secondary); min-width: 92px; text-align: right; }
`;

export const superadminPageStyles = superadminComponents;
