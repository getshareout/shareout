/** Catalog lens styles — appended into WORKSPACE_STYLES. Kept separate so styles.ts
 *  stays under the per-module line cap. Uses the shared .wsx design tokens. */
import { WORKSPACE_ONBOARDING_STYLES } from './styles-onboarding';
import { WORKSPACE_KNOWLEDGE_STYLES } from './styles-knowledge';

export const WORKSPACE_CATALOG_STYLES = WORKSPACE_ONBOARDING_STYLES + WORKSPACE_KNOWLEDGE_STYLES + `
/* ---- Catalog lens ---- */
.wsx-cat__onboard { text-align: center; padding: 40px 16px; display: flex; flex-direction: column; align-items: center; gap: 8px; }
.wsx-cat__onboard p { margin: 0; color: var(--color-text); }
.wsx-cat__hint { font-size: var(--text-sm); color: var(--color-text-tertiary); max-width: 420px; line-height: 1.55; }
.wsx-cat__onboard .so-c-btn, .wsx-cat__onboard button { margin-top: 10px; }
.wsx-cat__kpis { margin-bottom: 16px; }
.wsx-cat__controls { position: sticky; top: 0; z-index: 3; background: var(--color-bg); padding: 2px 0 12px; }
.wsx-cat__bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.wsx-cat__search { flex: 1; min-width: 200px; box-sizing: border-box; padding: 9px 13px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text); font: 400 var(--text-sm) var(--font-body); }
.wsx-cat__search:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.wsx-cat__seg { flex-wrap: wrap; max-width: 100%; }
.wsx-cat__sel { padding: 8px 28px 8px 10px; }
.wsx-cat__count { font: 600 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); margin-left: auto; white-space: nowrap; }
.wsx-cat__row { cursor: pointer; }
.wsx-cat__cdom { color: var(--color-text-secondary); }
.wsx-cat__corigin { color: var(--color-text-tertiary); font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-xs); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-cat__clin { white-space: nowrap; }
.wsx-cat__lc { font-variant-numeric: tabular-nums; color: var(--color-text-secondary); }
.wsx-cat__lc.z { color: var(--color-border-strong); }
.wsx-cat__tag { font: 500 var(--text-xs) var(--font-mono, ui-monospace, monospace); color: var(--color-text-secondary); background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-sm); padding: 1px 7px; }
.wsx-sched__badge.warn { background: color-mix(in srgb, var(--color-warning) 16%, transparent); color: var(--color-warning); }
.wsx-sched__badge.draft { background: var(--color-surface); color: var(--color-text-tertiary); }
.wsx-cat__back { border: 0; background: transparent; color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; padding: 0; margin-bottom: 10px; }
.wsx-cat__back:hover { color: var(--color-primary); }
.wsx-cat__dhead { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
.wsx-cat__dhead h3 { font: 700 var(--text-h3) var(--font-display, var(--font-body)); margin: 0; }
.wsx-cat__meta { display: grid; grid-template-columns: 130px 1fr; gap: 6px 16px; margin: 16px 0; font-size: var(--text-sm); }
.wsx-cat__meta dt { color: var(--color-text-tertiary); }
.wsx-cat__meta dd { margin: 0; color: var(--color-text); font-family: var(--font-mono, ui-monospace, monospace); font-size: var(--text-sm); overflow-wrap: anywhere; }
.wsx-cat__body { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 16px 18px; color: var(--color-text); line-height: 1.6; font-size: var(--text-sm); }
.wsx-cat__body p { margin: 0 0 8px; } .wsx-cat__body p:last-child { margin-bottom: 0; }
.wsx-cat__body .wsx-h { font: 700 var(--text-base) var(--font-display, var(--font-body)); margin: 12px 0 5px; } .wsx-cat__body .wsx-h:first-child { margin-top: 0; }
.wsx-cat__body .wsx-ul, .wsx-cat__body .wsx-ol { margin: 5px 0 9px; padding-left: 20px; } .wsx-cat__body li { margin: 2px 0; }
.wsx-cat__body code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.9em; background: var(--color-surface); padding: 1px 5px; border-radius: 5px; }
.wsx-cat__body .wsx-pre { margin: 8px 0; padding: 11px 13px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-md); overflow-x: auto; }
.wsx-cat__body .wsx-pre code { background: transparent; padding: 0; font-size: 0.85em; line-height: 1.5; white-space: pre; }
.wsx-cat__body .wsx-bq { margin: 8px 0; padding: 2px 0 2px 11px; border-left: 3px solid var(--color-border-strong); color: var(--color-text-secondary); }
.wsx-cat__body .wsx-hr { border: 0; border-top: 1px solid var(--color-border); margin: 10px 0; }
.wsx-cat__body a { color: var(--color-primary); }
.wsx-cat__lin { margin-top: 22px; }
.wsx-cat__linhead { display: flex; align-items: baseline; gap: 8px; margin: 18px 0 8px; font: 700 var(--text-base) var(--font-display, var(--font-body)); }
.wsx-cat__lcount { font: 700 var(--text-xs) var(--font-body); color: var(--color-text-inverse); background: var(--color-text-tertiary); border-radius: 999px; padding: 1px 8px; }
.wsx-cat__linhint { font: 400 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); margin-left: auto; }
.wsx-cat__lintable tbody tr { cursor: pointer; }
.wsx-cat__lintable td { padding: 8px 12px; }
.wsx-cat__linrow.z, .wsx-cat__linrow.z:hover { cursor: default; background: transparent; }
.wsx-cat__unc { font-size: var(--text-xs); color: var(--color-text-tertiary); background: var(--color-surface); border-radius: 999px; padding: 0 7px; margin-left: 4px; }
.wsx-cat__linnone { color: var(--color-text-tertiary); font-size: var(--text-sm); padding: 6px 2px 4px; }
@media (max-width: 560px) { .wsx-cat__meta { grid-template-columns: 1fr; gap: 2px 0; } .wsx-cat__meta dt { margin-top: 8px; } }

/* ---- Knowledge lens (structural sibling — shares the wsx-cat__* patterns above) ---- */
.wsx-kn__bdg { margin-left: 8px; vertical-align: middle; }
.wsx-kn__fresh { margin-top: 14px; color: var(--color-text-tertiary); font-size: var(--text-xs); }
.wsx-kn__controls { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 18px; }
.wsx-kn__danger { color: var(--color-error); }
.wsx-kn__srclink { cursor: pointer; }
.wsx-kn__edit textarea { width: 100%; box-sizing: border-box; min-height: 260px; padding: 12px 14px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text); font: 400 var(--text-sm) var(--font-mono, ui-monospace, monospace); line-height: 1.55; resize: vertical; }
.wsx-kn__edit textarea:focus { outline: none; border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }

/* ---- Device (mobile/web) preview toggle, beside the View/Edit toggle ---- */
.wsx__tabdevice { display: inline-grid; place-items: center; flex: none; width: 32px; height: 32px; border: 0; border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast); }
.wsx__tabdevice[hidden] { display: none; }
.wsx__tabdevice:hover { color: var(--color-text); }
.wsx__tabdevice.is-on { background: var(--color-primary-light); color: var(--color-primary); }
.wsx__tabdevice svg { width: 17px; height: 17px; }

/* ---- Composer centering: track the real right column (0 on Home) ---- */
.wsx.is-home { --wsx-rightcol: 0px; }

/* ---- Account menu docked in the right-sidebar region (over the inspector; opens the rail on Home) ---- */
.wsx__accpanel { position: absolute; top: 12px; right: 12px; bottom: 12px; z-index: 45; width: calc(var(--wsx-act) - 12px); display: flex; flex-direction: column; background: var(--glass-bg-strong); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); border: 1px solid var(--color-border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); overflow: hidden; }
.wsx__accpanel[hidden] { display: none; }
.wsx__accpanel-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 10px 10px 14px; border-bottom: 1px solid var(--color-border); flex: none; }
.wsx__accpanel-head .wsx__accmenu-head { padding: 0; }
.wsx__accpanel-close { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border: 0; background: transparent; color: var(--color-text-tertiary); border-radius: var(--radius-sm); cursor: pointer; }
.wsx__accpanel-close:hover { background: var(--color-surface); color: var(--color-text); }
.wsx__accpanel-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px 8px 14px; }
@media (max-width: 720px) { .wsx__accpanel { top: 0; right: 0; bottom: 0; width: min(88vw, 340px); border-radius: 0; } }
.wsx-home-lang { display: inline-flex; gap: 6px; padding: 0 8px 8px; }
.home-lang-btn { padding: 7px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); font: 600 var(--text-sm) var(--font-body); color: var(--color-text-secondary); cursor: pointer; }
.home-lang-btn:hover { border-color: var(--color-border-strong); color: var(--color-text); }
.home-lang-btn.is-on, .home-lang-btn[aria-selected="true"] { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); }
`;
