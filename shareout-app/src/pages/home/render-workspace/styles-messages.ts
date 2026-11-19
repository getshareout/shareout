/**
 * CSS for the Messages lens (client-script/home-views/messages.ts) and its rail badge.
 * The page header reuses Admin's (.wsx-adm__ph); the count pills use the amber "needs you" look.
 */
export const WORKSPACE_MESSAGES_STYLES = `/* ===== Messages: rail badge ===== */
.wsx-lens { position: relative; }
.wsx-lens__bdg, .wsx-dm__n { margin-left: auto; flex: none; min-width: 20px; height: 20px; padding: 0 6px; box-sizing: border-box; border: 1px solid currentColor; border-radius: 10px; background: var(--color-warning-light); color: var(--color-warning); font: 700 11px/18px var(--font-body); text-align: center; font-variant-numeric: tabular-nums; }
.wsx-lens__bdg[hidden] { display: none; }
.wsx.is-rail-collapsed .wsx-lens .wsx-lens__bdg:not([hidden]) { display: block; position: absolute; top: 6px; right: 12px; min-width: 0; width: 8px; height: 8px; padding: 0; border: 0; background: var(--color-warning); font-size: 0; }

/* ===== Messages lens: list | conversation ===== */
.wsx__view[data-view="messages"].is-active { display: flex; flex-direction: column; height: 100%; }
.wsx-dm { flex: 1; min-height: 0; display: flex; flex-direction: column; }
.wsx-dm__ph { flex: none; }
.wsx-dm__ph .wsx-abtn svg { width: 16px; height: 16px; margin-right: 4px; }
.wsx-dm__box { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(240px, 320px) minmax(0, 1fr); border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); overflow: hidden; }
.wsx-dm.is-empty .wsx-dm__box { grid-template-columns: minmax(0, 1fr); }
.wsx-dm.is-empty .wsx-dm__list { display: none; }
.wsx-dm__list { min-height: 0; overflow-y: auto; padding: 6px; display: flex; flex-direction: column; gap: 2px; border-right: 1px solid var(--color-border); }
.wsx-dm__none { margin: 0; padding: 14px 10px; font-size: var(--text-sm); color: var(--color-text-tertiary); }
.wsx-dm__row { display: flex; align-items: center; gap: 11px; width: 100%; padding: 10px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text); font: inherit; text-align: left; cursor: pointer; transition: background var(--duration-fast); }
.wsx-dm__row:hover { background: var(--color-surface); }
.wsx-dm__row:focus-visible { outline: 2px solid var(--color-primary); outline-offset: -2px; }
.wsx-dm__row.is-on { background: var(--color-primary-light); box-shadow: inset 3px 0 0 var(--color-primary); }
.wsx-dm__rowmain { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wsx-dm__rowtop, .wsx-dm__rowbot { display: flex; align-items: center; gap: 8px; min-width: 0; }
.wsx-dm__name { flex: 1; min-width: 0; font: 600 var(--text-sm) var(--font-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-dm__time { flex: none; font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-dm__prev { flex: 1; min-width: 0; font-size: var(--text-xs); color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-dm__row.is-unread .wsx-dm__prev { color: var(--color-text); font-weight: 600; }
.wsx-dm__av { flex: none; width: 36px; height: 36px; display: grid; place-items: center; border-radius: 50%; background: var(--color-surface); color: var(--color-text-secondary); font: 700 var(--text-sm) var(--font-body); overflow: hidden; }
.wsx-dm__av img { width: 100%; height: 100%; object-fit: cover; }
.wsx-ncard__ic.wsx-dm__av { width: 34px; height: 34px; }

.wsx-dm__conv { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
.wsx-dm__conv > .wsx-cat__onboard { margin: auto; }
.wsx-dm__head { flex: none; display: flex; align-items: center; gap: 10px; min-height: 60px; box-sizing: border-box; padding: 10px 16px; border-bottom: 1px solid var(--color-border); }
.wsx-dm__back { display: none; place-items: center; flex: none; width: 34px; height: 34px; margin-left: -6px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text-secondary); cursor: pointer; }
.wsx-dm__back:hover { background: var(--color-surface); color: var(--color-text); }
.wsx-dm__who { min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wsx-dm__who b { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-dm__who span { font-size: var(--text-xs); color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-dm__log { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 20px; display: flex; flex-direction: column; gap: 3px; }
.wsx-dm__earlier { align-self: center; margin-bottom: 8px; }
.wsx-dm__hello { margin: auto; max-width: 340px; text-align: center; font-size: var(--text-sm); line-height: 1.55; color: var(--color-text-secondary); }
.wsx-dm__day { display: flex; justify-content: center; margin: 10px 0 6px; }
.wsx-dm__day span { padding: 2px 10px; border-radius: 999px; background: var(--color-surface); font: 600 11px var(--font-body); color: var(--color-text-tertiary); }
.wsx-dm__b { display: flex; flex-direction: column; align-items: flex-start; max-width: min(560px, 78%); }
.wsx-dm__b.is-mine { align-self: flex-end; align-items: flex-end; }
.wsx-dm__bub { padding: 8px 12px; border-radius: 16px; background: var(--color-surface); color: var(--color-text); font-size: var(--text-sm); line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere; }
.wsx-dm__b.is-mine .wsx-dm__bub { background: var(--color-primary-light); }
.wsx-dm__meta { margin: 3px 4px 8px; font-size: 11px; color: var(--color-text-tertiary); }
.wsx-dm__art { display: inline-flex; align-items: center; gap: 8px; max-width: 100%; margin-top: 4px; padding: 8px 12px; box-sizing: border-box; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text); font: 600 var(--text-sm) var(--font-body); text-decoration: none; }
a.wsx-dm__art:hover { border-color: var(--color-border-strong); }
.wsx-dm__arti { display: grid; flex: none; color: var(--color-text-secondary); }
.wsx-dm__artn { min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-dm__compose { flex: none; display: flex; align-items: flex-end; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--color-border); }
.wsx-dm__ta { flex: 1; min-width: 0; min-height: 40px; max-height: 160px; box-sizing: border-box; resize: none; padding: 9px 12px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); color: var(--color-text); font: 400 var(--text-sm)/1.45 var(--font-body); }
.wsx-dm__ta:focus { outline: none; border-color: var(--color-primary); }
.wsx-dm__ta:disabled { opacity: 0.7; }
.wsx-dm__send { flex: none; min-height: 40px; }
.wsx-dm__err { margin: -4px 16px 12px; font-size: var(--text-sm); color: var(--color-error); }
.wsx-dm__err[hidden] { display: none; }
/* The resting assistant pill floats over the canvas bottom, on top of the composer: hide it while Messages is on screen. */
.wsx:has(#wsxHomePane.is-active .wsx__view[data-view="messages"].is-active) .wsx__composer[data-state="resting"] { display: none; }

/* ---- New message: person picker (in .wsx-modal) ---- */
.wsx-dm__find { width: 100%; box-sizing: border-box; margin-bottom: 10px; }
/* The modal mounts on <body>, outside .wsx where the type tokens live: bring the two it uses. */
.wsx-dm__people { --text-sm: 0.875rem; --text-xs: 0.75rem; display: flex; flex-direction: column; gap: 2px; max-height: 50vh; overflow-y: auto; }
.wsx-dm__person { display: flex; align-items: center; gap: 11px; width: 100%; padding: 8px; border: 0; border-radius: var(--radius-md); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.wsx-dm__person:hover, .wsx-dm__person:focus-visible { background: var(--color-surface); outline: none; }

/* ---- phone: the list first; a conversation opens over it with a back button ---- */
@media (max-width: 720px) {
  .wsx-dm__box { grid-template-columns: minmax(0, 1fr); }
  .wsx-dm__list { border-right: 0; }
  .wsx-dm__conv { display: none; }
  .wsx-dm.is-conv .wsx-dm__list, .wsx-dm.is-conv .wsx-dm__ph { display: none; }
  .wsx-dm.is-conv .wsx-dm__conv, .wsx-dm.is-empty .wsx-dm__conv { display: flex; }
  .wsx-dm__back { display: grid; }
  .wsx-dm__head { padding: 8px 12px; min-height: 54px; }
  .wsx-dm__log { padding: 12px; }
  .wsx-dm__compose { padding: 10px 12px; }
  .wsx-dm__b { max-width: 86%; }
  .wsx-dm__ph { align-items: center; }
  .wsx-dm__ph .wsx-adm__desc { display: none; }
}
`;
