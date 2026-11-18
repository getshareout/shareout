/** Knowledge map — finder | neighbourhood canvas | evidence panel. Appended after the
 *  Knowledge lens styles. Node colours are data (per-type categorical palette set inline on
 *  the SVG); every bit of chrome here is tokens only. */
export const WORKSPACE_KNOWLEDGE_MAP_STYLES = `
/* ---- Knowledge map — three columns ---- */
.km { display: grid; grid-template-columns: minmax(220px, 256px) minmax(0, 1fr) minmax(300px, 360px); gap: 16px; align-items: start; }
.km__finder, .km__panel { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 14px; box-sizing: border-box; position: sticky; top: 64px; max-height: calc(100vh - 96px); overflow-y: auto; min-width: 0; }
.km__finder { display: flex; flex-direction: column; gap: 10px; }
.km__search { width: 100%; }
.km__chips { display: flex; flex-wrap: wrap; gap: 6px; }
.km__chip { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); border-radius: 999px; padding: 4px 10px; cursor: pointer; transition: color var(--duration-fast), border-color var(--duration-fast), background var(--duration-fast); }
.km__chip:hover { color: var(--color-text); border-color: var(--color-border-strong); }
.km__chip.is-on { background: var(--color-text); border-color: var(--color-text); color: var(--color-bg-elevated); }
.km__chip.is-on .km__cnt { color: inherit; opacity: .7; }
.km__cnt { font-weight: 600; color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; margin-left: 6px; }
.km__dot { flex: none; display: inline-block; width: 9px; height: 9px; border-radius: 999px; }
.km__lh { font: 700 var(--text-xs) var(--font-body); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: .04em; padding: 6px 2px 0; }
.km__list { display: flex; flex-direction: column; gap: 1px; }
.km__item { display: flex; align-items: center; gap: 8px; width: 100%; text-align: left; border: 0; border-left: 3px solid transparent; background: transparent; color: var(--color-text); font: 500 var(--text-sm) var(--font-body); border-radius: var(--radius-sm); padding: 7px 8px; cursor: pointer; min-height: 36px; transition: background var(--duration-fast); }
.km__item:hover, .km__item.is-active { background: var(--color-surface); }
.km__item.is-on { background: var(--color-surface); border-left-color: var(--color-primary); }
.km__iname { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.km__itype { flex: none; color: var(--color-text-tertiary); font-size: var(--text-xs); }
.km__none { color: var(--color-text-tertiary); font-size: var(--text-sm); padding: 10px 4px; }
.km__empty { grid-column: 1 / -1; }

/* ---- Canvas ---- */
.km__canvas { position: relative; min-width: 0; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); height: clamp(460px, 66vh, 780px); overflow: hidden; display: flex; flex-direction: column; }
.km__canvas > .wsx-empty { margin: auto; }
.km__head { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 8px 12px; padding: 10px 12px 0; position: relative; z-index: 2; }
.km__trail { flex: 1; min-width: 0; display: flex; align-items: center; flex-wrap: wrap; gap: 2px; }
.km__crumb { border: 0; background: transparent; color: var(--color-text-secondary); font: 500 var(--text-sm) var(--font-body); padding: 4px 6px; border-radius: var(--radius-sm); cursor: pointer; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.km__crumb:hover { color: var(--color-text); background: var(--color-surface); }
.km__crumb.is-cur { color: var(--color-text); font-weight: 700; cursor: default; }
.km__crumb.is-cur:hover { background: transparent; }
.km__sep { color: var(--color-text-tertiary); padding: 0 2px; }
.km__tools { flex: none; display: inline-flex; align-items: center; gap: 8px; }
.km__depth button { padding: 4px 11px; font-size: var(--text-xs); }
.km__svg { flex: 1; width: 100%; min-height: 0; display: block; margin-bottom: 56px; cursor: grab; touch-action: none; user-select: none; -webkit-user-select: none; }
.km__svg.is-dragging { cursor: grabbing; }
.km__note { position: absolute; left: 14px; top: 44px; z-index: 2; font-size: var(--text-xs); color: var(--color-text-tertiary); background: var(--color-bg-elevated); padding: 3px 8px; border-radius: var(--radius-sm); }

.km__e line { stroke: var(--color-border-strong); stroke-width: 1.5; transition: opacity var(--duration-fast), stroke var(--duration-fast); }
.km__e.is-primary line { stroke: var(--color-text-tertiary); stroke-width: 2; }
.km__e.is-hot line { stroke: var(--color-text-secondary); stroke-width: 2.25; }
.km__elbl { display: none; font: 500 11px var(--font-body); fill: var(--color-text-secondary); paint-order: stroke; stroke: var(--color-bg-elevated); stroke-width: 4px; stroke-linejoin: round; pointer-events: none; }
.km--labels .km__e.is-primary .km__elbl, .km__e.is-hot .km__elbl { display: block; }
.km--hover .km__e:not(.is-hot) { opacity: .22; }
.km--hover .km__e.is-hot .km__elbl { display: block; }
.km__node { cursor: pointer; outline: none; transition: opacity var(--duration-fast); }
.km__node circle { stroke-width: 1.5; transition: stroke-width var(--duration-fast); }
.km__node:hover circle, .km__node:focus-visible circle { stroke-width: 3; }
.km__node.is-focus { cursor: default; }
.km__halo { fill: none; stroke-width: 2; opacity: .35; }
.km__lbl { font: 500 12px var(--font-body); fill: var(--color-text); paint-order: stroke; stroke: var(--color-bg-elevated); stroke-width: 4px; stroke-linejoin: round; pointer-events: none; }
.km__ring2 .km__lbl { font-size: 11px; fill: var(--color-text-secondary); }
.km--dense .km__ring2:not(.is-hot) .km__lbl { display: none; }
.km__node.is-focus .km__lbl { font: 700 13px var(--font-body); }
.km--hover .km__node:not(.is-hot) { opacity: .3; }

/* ---- Evidence panel ---- */
.km__panel { display: flex; flex-direction: column; gap: 4px; }
.km__phead { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.km__pm { margin-left: auto; color: var(--color-text-tertiary); font-size: var(--text-xs); font-variant-numeric: tabular-nums; }
.km__pname { font: 700 var(--text-h3) var(--font-display, var(--font-body)); margin: 6px 0 0; line-height: 1.2; overflow-wrap: anywhere; }
.km__aka { color: var(--color-text-secondary); font-size: var(--text-sm); margin-top: 2px; }
.km__sec { margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--color-border); }
.km__h4 { display: flex; align-items: center; font: 700 var(--text-xs) var(--font-body); color: var(--color-text-secondary); text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px; }
.km__fact { padding: 8px 0; }
.km__fact + .km__fact { border-top: 1px dashed var(--color-border); }
.km__fk { font: 600 var(--text-xs) var(--font-body); color: var(--color-text-secondary); }
.km__fv { font: 600 var(--text-base) var(--font-body); color: var(--color-text); margin: 2px 0 4px; overflow-wrap: anywhere; }
.km__unit { font-weight: 500; color: var(--color-text-secondary); }
.km__since { margin-left: 8px; font: 500 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); }
.km__q { margin: 4px 0 6px; padding: 2px 0 2px 10px; border-left: 2px solid var(--color-border-strong); color: var(--color-text-secondary); font: 400 var(--text-sm) var(--font-body); line-height: 1.5; font-style: italic; }
.km__src { display: inline-flex; align-items: center; gap: 5px; border: 0; background: transparent; padding: 0; color: var(--color-primary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; text-align: left; }
.km__src:hover { text-decoration: underline; }
.km__src--file { color: var(--color-text-secondary); cursor: default; }
.km__src--file:hover { text-decoration: none; }
.km__ext { font-size: 11px; }
.km__group + .km__group { margin-top: 8px; }
.km__gh { display: flex; align-items: center; gap: 6px; font: 600 var(--text-sm) var(--font-body); color: var(--color-text); padding: 2px 4px; }
.km__arrow { color: var(--color-text-tertiary); font-size: var(--text-sm); }
.km__mention { padding: 6px 0; }
.km__mention + .km__mention { border-top: 1px dashed var(--color-border); }
.km__cite { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.km__loc { color: var(--color-text-tertiary); font-size: var(--text-xs); }
.km__more { display: none; }
.km__more.is-open { display: block; }
.km__morebtn { margin-top: 6px; font-size: var(--text-xs); }

@media (max-width: 1180px) {
  .km { grid-template-columns: minmax(200px, 240px) minmax(0, 1fr); }
  .km__panel { grid-column: 1 / -1; position: static; max-height: none; }
}
@media (max-width: 860px) {
  .km { grid-template-columns: 1fr; }
  .km__finder { position: static; max-height: none; }
  .km__list { max-height: 220px; overflow-y: auto; }
  .km__canvas { height: 78vw; min-height: 360px; }
  .km__svg { margin-bottom: 8px; }
}

/* ---- Team curation: confirmed (solid) vs proposed (dashed), edit controls, Rules view ---- */
.km__dot.is-draft { background: transparent !important; border: 1.5px dashed; box-sizing: border-box; }
.km__node.is-draft circle { stroke-dasharray: 4 3; }
.km__node.is-draft .km__lbl { font-style: italic; fill: var(--color-text-secondary); }
.km__e.is-draft line { stroke-dasharray: 5 4; }
.km__handle { opacity: 0; cursor: crosshair; transition: opacity var(--duration-fast); }
.km__handle circle { fill: var(--color-primary); stroke: var(--color-bg-elevated); stroke-width: 1.5; }
.km__handle path { stroke: var(--color-text-inverse); stroke-width: 1.8; stroke-linecap: round; fill: none; }
.km__node:hover .km__handle, .km__node.is-focus .km__handle, .km__node:focus-visible .km__handle { opacity: 1; }
.km__node.is-target circle { stroke-width: 5; }
.km__node.is-moving { opacity: .8; cursor: grabbing; }
.km__ghost { stroke: var(--color-primary); stroke-width: 2; stroke-dasharray: 4 3; pointer-events: none; }
.km__legend { display: flex; flex-wrap: wrap; gap: 4px 14px; padding: 6px 14px 0; font-size: var(--text-xs); color: var(--color-text-secondary); position: relative; z-index: 2; }
.km__legend i { display: inline-block; width: 20px; border-top: 2px solid var(--color-text-tertiary); margin-right: 6px; vertical-align: middle; }
.km__legend i.is-d { border-top-style: dashed; }
.km__hint { color: var(--color-text-tertiary); }
.km__status { display: flex; }
.km__status button { flex: 1; padding: 4px 6px; font-size: var(--text-xs); }
.km__item.is-draft .km__iname, .km__crow.is-draft .km__iname { font-style: italic; color: var(--color-text-secondary); }
.km__crow { display: flex; align-items: center; gap: 2px; }
.km__crow .km__item { flex: 1; min-width: 0; }
.km__acts { margin-left: auto; display: inline-flex; gap: 2px; flex: none; }
.km__fk { display: flex; align-items: center; gap: 6px; }
.km__fact.is-draft .km__fv { color: var(--color-text-secondary); }
.km__fact.is-clash { border-left: 3px solid var(--color-warning); padding-left: 8px; }
.km__add { margin-left: auto; font: 600 var(--text-xs) var(--font-body); text-transform: none; letter-spacing: 0; }
.km__foot { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 14px; padding-top: 12px; border-top: 1px solid var(--color-border); }
.km__danger { color: var(--color-error); }
.km__pname.is-edit { cursor: text; border-radius: var(--radius-sm); padding: 2px 4px; margin-left: -4px; }
.km__pname.is-edit:hover { background: var(--color-surface); }
.kc-name__in { width: 100%; box-sizing: border-box; font: inherit; }
.kc-type { font-size: var(--text-xs); padding: 2px 6px; }
.kc-prop { border: 1.5px dashed var(--color-border-strong); border-radius: var(--radius-sm); padding: 10px 12px; margin-bottom: 12px; background: var(--color-surface); font-size: var(--text-sm); }
.kc-prop__t { color: var(--color-text-secondary); }
.kc-prop__row { display: flex; gap: 6px; margin-top: 8px; flex-wrap: wrap; }
.kc-ok { color: var(--color-success); font: 600 var(--text-xs) var(--font-body); margin-bottom: 8px; }
.kc-aka { display: flex; flex-wrap: wrap; gap: 5px; margin: 8px 0 2px; align-items: center; }
.kc-tag { background: var(--color-surface); border-radius: 999px; padding: 2px 9px; font-size: var(--text-xs); display: inline-flex; gap: 4px; align-items: center; }
.kc-tag button { border: 0; background: transparent; color: var(--color-text-tertiary); cursor: pointer; padding: 0; font-size: var(--text-sm); line-height: 1; }
.kc-tag--seen { background: transparent; border: 1px solid var(--color-border); color: var(--color-text-secondary); }
.kc-addl { border: 1px dashed var(--color-border-strong); background: transparent; border-radius: 999px; padding: 1px 9px; font: 500 var(--text-xs) var(--font-body); color: var(--color-text-secondary); cursor: pointer; }
.kc-addl--in { border-style: solid; outline: none; min-width: 110px; color: var(--color-text); }
.kc-def { font-size: var(--text-sm); white-space: pre-wrap; border-radius: var(--radius-sm); padding: 4px; margin: -4px; overflow-wrap: anywhere; }
.kc-def.is-empty { color: var(--color-text-tertiary); }
.kc-def.is-edit { cursor: text; }
.kc-def.is-edit:hover { background: var(--color-surface); }
.kc-def__ta { width: 100%; box-sizing: border-box; }
.kc-ib { border: 0; background: transparent; width: 26px; height: 26px; border-radius: var(--radius-sm); color: var(--color-text-secondary); cursor: pointer; font-size: var(--text-sm); }
.kc-ib:hover { background: var(--color-surface); color: var(--color-text); }
.kc-ib.is-ok { color: var(--color-success); }
.kc-clash { font-size: var(--text-xs); color: var(--color-warning); margin: 4px 0; }
.kc-hist { display: flex; justify-content: space-between; gap: 8px; font-size: var(--text-xs); color: var(--color-text-secondary); padding: 4px 0; }
.kc-hist__when { color: var(--color-text-tertiary); white-space: nowrap; }
.kc-pop { position: fixed; z-index: 1000; width: 300px; max-width: calc(100vw - 24px); background: var(--color-bg-elevated); border: 1px solid var(--color-border-strong); border-radius: var(--radius-md); box-shadow: var(--shadow-lg); padding: 12px; box-sizing: border-box; }
.kc-pop__t { font-weight: 700; margin-bottom: 6px; overflow-wrap: anywhere; }
.kc-pop__l { display: block; font-size: var(--text-xs); color: var(--color-text-secondary); margin: 8px 0 3px; }
.kc-pop__in { width: 100%; box-sizing: border-box; }
.kc-pop__row { display: flex; gap: 6px; justify-content: flex-end; margin-top: 12px; }
.kc-pop__chk { display: flex; gap: 6px; align-items: center; font-size: var(--text-sm); margin-top: 10px; }
.kc-pop__p { font-size: var(--text-sm); color: var(--color-text-secondary); margin: 0 0 8px; }
.kc-pop__pair { font-size: var(--text-sm); overflow-wrap: anywhere; }
.kc-pick { max-height: 220px; overflow: auto; margin-top: 6px; }
.kc-modal__row { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; flex-wrap: wrap; }
.kc-rule__ta { width: 100%; box-sizing: border-box; margin-top: 8px; }
.kc-rules { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); gap: 16px; align-items: start; }
.kc-col { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
.kc-card { background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); padding: 16px; min-width: 0; box-sizing: border-box; }
.kc-card h3 { margin: 0 0 4px; font: 700 var(--text-lg) var(--font-body); }
.kc-sub { margin: 0 0 12px; color: var(--color-text-secondary); font-size: var(--text-sm); }
.kc-ro { grid-column: 1 / -1; margin: 0; font-size: var(--text-sm); color: var(--color-text-secondary); }
.kc-swl { display: flex; gap: 8px; align-items: center; font-size: var(--text-sm); margin: 0 0 8px; }
.kc-trow { display: grid; grid-template-columns: auto minmax(0, 1fr) auto auto; gap: 10px; align-items: center; padding: 8px 2px; border-top: 1px solid var(--color-border); font-size: var(--text-sm); }
.kc-trow.is-off { opacity: .55; }
.kc-trow__n b { font-weight: 600; }
.kc-trow__d { display: block; color: var(--color-text-tertiary); font-size: var(--text-xs); }
.kc-trow__c { color: var(--color-text-secondary); font-size: var(--text-xs); white-space: nowrap; }
.kc-trow__s { display: inline-flex; gap: 6px; align-items: center; font-size: var(--text-xs); color: var(--color-text-secondary); }
.kc-switch { position: relative; width: 36px; height: 20px; border-radius: 12px; border: 0; background: var(--color-border-strong); padding: 0; cursor: pointer; flex: none; }
.kc-switch::after { content: ''; position: absolute; left: 2px; top: 2px; width: 16px; height: 16px; border-radius: 50%; background: var(--color-bg-elevated); transition: left var(--duration-fast); }
.kc-switch.is-on { background: var(--color-success); }
.kc-switch.is-on::after { left: 18px; }
.kc-switch:disabled { cursor: default; opacity: .6; }
.kc-add { display: flex; gap: 6px; margin-top: 10px; flex-wrap: wrap; }
.kc-add input { flex: 1; min-width: 140px; }
.kc-add .kc-add__term { flex: 0 1 120px; min-width: 90px; }
.kc-gl { display: grid; grid-template-columns: minmax(0, .5fr) minmax(0, 1.5fr) auto; gap: 8px; padding: 8px 2px; border-top: 1px solid var(--color-border); font-size: var(--text-sm); align-items: start; }
.kc-rule { display: flex; gap: 8px; align-items: flex-start; justify-content: space-between; padding: 8px 2px; border-top: 1px solid var(--color-border); font-size: var(--text-sm); }
.kc-x { border: 0; background: transparent; color: var(--color-text-tertiary); cursor: pointer; border-radius: var(--radius-sm); width: 24px; height: 24px; flex: none; }
.kc-x:hover { background: var(--color-surface); color: var(--color-text); }
.kc-note { margin: 12px 0 0; font-size: var(--text-xs); color: var(--color-text-tertiary); }
.kc-mt { margin-top: 16px; }
@media (max-width: 860px) {
  .kc-rules { grid-template-columns: minmax(0, 1fr); }
  .kc-trow { grid-template-columns: auto minmax(0, 1fr) auto; }
  .kc-trow__c, .km__hint { display: none; }
}
`;
