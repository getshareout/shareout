/**
 * Account menu + mobile rail-drawer CSS for the workspace shell (.wsx).
 * Split out of styles.ts to stay under the module line guard; concatenated in the
 * same cascade position (before the catalog styles) so order is unchanged.
 */
export const WORKSPACE_NAV_STYLES = `/* ===== account menu: workspace switcher + linked accounts + actions ===== */
.wsx__acct { border: 0; background: transparent; font: inherit; cursor: pointer; }
.wsx__acctout { transition: transform var(--duration-fast); }
.wsx__acct[aria-expanded="true"] .wsx__acctout { transform: rotate(180deg); color: var(--color-primary); }
.wsx__accmenu-head { display: flex; align-items: center; gap: 9px; padding: 4px 8px 10px; }
.wsx__accmenu-name { font: 700 var(--text-sm) var(--font-body); }
.wsx__accsec-title { font: 600 var(--text-xs) var(--font-body); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-tertiary); padding: 8px 8px 4px; }
.wsx__accsub { font-size: var(--text-xs); color: var(--color-text-tertiary); padding: 0 8px 8px; margin: 0; line-height: 1.45; }
.wsx__accdiv { height: 1px; background: var(--color-border); margin: 8px 4px; }
.wsx__spaces { display: flex; flex-direction: column; gap: 2px; }
.wsx-space { display: flex; align-items: center; gap: 10px; width: 100%; padding: 8px 9px; border: 1.5px solid transparent; border-radius: var(--radius-md); background: transparent; cursor: pointer; text-align: left; }
.wsx-space:hover { background: var(--color-surface); }
.wsx-space.is-active { border-color: var(--color-primary); background: var(--color-primary-light); }
.wsx-space__mark { width: 30px; height: 30px; flex: none; border-radius: 8px; overflow: hidden; display: grid; place-items: center; background: var(--color-surface); color: var(--color-text-secondary); }
.wsx-space.is-active .wsx-space__mark { color: var(--color-primary); }
.wsx-space__logo { width: 30px; height: 30px; object-fit: contain; }
.wsx-space__initial { font: 700 13px var(--font-body); color: var(--color-primary); }
.wsx-space__icon svg { width: 17px; height: 17px; }
.wsx-space__txt { min-width: 0; display: flex; flex-direction: column; }
.wsx-space__name { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-space.is-active .wsx-space__name { color: var(--color-primary); }
.wsx-space__desc { font-size: var(--text-xs); color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx__linked { display: flex; flex-direction: column; gap: 2px; padding: 0 2px; }
.wsx-acct-row { display: flex; align-items: center; gap: 9px; padding: 6px 8px; border-radius: var(--radius-md); }
.wsx-acct-row__av { width: 26px; height: 26px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--color-primary-light); color: var(--color-primary); font: 700 11px var(--font-body); overflow: hidden; }
.wsx-acct-row__av img { width: 26px; height: 26px; border-radius: 50%; object-fit: cover; }
.wsx-acct-row__email { flex: 1; min-width: 0; font-size: var(--text-sm); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-acct-row__tag { font-size: var(--text-xs); color: var(--color-text-tertiary); flex: none; }
.wsx-acct-row__unlink { border: 0; background: transparent; color: var(--color-text-tertiary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; flex: none; }
.wsx-acct-row__unlink:hover { color: var(--color-error); }
.wsx__accactions { display: flex; flex-direction: column; gap: 3px; margin-top: 8px; padding-top: 8px; border-top: 1px solid var(--color-border); }
.wsx-accbtn { display: flex; align-items: center; gap: 10px; width: 100%; padding: 9px 10px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); text-decoration: none; cursor: pointer; text-align: left; }
.wsx-accbtn:hover { background: var(--color-surface); color: var(--color-text); }
.wsx-accbtn svg { flex: none; color: var(--color-text-tertiary); width: 17px; height: 17px; }
.wsx-accbtn--out:hover, .wsx-accbtn--out:hover svg { color: var(--color-error); }
.wsx__trash { position: absolute; inset: 0; z-index: 50; display: grid; place-items: center; background: color-mix(in srgb, var(--color-text) 18%, transparent); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); padding: 20px; }
.wsx__trash[hidden] { display: none; }
.wsx__trash-card { width: min(460px, 100%); max-height: 70vh; display: flex; flex-direction: column; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-xl); overflow: hidden; }
.wsx__trash-head { display: flex; align-items: center; justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid var(--color-border); font: 700 var(--text-base) var(--font-body); }
.wsx__trash-close { width: 30px; height: 30px; display: grid; place-items: center; border: 0; background: transparent; color: var(--color-text-tertiary); border-radius: var(--radius-sm); cursor: pointer; }
.wsx__trash-close:hover { background: var(--color-surface); color: var(--color-text); }
.wsx__trash-list { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }
.wsx-trash-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.wsx-trash-item__main { flex: 1; min-width: 0; }
.wsx-trash-item__name { font: 600 var(--text-sm) var(--font-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-trash-item__meta { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-trash-restore { padding: 6px 13px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; flex: none; }
.wsx-trash-restore:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-trash-restore:disabled { opacity: 0.55; cursor: default; }
.wsx-trash-restore-all { align-self: flex-start; padding: 6px 13px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-trash-restore-all:hover { border-color: var(--color-primary); color: var(--color-primary); }

/* ===== mobile: rail becomes a left drawer behind a hamburger ===== */
.wsx__railscrim { position: absolute; inset: 0; z-index: 55; background: color-mix(in srgb, var(--color-text) 34%, transparent); -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px); opacity: 0; transition: opacity var(--duration-fast); }
.wsx__railscrim[hidden] { display: none; }

@media (max-width: 720px) {
  .wsx__body, .wsx.is-home .wsx__body { grid-template-columns: 1fr; }
  /* hamburger in the canvas chrome */
  .wsx__hamb { display: grid; place-items: center; flex: none; width: 38px; height: 38px; margin-left: 6px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text-secondary); cursor: pointer; }
  .wsx__hamb:hover { background: var(--color-surface); color: var(--color-text); }
  /* rail: off-canvas drawer sliding in from the left */
  .wsx__rail { display: flex; position: absolute; left: 0; top: 0; bottom: 0; z-index: 60; width: min(82vw, 320px); margin: 0; border-radius: 0 var(--radius-xl) var(--radius-xl) 0; transform: translateX(-104%); transition: transform var(--duration-normal, .22s) var(--ease-out-expo); }
  .wsx.is-rail-open .wsx__rail { transform: none; }
  /* drawer is never collapsed-to-icons on mobile */
  .wsx.is-rail-collapsed .wsx__rail { --wsx-rail: auto; }
  .wsx__collapse { display: none; }
  .wsx__railclose { display: grid; place-items: center; margin-left: auto; width: 30px; height: 30px; border: 0; background: transparent; border-radius: var(--radius-sm); color: var(--color-text-tertiary); cursor: pointer; flex: none; }
  .wsx__railclose:hover { background: var(--color-surface); color: var(--color-text); }
  /* rail is an off-canvas drawer here — canvas is full width, so center on the viewport */
  .wsx__composer[data-state="resting"], .wsx__composer[data-state="sheet"] { left: 50%; }
  .wsx__composer[data-state="sheet"] { width: 96%; max-height: calc(100vh - 24px); }
}`;
