/**
 * Center canvas: tab bar, panes, brief widgets, chips, and create-with-AI layout.
 * Split out of styles.ts to stay under the per-module line cap; concatenated into
 * WORKSPACE_STYLES in the same cascade position so order is unchanged.
 */
export const WORKSPACE_CANVAS_STYLES = `/* ---- canvas ---- */
.wsx__canvas { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.wsx__chrome { display: flex; align-items: center; gap: 10px; flex: none; min-height: var(--wsx-headbar); padding: 12px 16px 0; box-sizing: border-box; }
.wsx__acct--mob { display: flex; align-items: center; gap: 6px; flex: none; width: auto; padding: 4px 6px; margin-left: auto; border-radius: var(--radius-md); }
.wsx__acct--mob:hover { background: var(--color-surface); }
.wsx__chrome:has(.wsx__tabmode:not([hidden])) .wsx__acct--mob .wsx__acctname { display: none; }
.wsx__tabs { position: relative; display: flex; align-items: stretch; gap: 4px; padding: 8px 10px 4px; overflow-x: auto; background: transparent; flex: 1; min-width: 0; box-sizing: border-box; }
.wsx-tab { display: inline-flex; align-items: center; gap: 8px; padding: 8px 13px; border-radius: var(--radius-md); background: transparent; color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; white-space: nowrap; max-width: 220px; border: 0; transition: background var(--duration-fast), color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx-tab:hover { background: var(--color-surface); }
.wsx-tab.is-active { background: var(--color-primary-light); color: var(--color-primary); }
.wsx-tab__ic { display: inline-flex; flex: none; color: currentColor; }
.wsx-tab__ic svg { width: 16px; height: 16px; }
.wsx-tab--home { flex: none; }
.wsx-tab__label { overflow: hidden; text-overflow: ellipsis; }
/* View/Edit toggle pinned right in the tab bar (controls the active artifact) */
.wsx__tabmode { display: inline-flex; gap: 2px; padding: 3px; border-radius: var(--radius-md); background: var(--color-surface); flex: none; }
.wsx__tabmode[hidden] { display: none; }
.wsx__tabmode button { border: 0; background: transparent; padding: 5px 14px; border-radius: calc(var(--radius-md) - 3px); font: 600 var(--text-sm) var(--font-body); color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx__tabmode button:hover { color: var(--color-text); }
.wsx__tabmode button.is-on { background: var(--color-bg-elevated); color: var(--color-text); box-shadow: var(--shadow-sm); }
.wsx-tab__dot { width: 7px; height: 7px; border-radius: 50%; background: var(--color-warning); flex: none; }
.wsx-tab__x { width: 18px; height: 18px; display: grid; place-items: center; border: 0; background: transparent; border-radius: 50%; color: var(--color-text-tertiary); cursor: pointer; flex: none; font-size: 13px; }
.wsx-tab__x:hover { background: var(--color-border-strong); color: var(--color-text); }
.wsx-tab[draggable="true"] { cursor: grab; } .wsx-tab[draggable="true"]:active { cursor: grabbing; }
.wsx-tab.is-dragging { opacity: 0.4; cursor: grabbing; }
.wsx-tab.is-dragging .wsx-tab__x { visibility: hidden; }
.wsx-tab-drop { position: absolute; top: 8px; bottom: 4px; left: 0; width: 2px; border-radius: 2px; background: var(--color-primary); box-shadow: 0 0 0 2px var(--color-primary-light); pointer-events: none; transition: transform var(--duration-fast) var(--ease-out); }

.wsx__panes { position: relative; flex: 1; min-height: 0; }
.wsx__pane { position: absolute; inset: 0; overflow-y: auto; padding: var(--space-5) clamp(16px, 3vw, 32px); display: none; }
.wsx__pane.is-active { display: block; }
.wsx__pane--art.is-active { display: flex; flex-direction: column; padding-bottom: var(--space-4); }

.wsx__narration { font: 600 var(--text-base) var(--font-body); color: var(--color-text); margin-bottom: var(--space-3); }
.wsx__narration .muted { color: var(--color-text-tertiary); font-weight: 400; }
.wsx__brief { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--space-4); align-items: start; }
.wsx-widget { position: relative; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); box-shadow: var(--shadow-sm); overflow: hidden; }
.wsx-widget.is-dragging { opacity: 0.45; }
.wsx-widget__head { display: flex; align-items: center; gap: 8px; padding: 13px 16px; border-bottom: 1px solid var(--color-border); font: 700 var(--text-sm) var(--font-body); }
.wsx-widget__count { margin-left: auto; font: 600 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); background: var(--color-surface); padding: 1px 8px; border-radius: 999px; }
.wsx-widget__body { padding: 8px; max-height: 360px; overflow-y: auto; overscroll-behavior: contain; }
/* Wide widgets (Recently viewed / For you / Activity) flow into the page scroll instead
   of trapping the wheel in a 360px inner scroller that competes with the pane. */
.wsx-widget--wide .wsx-widget__body { max-height: none; overflow: visible; }
.wsx-widget--wide { grid-column: span 2; }
.wsx-widget[data-span="1"] { grid-column: span 1; }
.wsx-widget[data-span="2"] { grid-column: span 2; }
.wsx-widget__grip { width: 22px; height: 26px; display: grid; place-items: center; border: 0; background: transparent; color: var(--color-text-tertiary); cursor: grab; opacity: 0; transition: opacity var(--duration-fast); margin: -4px 0 -4px -6px; flex: none; }
.wsx-widget:hover .wsx-widget__grip { opacity: 1; }
.wsx-widget__grip:active { cursor: grabbing; }
.wsx-widget__rz { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; opacity: 0; transition: opacity var(--duration-fast); z-index: 3; }
.wsx-widget__rz::after { content: ''; position: absolute; right: 3px; bottom: 3px; width: 8px; height: 8px; border-right: 2px solid var(--color-text-tertiary); border-bottom: 2px solid var(--color-text-tertiary); border-bottom-right-radius: 3px; }
.wsx-widget:hover .wsx-widget__rz { opacity: 0.8; }
.wsx-widget__rz:hover { opacity: 1; }
.wsx-empty { padding: 22px 14px; text-align: center; font-size: var(--text-sm); color: var(--color-text-tertiary); }

.wsx-ev { display: flex; gap: 10px; align-items: flex-start; padding: 9px 10px; border-radius: var(--radius-md); cursor: pointer; transition: background var(--duration-fast); text-decoration: none; color: inherit; }
.wsx-ev:hover { background: var(--color-surface); }
.wsx-ev__ic { width: 28px; height: 28px; flex: none; border-radius: 8px; display: grid; place-items: center; background: var(--color-primary-light); color: var(--color-primary); }
.wsx-ev__ic img { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; }
.wsx-ev__main { min-width: 0; flex: 1; }
.wsx-ev__top { font: 600 var(--text-sm) var(--font-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-ev__sum { font-size: var(--text-xs); color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-ev__time { font-size: var(--text-xs); color: var(--color-text-tertiary); flex: none; }
.wsx-ev[data-kind="alert"] .wsx-ev__ic { background: var(--color-warning-light); color: var(--color-warning); }
.wsx-ev[data-kind="run"] .wsx-ev__ic { background: var(--color-success-light); color: var(--color-success); }
/* aggregated Pulse rows read quieter than actionable rows */
.wsx-ev--pulse { opacity: .82; }
.wsx-ev__cnt { font: 700 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); flex: none; background: var(--color-surface); padding: 1px 7px; border-radius: 999px; }
.wsx__pulsehead { padding: 14px 12px 4px 24px; font: 700 var(--text-xs) var(--font-body); letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-tertiary); }
/* activity controls: window segments + admin gear */
.wsx__actbar { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--color-border); }
.wsx__winseg { display: inline-flex; background: var(--color-surface); border-radius: 8px; padding: 2px; }
.wsx__winseg button { border: 0; background: transparent; color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); padding: 3px 9px; border-radius: 6px; cursor: pointer; }
.wsx__winseg button.is-on { background: var(--color-bg-elevated); color: var(--color-text); }
.wsx__actgear { margin-left: auto; border: 0; background: transparent; color: var(--color-text-tertiary); cursor: pointer; display: inline-flex; padding: 4px; border-radius: 6px; }
.wsx__actgear:hover { color: var(--color-text); background: var(--color-surface); }
/* event-visibility settings overlay */
.wsx__evsettings { position: absolute; inset: 0; background: var(--color-bg-elevated); overflow-y: auto; padding: 8px; z-index: 5; }
.wsx__evrow { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid var(--color-border); }
.wsx__evrow b { font: 600 var(--text-sm) var(--font-body); display: block; }
.wsx__evrow small { color: var(--color-text-tertiary); font-size: var(--text-xs); }
.wsx__evrow select { margin-left: auto; flex: none; font: 600 var(--text-xs) var(--font-body); padding: 4px 6px; border: 1px solid var(--color-border); border-radius: 7px; background: var(--color-bg-elevated); color: var(--color-text); }
.wsx__evtier { font-size: 9px; letter-spacing: .05em; text-transform: uppercase; padding: 1px 5px; border-radius: 4px; background: var(--color-surface); color: var(--color-text-tertiary); }
.wsx__evhead { display: flex; align-items: center; gap: 8px; padding: 8px 6px 12px; }
.wsx__evhead b { font: 700 var(--text-sm) var(--font-body); }
.wsx__evclose { margin-left: auto; border: 0; background: transparent; font-size: 15px; cursor: pointer; color: var(--color-text-secondary); }
.wsx__viewtitle { font: 700 var(--text-h3) var(--font-display, var(--font-body)); margin-bottom: var(--space-4); }
.wsx__view { display: none; }
.wsx__view.is-active { display: block; }

/* real brand lockup in the rail */
.wsx .brand { display: flex; align-items: center; gap: 8px; text-decoration: none; min-width: 0; }
.wsx .brand-mark { display: block; flex: none; }
.wsx .brand-name { font: 800 var(--text-base) var(--font-display, var(--font-body)); color: var(--color-text); white-space: nowrap; }
.wsx.is-rail-collapsed .brand-name { display: none; }
/* workspace-branded logo (customer subdomain) replaces the ShareOut lockup */
.wsx .brand-ws { display: flex; align-items: center; text-decoration: none; min-width: 0; }
.wsx .brand-ws-logo { display: block; height: 34px; max-width: 168px; width: auto; object-fit: contain; }
.wsx.is-rail-collapsed .brand-ws-logo { height: 30px; max-width: 40px; object-fit: contain; }

/* All Artifacts filter chips */
.wsx__chips { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: var(--space-4); }
.wsx-chip { padding: 6px 13px; border-radius: 999px; border: 1.5px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; transition: border-color var(--duration-fast), color var(--duration-fast), background var(--duration-fast); }
.wsx-chip:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-chip.is-on { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); }
/* Quick Search input (artifacts lens) — right-aligned control cluster in the chips row */
.wsx__chips-right { display: flex; align-items: center; gap: 8px; margin-left: auto; }
.wsx-qsearch { position: relative; display: inline-flex; align-items: center; }
.wsx-qsearch svg { position: absolute; left: 12px; width: 15px; height: 15px; color: var(--color-text-tertiary); pointer-events: none; }
.wsx-qsearch input { width: 210px; max-width: 100%; padding: 7px 12px 7px 33px; border-radius: 999px; border: 1.5px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-text); font: 500 var(--text-sm) var(--font-body); transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx-qsearch input::placeholder { color: var(--color-text-tertiary); }
.wsx-qsearch input:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
@media (max-width: 640px) { .wsx__chips-right { flex: 1 1 100%; margin-left: 0; } .wsx-qsearch { flex: 1 1 100%; } .wsx-qsearch input { width: 100%; } }
/* command palette + inline quick-jump styles live in styles-palette.ts (concatenated below). */

/* Create with AI mode */
.wsx__chero { margin-bottom: var(--space-5); }
.wsx__csub { color: var(--color-text-secondary); font-size: var(--text-sm); margin-top: 4px; max-width: 60ch; }
.wsx__ccols { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-4); }
.wsx-cpanel { border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); padding: 14px 16px; }
.wsx-clarify { align-self: flex-start; max-width: 94%; padding: 11px 13px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); }
.wsx-clarify__q { font: 600 var(--text-sm) var(--font-body); margin-bottom: 8px; }
.wsx-clarify__opts, .wsx-suggest { display: flex; flex-wrap: wrap; gap: 6px; }
.wsx.is-create .wsx__thread { max-height: 52vh; }
@media (max-width: 900px) { .wsx__ccols { grid-template-columns: 1fr; } .wsx__brief { grid-template-columns: 1fr; } .wsx-widget, .wsx-widget--wide, .wsx-widget[data-span="2"], .wsx-widget[data-span="1"] { grid-column: auto; } }

/* list rows (schedules / alerts) */
.wsx-list { display: flex; flex-direction: column; gap: 8px; }
.wsx-row { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); }
.wsx-row__main { flex: 1; min-width: 0; }
.wsx-row__title { font: 600 var(--text-sm) var(--font-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-row__sub { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-row__badge { font: 600 var(--text-xs) var(--font-body); padding: 2px 9px; border-radius: 999px; background: var(--color-surface); color: var(--color-text-secondary); flex: none; }
.wsx-row__badge.ok { background: var(--color-success-light); color: var(--color-success); }
.wsx-row__badge.fail { background: var(--color-error-light); color: var(--color-error); }

`;
