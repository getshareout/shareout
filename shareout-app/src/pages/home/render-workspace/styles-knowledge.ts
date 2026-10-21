/** Knowledge lens (P3a) — two-pane indented tree + Tree|Table toggle + How-it-works.
 *  Appended into WORKSPACE_STYLES. Kept separate so styles.ts stays under the line cap.
 *  Reuses the shared .wsx tokens; the only blue is the 3px selection accent (80/15/5). */
export const WORKSPACE_KNOWLEDGE_STYLES = `
/* ---- Knowledge lens — two-pane tree ---- */
.wsx-kn2 { display: grid; grid-template-columns: minmax(240px, 300px) 1fr; gap: 16px; align-items: start; }
.wsx-kn2__pane { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 14px; box-sizing: border-box; }
.wsx-kn2__treewrap { display: flex; flex-direction: column; gap: 10px; position: sticky; top: 64px; min-width: 0; }
.wsx-kn2__search { width: 100%; }
.wsx-kn2__tree { display: flex; flex-direction: column; gap: 1px; overflow-y: auto; max-height: calc(100vh - 280px); }
.wsx-kn2__detail { min-height: 320px; min-width: 0; }
.wsx-kn2__empty { color: var(--color-text-tertiary); font-size: var(--text-sm); padding: 40px 8px; text-align: center; }

.wsx-kn2__node { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; border-left: 3px solid transparent; background: transparent; cursor: pointer; color: var(--color-text); font: 500 var(--text-sm) var(--font-body); border-radius: var(--radius-sm); padding: 6px 10px; padding-left: calc(10px + attr(data-depth type(<number>), 0) * 16px); transition: background var(--duration-fast); }
.wsx-kn2__node:hover { background: var(--color-surface); }
.wsx-kn2__node.is-sel { background: var(--color-surface); border-left-color: var(--color-primary); }
.wsx-kn2__ico { flex: none; display: inline-flex; color: var(--color-text-tertiary); }
.wsx-kn2__ico svg { width: 14px; height: 14px; }
.wsx-kn2__lbl { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-kn2__tail { flex: none; display: inline-flex; align-items: center; gap: 6px; }
.wsx-kn2__src { font-variant-numeric: tabular-nums; color: var(--color-text-secondary); font-size: var(--text-xs); }
.wsx-kn2__fresh { color: var(--color-text-tertiary); font-size: var(--text-xs); }
.wsx-kn2__node .wsx-kn__bdg { margin-left: 0; }

.wsx-kn2__branch { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; background: transparent; cursor: pointer; color: var(--color-text-secondary); font: 700 var(--text-xs) var(--font-body); text-transform: uppercase; letter-spacing: 0.04em; border-radius: var(--radius-sm); padding: 8px 10px 6px 7px; margin-top: 4px; }
.wsx-kn2__branch:hover { color: var(--color-text); }
.wsx-kn2__chev { display: inline-flex; flex: none; color: var(--color-text-tertiary); transition: transform var(--duration-fast) ease; }
.wsx-kn2__chev svg { width: 12px; height: 12px; }
.wsx-kn2__chev.is-open { transform: rotate(90deg); }
.wsx-kn2__blabel { flex: 1; min-width: 0; }
.wsx-kn2__count { flex: none; font-weight: 600; color: var(--color-text-tertiary); }
.wsx-kn2__kids { display: flex; flex-direction: column; gap: 1px; }
.wsx-kn2__kids:not(.is-collapsed) { animation: wsxKnFade var(--duration-fast) ease; }
.wsx-kn2__kids.is-collapsed { display: none; }
@keyframes wsxKnFade { from { opacity: 0; } to { opacity: 1; } }

/* ---- Controls bar: stats line + search + view toggle + How-it-works ---- */
/* Header = 2 rows: title + quiet stats, then search/filter + actions. Intro lives in the ? modal. */
.wsx-kn2__titlerow { display: flex; align-items: center; gap: 16px; min-width: 0; margin-bottom: 12px; }
.wsx-kn2__titlerow .wsx__viewtitle { margin: 0; flex: none; }
#knStats { flex: 1; min-width: 0; }
#knHow { cursor: pointer; }
.wsx-knd__trow { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wsx-knd__back { display: inline-grid; place-items: center; flex: none; width: 30px; height: 30px; padding: 0; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast); }
.wsx-knd__back:hover { background: var(--color-surface); color: var(--color-text); }
.wsx-knd__back svg { width: 18px; height: 18px; }
.wsx-knd__rel { width: 100%; font: inherit; text-align: left; cursor: pointer; }
.wsx-knd__rel:hover { border-color: var(--color-primary); }
.wsx-knd__relkind { flex: none; margin-left: auto; font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-kn2__stats.wsx-cat__kpis { display: block; flex: 1 1 auto; margin: 0; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-kn2__stat { font-size: var(--text-sm); color: var(--color-text-tertiary); margin-right: 14px; }
.wsx-kn2__bar .wsx-qsearch input { width: 240px; }
.wsx-kn2__kind { width: auto; }
.wsx-kn2__treewrap .wsx-qsearch, .wsx-kn2__treewrap .wsx-qsearch input { width: 100%; box-sizing: border-box; }
.wsx-kn2__bar .wsx-cat__count { margin-left: 0; }
@media (min-width: 1100px) {
  .wsx-kn2__bar { flex-wrap: nowrap; }
  .wsx-kn2__bar > :not(.wsx-kn2__stats) { flex: none; }
}
.wsx-kn2__stat b { font-weight: 700; color: var(--color-text); font-variant-numeric: tabular-nums; }
.wsx-kn2__ctlright { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; }
.wsx-kn2__how-body p { margin: 0 0 12px; font-size: var(--text-sm); line-height: 1.6; color: var(--color-text); }
.wsx-kn2__how-body p:last-child { margin-bottom: 0; }
.wsx-kn2__how-body strong { color: var(--color-text); }

/* ---- Train progress bar (reveal only) ---- */
.wsx-kn2__prog { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
.wsx-kn2__prog[hidden] { display: none; }
.wsx-kn2__progtrack { flex: 1; height: 4px; background: var(--color-border); border-radius: 999px; overflow: hidden; }
.wsx-kn2__progfill { height: 100%; width: 0; background: var(--color-primary); transition: width .4s ease; }
.wsx-kn2__proglabel { flex: none; font-size: var(--text-xs); color: var(--color-text-secondary); font-variant-numeric: tabular-nums; }

/* ---- Guidance branch ---- */
.wsx-kn2__gq { display: inline-grid; place-items: center; flex: none; width: 14px; height: 14px; border-radius: 999px; border: 1px solid currentColor; font-size: 9px; font-weight: 700; line-height: 1; color: var(--color-text-tertiary); margin-left: 4px; }
.wsx-kn2__gnew { color: var(--color-text-secondary); }
.wsx-kn2__toptopics { font: 700 var(--text-sm) var(--font-body); color: var(--color-text); margin: 16px 0 6px; }
.wsx-kn2__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.wsx-kn2__chip { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text); font: 500 var(--text-sm) var(--font-body); border-radius: 999px; padding: 5px 6px 5px 12px; }
button.wsx-kn2__chip { cursor: pointer; transition: border-color var(--duration-fast), background var(--duration-fast); }
button.wsx-kn2__chip:hover { border-color: var(--color-primary); background: var(--color-bg-elevated); }
.wsx-kn2__chipl { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-kn2__chipn { flex: none; min-width: 20px; padding: 0 6px; border-radius: 999px; background: var(--color-bg-elevated); color: var(--color-text-secondary); font-size: var(--text-xs); font-variant-numeric: tabular-nums; text-align: center; }
.wsx-kn2__wl { border: 0; background: none; padding: 0; font: inherit; color: var(--color-primary); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
.wsx-kn2__empty p { margin: 0 0 10px; }
.wsx-kn2__gname { width: 100%; margin: 8px 0; }
.wsx-kn2__ginvalid { color: var(--color-error); font-size: var(--text-xs); margin: 6px 0; }

/* ---- Note view: eyebrow → title → meta, actions beside the title; facets, body, sources ---- */
.wsx-knd__top { display: flex; align-items: flex-start; gap: 12px; }
.wsx-knd__titles { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.wsx-knd__eyebrow { display: flex; align-items: center; gap: 8px; }
.wsx-knd__kind { font: 700 var(--text-xs) var(--font-body); text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); }
.wsx-knd__title { font: 700 var(--text-h3) var(--font-display, var(--font-body)); line-height: 1.2; margin: 0; color: var(--color-text); overflow-wrap: anywhere; }
.wsx-knd__meta { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-knd__acts { flex: none; display: inline-flex; gap: 2px; margin-top: -4px; }
.wsx-knd__act svg { width: 17px; height: 17px; }
.wsx-knd__act.is-on { color: var(--color-primary); }
.wsx-knd__act--danger:not(:disabled):hover { color: var(--color-error); background: var(--color-error-light); }
.wsx-knd__facets { display: flex; flex-direction: column; gap: 8px; margin: 12px 0 14px; }
.wsx-knd__facet { display: flex; align-items: baseline; gap: 12px; }
.wsx-knd__flabel { flex: none; width: 72px; font-size: var(--text-xs); font-weight: 600; color: var(--color-text-tertiary); }
.wsx-knd__chips { display: flex; flex-wrap: wrap; gap: 6px; min-width: 0; }
.wsx-knd__chip { border: 1px solid var(--color-border); background: var(--color-surface); color: var(--color-text-secondary); font: 500 var(--text-xs) var(--font-body); border-radius: 999px; padding: 3px 10px; text-transform: none; }
button.wsx-knd__chip { cursor: pointer; transition: border-color var(--duration-fast), color var(--duration-fast); }
button.wsx-knd__chip:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-knd__body { font-size: var(--text-sm); line-height: 1.65; }
.wsx-knd__sec { margin-top: 22px; }
.wsx-knd__sechead { display: flex; align-items: baseline; gap: 8px; margin-bottom: 8px; }
.wsx-knd__sechead h4 { margin: 0; font: 700 var(--text-sm) var(--font-body); color: var(--color-text); }
.wsx-knd__count { font: 600 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
.wsx-knd__hint { margin-left: auto; font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-knd__srcs { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.wsx-knd__src { display: flex; align-items: center; gap: 10px; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text); text-decoration: none; font: 500 var(--text-sm) var(--font-body); transition: border-color var(--duration-fast); }
a.wsx-knd__src:hover { border-color: var(--color-primary); }
.wsx-knd__src svg { flex: none; width: 16px; height: 16px; color: var(--color-text-tertiary); }
.wsx-knd__srct { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-knd__src.is-off { color: var(--color-text-tertiary); }
a.wsx-knd__src:hover .wsx-knd__srcgo svg { color: var(--color-primary); }

/* Desktop tree + table: the lens fills the pane, so the title, stats and controls never scroll;
   only the tree and the note body do (the note's title block stays on top). */
@media (min-width: 861px) {
  .wsx__view[data-view="knowledge"].is-active:has(#wsxKnMount > .wsx-kn2, #wsxKnMount > .wsx-atbl__wrap) { display: flex; flex-direction: column; height: 100%; }
  .wsx__view[data-view="knowledge"]:has(#wsxKnMount > .wsx-kn2, #wsxKnMount > .wsx-atbl__wrap) #wsxKnMount { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  /* Table: same frame — only the rows scroll, column headers stay on top. */
  #wsxKnMount > .wsx-atbl__wrap { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  #wsxKnMount > .wsx-atbl__wrap thead th { position: sticky; top: 0; z-index: 1; background: var(--color-bg-elevated); }
  #wsxKnMount > .wsx-kn2 { flex: 1; min-height: 320px; grid-template-rows: minmax(0, 1fr); align-items: stretch; }
  #wsxKnMount > .wsx-kn2 .wsx-kn2__treewrap { position: static; min-height: 0; }
  #wsxKnMount > .wsx-kn2 .wsx-kn2__tree { max-height: none; flex: 1; min-height: 0; }
  #wsxKnMount > .wsx-kn2 .wsx-kn2__detail { min-height: 0; overflow-y: auto; }
  #wsxKnMount > .wsx-kn2 .wsx-kn2__detail:has(> .wsx-kn2__scroll) { display: flex; flex-direction: column; padding: 0; overflow: hidden; }
  .wsx-kn2__detail > .wsx-kn2__dtop { flex: none; padding: 14px 14px 10px; border-bottom: 1px solid var(--color-border); }
  .wsx-kn2__detail > .wsx-kn2__scroll { flex: 1; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 4px 14px 14px; }
}
@media (max-width: 860px) {
  .wsx-kn2 { grid-template-columns: 1fr; }
  .wsx-kn2__treewrap { position: static; }
  .wsx-kn2__tree { max-height: none; }
  .wsx-kn2__detail { display: none; }
}
`;
