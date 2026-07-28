/**
 * Lens views: artifact stage, schedules, analytics, connectors, and admin.
 * Split out of styles.ts to stay under the per-module line cap; concatenated into
 * WORKSPACE_STYLES in the same cascade position so order is unchanged.
 */
export const WORKSPACE_LENSES_STYLES = `/* ---- artifact stage (per tab) ---- */
.wsx__stagebar { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-3); flex: none; }
.wsx__stagebar .js-title { font: 700 var(--text-h3) var(--font-display, var(--font-body)); }
.wsx__stagebar a { font-size: var(--text-sm); color: var(--color-primary); text-decoration: none; }
.wsx__toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-bottom: var(--space-3); flex: none; }
.wsx-abtn { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 12px; border-radius: var(--radius-md); border: 1.5px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; transition: border-color var(--duration-fast), color var(--duration-fast), background var(--duration-fast); }
.wsx-abtn:hover { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
.wsx-caret { opacity: 0.7; font-size: 10px; }
.wsx__deliver { position: relative; }
.wsx__deliver-menu { position: absolute; top: calc(100% + 6px); left: 0; z-index: 5; min-width: 150px; padding: 6px; display: flex; flex-direction: column; gap: 2px; background: var(--glass-bg-strong); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl); }
.wsx__deliver-menu[hidden] { display: none; }
.wsx__deliver-menu button { padding: 8px 11px; border: 0; border-radius: var(--radius-sm); background: transparent; text-align: left; font: 600 var(--text-sm) var(--font-body); color: var(--color-text); cursor: pointer; }
.wsx__deliver-menu button:hover { background: var(--color-primary-light); color: var(--color-primary); }
.wsx__stagepanel { margin-bottom: var(--space-3); padding: 14px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); box-shadow: var(--shadow-sm); flex: none; }
.wsx__stagepanel[hidden] { display: none; }
.wsx-stat-row { display: flex; gap: var(--space-5); flex-wrap: wrap; margin-bottom: var(--space-3); }
.wsx-stat__n { font: 700 var(--text-h3) var(--font-body); line-height: 1.1; }
.wsx-stat__l { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-spark { display: flex; align-items: flex-end; gap: 3px; height: 44px; }
.wsx-spark span { flex: 1; min-width: 3px; background: var(--color-primary); border-radius: 2px 2px 0 0; opacity: 0.85; }
.wsx-panel-title { font: 700 var(--text-sm) var(--font-body); margin-bottom: 10px; }
.wsx-vwr { display: flex; justify-content: space-between; gap: 8px; padding: 4px 0; font-size: 13px; }
.wsx-vwr__n { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-vwr__more { margin-top: var(--space-2); background: none; border: 0; padding: 0; color: var(--color-primary); font-size: 12px; cursor: pointer; }
/* ---- Lens intro + quick-action tiles (Schedules / Alerts empty states) ---- */
.wsx-lens__intro { font-size: var(--text-sm); color: var(--color-text-secondary); line-height: 1.55; max-width: 540px; margin: 0 0 16px; }
.wsx-qa-grid--lens { max-width: 560px; }
/* ---- My Schedules — Airflow-style cards ---- */
.wsx-sched { padding: 14px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); box-shadow: 0 1px 2px rgba(28,25,23,0.04); margin-bottom: 10px; }
.wsx-sched__head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
.wsx-sched__title { font: 600 var(--text-base) var(--font-body); color: var(--color-text); display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0; }
.wsx-sched__title svg { width: 16px; height: 16px; color: var(--color-text-tertiary); flex: none; }
.wsx-sched__badge { flex: none; font: 600 var(--text-xs) var(--font-body); padding: 2px 9px; border-radius: 999px; background: var(--color-surface); color: var(--color-text-tertiary); text-transform: capitalize; }
.wsx-sched__badge.ok { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.wsx-sched__badge.fail { background: color-mix(in srgb, var(--color-danger, var(--color-error)) 14%, transparent); color: var(--color-danger, var(--color-error)); }
.wsx-sched__flow { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 10px; }
.wsx-sched__chip { display: inline-flex; align-items: center; gap: 5px; max-width: 220px; padding: 3px 9px; border-radius: 999px; border: 1px solid var(--color-border); background: var(--color-surface); font: 600 var(--text-xs) var(--font-body); color: var(--color-text-secondary); }
.wsx-sched__chip svg, .wsx-sched__chip img { width: 14px; height: 14px; flex: none; }
.wsx-sched__chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-sched__chip.is-origin { color: var(--color-primary); border-color: color-mix(in srgb, var(--color-primary) 30%, transparent); background: var(--color-primary-light); }
.wsx-sched__chip.is-dest { color: var(--color-text); }
.wsx-sched__arrow { color: var(--color-text-tertiary); display: inline-flex; }
.wsx-sched__arrow svg { width: 15px; height: 15px; }
.wsx-sched__meta { display: flex; flex-wrap: wrap; gap: 14px; font-size: var(--text-xs); color: var(--color-text-tertiary); margin-bottom: 10px; }
.wsx-sched__when { display: inline-flex; align-items: center; gap: 5px; color: var(--color-text-secondary); font-weight: 600; }
.wsx-sched__when svg { width: 13px; height: 13px; }
.wsx-runbars { display: flex; align-items: flex-end; gap: 2px; height: 22px; }
.wsx-runbar { width: 5px; height: 100%; border-radius: 2px; background: var(--color-border-strong); }
.wsx-runbar.is-ok { background: var(--color-success); }
.wsx-runbar.is-fail { background: var(--color-danger, var(--color-error)); }
.wsx-runbar.is-pend { background: var(--color-warning); }
.wsx-runbar.is-click { cursor: pointer; }
.wsx-runbar.is-click:hover { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.wsx-sched__noruns { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-runs-link { display: inline-block; margin: 0 0 12px; font: 600 var(--text-xs) var(--font-body, inherit); color: var(--color-primary); text-decoration: none; }
.wsx-runs-link:hover { text-decoration: underline; }
/* ---- Analytics — roll-up cards, chart, top lists ---- */
.wsx-an__top { display: flex; justify-content: flex-end; margin-bottom: 14px; }
.wsx-an__rangeseg, .wsx-an__seg { font: 600 var(--text-xs) var(--font-body); }
.wsx-an__rangeseg { display: inline-flex; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 999px; padding: 2px; gap: 2px; }
.wsx-an__seg { padding: 4px 12px; border: 0; background: transparent; color: var(--color-text-secondary); border-radius: 999px; cursor: pointer; }
.wsx-an__seg.is-on { background: var(--color-bg-elevated); color: var(--color-text); box-shadow: var(--shadow-sm); }
.wsx-an__cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-bottom: 18px; }
.wsx-an__card { position: relative; padding: 16px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); }
.wsx-an__n { font: 700 var(--text-h3) var(--font-display, var(--font-body)); line-height: 1.05; }
.wsx-an__u { font-size: var(--text-sm); color: var(--color-text-tertiary); font-weight: 600; margin-left: 2px; }
.wsx-an__l { font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: 3px; }
.wsx-an__delta { position: absolute; top: 14px; right: 14px; font: 600 var(--text-xs) var(--font-body); padding: 1px 7px; border-radius: 999px; }
.wsx-an__delta.up { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 14%, transparent); }
.wsx-an__delta.down { color: var(--color-danger, var(--color-error)); background: color-mix(in srgb, var(--color-danger, var(--color-error)) 14%, transparent); }
.wsx-an__delta.flat { color: var(--color-text-tertiary); background: var(--color-surface); }
.wsx-an__chart { margin-bottom: 20px; }
.wsx-an__chart .wsx-spark { height: 72px; }
.wsx-an__cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px; }
.wsx-an__panel { padding: 14px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); }
.wsx-an__bar { display: flex; align-items: center; gap: 10px; padding: 5px 0; }
.wsx-an__barname { flex: 0 0 38%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-an__bartrack { flex: 1; height: 7px; border-radius: 999px; background: var(--color-surface); overflow: hidden; }
.wsx-an__bartrack span { display: block; height: 100%; background: var(--color-primary); border-radius: 999px; }
.wsx-an__barval { flex: none; font: 600 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); min-width: 28px; text-align: right; }
/* ---- shared lens bits: code chips, card actions, brief message ---- */
.wsx__view code { font: 600 0.85em ui-monospace, SFMono-Regular, Menlo, monospace; background: var(--color-surface); padding: 1px 6px; border-radius: 6px; color: var(--color-text); }
.wsx-sched__actions { display: flex; gap: 8px; margin-top: 10px; }
.wsx-sched__actions .wsx-abtn { min-height: 30px; padding: 0 12px; font-size: var(--text-xs); }
.wsx-abtn.danger:hover { border-color: var(--color-danger, var(--color-error)); color: var(--color-danger, var(--color-error)); background: color-mix(in srgb, var(--color-danger, var(--color-error)) 10%, transparent); } .wsx-abtn.is-on { border-color: var(--color-success); color: var(--color-success); background: color-mix(in srgb, var(--color-success) 12%, transparent); } .wsx-abtn--primary.is-on { color: var(--color-text-inverse); background: var(--color-success); } .wsx-skill__md { max-height: 52vh; overflow: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-subtle, var(--color-bg-elevated)); padding: 12px 14px; } .wsx-skill__pre { margin: 0; white-space: pre-wrap; word-break: break-word; font: var(--text-xs)/1.6 var(--font-mono, ui-monospace, monospace); color: var(--color-text); } .wsx-skill__foot { display: flex; flex-direction: column; gap: 10px; margin-top: 14px; } .wsx-skill__hint { color: var(--color-text-secondary); font-size: var(--text-xs); } .wsx-skill__btns { display: flex; flex-wrap: wrap; gap: 8px; }
.wsx-msg--brief { align-self: stretch; max-width: 100%; background: var(--color-primary-light); color: var(--color-text); border: 1px solid color-mix(in srgb, var(--color-primary) 25%, transparent); line-height: 1.55; }
/* ---- Connectors lens ---- */
.wsx-conn__cat { font: 700 var(--text-xs) var(--font-body); text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); margin: 18px 0 10px; }
.wsx-conn__cat:first-child { margin-top: 0; }
.wsx-conn__grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 12px; }
.wsx-conn__card { display: flex; flex-direction: column; gap: 10px; padding: 14px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); }
.wsx-conn__top { display: flex; align-items: flex-start; gap: 10px; }
.wsx-conn__ic { width: 34px; height: 34px; flex: none; display: grid; place-items: center; border-radius: var(--radius-md); background: var(--color-surface); }
.wsx-conn__ic svg { width: 20px; height: 20px; }
.wsx-conn__name { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); display: flex; align-items: center; gap: 7px; }
.wsx-conn__on { font: 600 10px var(--font-body); color: var(--color-success); background: color-mix(in srgb, var(--color-success) 14%, transparent); padding: 1px 7px; border-radius: 999px; }
.wsx-conn__tag { font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: 2px; line-height: 1.4; }
.wsx-conn__insts { display: flex; flex-direction: column; gap: 6px; }
.wsx-conn__inst { display: flex; align-items: center; gap: 8px; padding: 6px 9px; border-radius: var(--radius-sm); background: var(--color-surface); }
.wsx-conn__instname { flex: 1; font: 600 var(--text-xs) var(--font-body); color: var(--color-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-conn__ai { display: inline-flex; align-items: center; gap: 4px; font: 600 11px var(--font-body); color: var(--color-text-tertiary); cursor: pointer; }
.wsx-conn__del { border: 0; background: transparent; color: var(--color-text-tertiary); font-size: 16px; line-height: 1; cursor: pointer; padding: 0 2px; }
.wsx-conn__del:hover { color: var(--color-danger, var(--color-error)); }
.wsx-conn__add { justify-content: center; margin-top: auto; }
/* ---- Admin lens ---- */
.wsx-admin__invite { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.wsx-admin__email { flex: 1; min-width: 200px; box-sizing: border-box; padding: 8px 12px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text); font: 400 var(--text-sm) var(--font-body); }
.wsx-admin__email:focus { outline: none; border-color: var(--color-primary); }
.wsx-admin__role { appearance: none; -webkit-appearance: none; padding: 8px 30px 8px 10px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23737373' stroke-width='2.5' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center; color: var(--color-text); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-admin__role:hover { border-color: var(--color-primary); }
.wsx-admin__role:focus { outline: none; border-color: var(--color-primary); }
.wsx-admin__list { display: flex; flex-direction: column; gap: 8px; }
.wsx-admin__row { display: flex; align-items: center; gap: 12px; padding: 11px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); }
.wsx-admin__who { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wsx-admin__nm { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); }
.wsx-admin__sub { font-size: var(--text-xs); color: var(--color-text-tertiary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-admin__rolebadge { flex: none; font: 600 var(--text-xs) var(--font-body); padding: 2px 9px; border-radius: 999px; background: var(--color-surface); color: var(--color-text-tertiary); text-transform: capitalize; }
.wsx-admin__rolebadge.is-owner { background: var(--color-primary-light); color: var(--color-primary); }
.wsx-admin__rolebadge.is-admin { background: color-mix(in srgb, var(--color-primary) 12%, transparent); color: var(--color-primary); }
.wsx-admin__rolebadge.is-on { background: color-mix(in srgb, var(--color-success) 14%, transparent); color: var(--color-success); }
.wsx-admin__rolebadge.is-off { background: var(--color-surface); color: var(--color-text-tertiary); }
.wsx-admin__opts { display: flex; flex-direction: column; gap: 10px; max-width: 560px; }
.wsx-admin__opt { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; text-align: left; padding: 14px 16px; border: 1.5px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); cursor: pointer; }
.wsx-admin__opt.is-sel { border-color: var(--color-primary); background: var(--color-primary-light); }
.wsx-admin__optt { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); }
.wsx-admin__opts2 { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-admin__apprv { margin-top: 12px; font-size: var(--text-sm); color: var(--color-text-secondary); }
.wsx-admin__apprv input { width: 56px; margin-left: 8px; padding: 5px 8px; border: 1.5px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg-elevated); color: var(--color-text); }
.wsx-admin__brand { display: flex; gap: 18px; align-items: flex-start; flex-wrap: wrap; }
.wsx-admin__logo { width: 84px; height: 84px; flex: none; display: grid; place-items: center; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-surface); overflow: hidden; }
.wsx-admin__logo img { max-width: 100%; max-height: 100%; }
.wsx-admin__logo--empty { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-admin__logocol { display: flex; flex-direction: column; gap: 8px; align-items: stretch; }
.wsx-admin__logobtn { justify-content: center; min-height: 30px; font-size: var(--text-xs); }
.wsx-admin__rolesel { padding: 5px 8px; }
.wsx-admin__brandfields { display: flex; flex-direction: column; gap: 12px; }
.wsx-admin__field { display: inline-flex; align-items: center; gap: 10px; font: 600 var(--text-sm) var(--font-body); color: var(--color-text-secondary); }
.wsx-admin__field input[type=color] { width: 40px; height: 28px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: none; cursor: pointer; }
.wsx-admin__check { display: inline-flex; align-items: center; gap: 8px; font-size: var(--text-sm); color: var(--color-text-secondary); cursor: pointer; }
.wsx-admin__savemsg { font-size: var(--text-xs); color: var(--color-success); margin-left: 10px; }
/* Overview — needs-attention list */
.wsx-admin__attn { display: flex; flex-direction: column; gap: 6px; }
.wsx-admin__attnrow { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text); font: 600 var(--text-sm) var(--font-body); cursor: pointer; transition: border-color var(--duration-fast), background var(--duration-fast); }
.wsx-admin__attnrow:hover { border-color: var(--color-primary); background: var(--color-surface); }
.wsx-admin__attngo { margin-left: auto; color: var(--color-text-tertiary); }
/* Admin overview cards */
.wsx-admin__cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 20px; }
.wsx-admin__card { padding: 14px 16px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); }
.wsx-admin__planpush { border-color: var(--color-primary); background: var(--color-primary-light, color-mix(in srgb, var(--color-primary) 7%, transparent)); }
.wsx-admin__cardlbl { font-size: var(--text-xs); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: .04em; margin-bottom: 6px; }
.wsx-admin__cardval { font: 700 var(--text-lg) var(--font-body); color: var(--color-text); display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wsx-admin__cardsub { font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: 4px; }
.wsx-admin__seatbar { margin-top: 8px; height: 4px; background: var(--color-surface); border-radius: 2px; overflow: hidden; }
.wsx-admin__seatfill { height: 100%; background: var(--color-primary); border-radius: 2px; }
/* Admin badge extras */
.wsx-admin__rolebadge.is-trial { background: color-mix(in srgb, var(--color-warning) 14%, transparent); color: var(--color-warning); }
.wsx-admin__rolebadge.is-warn { background: color-mix(in srgb, var(--color-error) 14%, transparent); color: var(--color-error); }
/* Artifacts governance table */
/* Visibility filter — a segmented control, visually distinct from the pill tab bar above. */
.wsx-admin__artfilter.wsx__chips { display: inline-flex; flex-wrap: wrap; gap: 2px; margin-bottom: 14px; padding: 3px; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: 999px; }
.wsx-admin__artfilter.wsx__chips .wsx-chip { min-height: 0; padding: 5px 13px; border: none; background: transparent; color: var(--color-text-secondary); border-radius: 999px; font: 600 var(--text-xs) var(--font-body); }
.wsx-admin__artfilter.wsx__chips .wsx-chip:hover { background: var(--color-bg-elevated); color: var(--color-text); }
.wsx-admin__artfilter.wsx__chips .wsx-chip.is-on { background: var(--color-primary); color: var(--color-text-inverse); }
.wsx-atbl__wrap { overflow-x: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.wsx-atbl { width: 100%; border-collapse: collapse; font-size: var(--text-sm); }
.wsx-atbl th, .wsx-atbl td { padding: 8px 10px; border-bottom: 1px solid var(--color-border); text-align: left; white-space: nowrap; }
.wsx-atbl tr:last-child td { border-bottom: 0; }
.wsx-atbl th { font: 600 var(--text-xs) var(--font-body); color: var(--color-text-secondary); background: var(--color-surface); text-transform: uppercase; letter-spacing: .04em; cursor: pointer; user-select: none; }
.wsx-atbl th:hover { color: var(--color-text); }
.wsx-atbl th.is-sort { color: var(--color-primary); }
.wsx-atbl tbody tr:hover { background: var(--color-surface); }
.wsx-atbl__link { color: var(--color-text); text-decoration: none; font-weight: 600; }
.wsx-atbl__link:hover { color: var(--color-primary); }
.wsx-atbl__type { font-size: var(--text-xs); color: var(--color-text-tertiary); background: var(--color-surface); padding: 1px 6px; border-radius: 4px; margin-left: 4px; }
.wsx-atbl__date, .wsx-atbl__owner { color: var(--color-text-secondary); }
.wsx-atbl__owner { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
.wsx-atbl__num { color: var(--color-text-secondary); font-variant-numeric: tabular-nums; text-align: right; }
.wsx-atbl tr.is-paused td { opacity: 0.55; }
.wsx-admin__ctxedit { width: 100%; min-height: 220px; margin-top: 10px; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text); font: 400 var(--text-sm)/1.5 var(--font-mono, ui-monospace, monospace); resize: vertical; }
.wsx-admin__ctxedit:focus { outline: none; border-color: var(--color-primary); }
.wsx-atbl__flag { display: inline-block; margin-left: 6px; font-size: var(--text-xs); font-weight: 600; color: var(--color-text-tertiary); background: var(--color-surface); border: 1px solid var(--color-border); padding: 0 6px; border-radius: 999px; }
.wsx-atbl__actions { white-space: nowrap; text-align: right; }
.wsx-atbl__act { min-height: 26px; padding: 0 9px; margin-left: 4px; border-radius: var(--radius-sm); border: 1.5px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; transition: border-color var(--duration-fast), color var(--duration-fast); }
.wsx-atbl__act:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-atbl__act:disabled { opacity: 0.5; cursor: default; }
/* Security: Audit log */
.wsx-admin__auditfeed { display: flex; flex-direction: column; gap: 4px; }
.wsx-admin__audit-row { display: grid; grid-template-columns: auto 1fr auto; align-items: baseline; gap: 8px; padding: 9px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); font-size: var(--text-sm); }
.wsx-admin__audit-actor { font-weight: 600; color: var(--color-text); }
.wsx-admin__audit-action { color: var(--color-text-secondary); }
.wsx-admin__audit-ts { font-size: var(--text-xs); color: var(--color-text-tertiary); }
/* Access policy: domain tags */
.wsx-admin__domain-list { display: flex; flex-wrap: wrap; gap: 6px; margin: 8px 0 10px; min-height: 24px; }
.wsx-admin__domain-tag { display: inline-flex; align-items: center; gap: 4px; padding: 3px 8px; background: var(--color-primary-light); color: var(--color-primary); border-radius: 999px; font-size: var(--text-xs); font-weight: 600; }
.wsx-admin__domain-rm { border: 0; background: transparent; color: var(--color-primary); font-size: 14px; line-height: 1; cursor: pointer; padding: 0 0 0 2px; }
.wsx-admin__domain-add { display: flex; gap: 8px; align-items: center; }
/* Settings sections */
.wsx-admin__settings-section { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--color-border); }
.wsx-admin__settings-section:first-child { margin-top: 0; padding-top: 0; border-top: 0; }
.wsx-admin__settings-title { font: 700 var(--text-sm) var(--font-body); color: var(--color-text); margin-bottom: 14px; }
/* Compartir — list header, empty state, inline add form (replaces the add-client modal) */ .wsx-clients__bar { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 18px; } .wsx-clients__hd { font: 700 var(--text-lg) var(--font-display, var(--font-body)); color: var(--color-text); letter-spacing: -0.01em; } .wsx-clients__zero { max-width: 560px; } .wsx-clients__zero-hd { font: 700 var(--text-xl) var(--font-display, var(--font-body)); color: var(--color-text); letter-spacing: -0.015em; margin: 0 0 8px; } .wsx-clients__zero-bd { font-size: var(--text-sm); color: var(--color-text-secondary); line-height: 1.6; margin: 0 0 22px; max-width: 500px; } .wsx-clients__steps { list-style: none; margin: 0 0 22px; padding: 0; display: flex; flex-direction: column; gap: 12px; } .wsx-clients__step { display: flex; align-items: center; gap: 12px; } .wsx-clients__step-t { font-size: var(--text-sm); color: var(--color-text); line-height: 1.5; }
.wsx-clients__step-n { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: var(--color-primary-light); color: var(--color-primary); font: 700 var(--text-xs) var(--font-body); } .wsx-clients__add { margin: 0 0 16px; padding: 18px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); display: flex; flex-direction: column; gap: 12px; max-width: 560px; } .wsx-clients__add-row { display: flex; gap: 10px; flex-wrap: wrap; } .wsx-clients__add-actions { display: flex; gap: 8px; }
/* Members: seat utilization bar */
.wsx-admin__seat-util { margin-bottom: 14px; padding: 12px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.wsx-admin__seat-info { flex: 1; min-width: 0; }
.wsx-admin__seat-label { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-admin__seat-count { font: 700 var(--text-base) var(--font-body); color: var(--color-text); }
.wsx-admin__seat-warn { font-size: var(--text-xs); color: var(--color-error); margin-top: 2px; }
`;
