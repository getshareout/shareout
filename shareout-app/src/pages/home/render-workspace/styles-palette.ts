/**
 * Command-palette (Cmd+K) + inline quick-jump styles. Split out of styles.ts to keep
 * that module under the line guard; concatenated into WORKSPACE_STYLES. Rich, glassy,
 * accent-forward rows: artifact preview thumbnails, owner avatars, view counts, and
 * status pills. All values are design tokens — no hardcoded palette.
 */
export const WORKSPACE_PALETTE_STYLES = `
/* ---- inline quick-jump dropdown (under the artifacts search input) ---- */
.wsx-qsearch__dd { position: absolute; top: calc(100% + 8px); right: 0; z-index: 40; width: 380px; max-width: 92vw; max-height: 380px; overflow-y: auto; background: var(--color-bg-elevated); border: 1px solid var(--color-border-strong); border-radius: var(--radius-lg); box-shadow: var(--shadow-xl, 0 24px 60px rgba(0,0,0,0.28)); padding: 6px; }
.wsx-qsearch__dd .wsx-cmdk__item { width: 100%; }

/* ---- topbar search trigger ---- */
.wsx__search { display: inline-flex; align-items: center; gap: 8px; margin-left: auto; padding: 7px 12px; border: 1.5px solid var(--color-border); border-radius: 999px; background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; transition: border-color var(--duration-fast), color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx__search:hover { border-color: var(--color-primary); color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.wsx__search svg { width: 15px; height: 15px; }
.wsx__search-kbd { padding: 1px 6px; border-radius: 5px; background: var(--color-surface); border: 1px solid var(--color-border); font: 600 11px var(--font-mono, monospace); color: var(--color-text-tertiary); }
@media (max-width: 640px) { .wsx__search-label, .wsx__search-kbd { display: none; } .wsx__search { padding: 7px; } }

/* ---- command palette (Cmd+K) ---- */
.wsx-cmdk { position: fixed; inset: 0; z-index: 2000; display: flex; align-items: flex-start; justify-content: center; }
.wsx-cmdk__scrim { position: absolute; inset: 0; background: color-mix(in srgb, var(--color-text) 24%, transparent); backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px); animation: wsxCmdkFade var(--duration-fast) ease; }
.wsx-cmdk__panel { position: relative; margin-top: 11vh; width: 660px; max-width: 92vw; max-height: 68vh; display: flex; flex-direction: column; background: var(--color-bg-elevated); border: 1px solid var(--color-border-strong); border-radius: var(--radius-xl); box-shadow: var(--shadow-xl, 0 32px 80px rgba(0,0,0,0.28)); overflow: hidden; animation: wsxCmdkIn var(--duration-fast) cubic-bezier(.2,.9,.3,1); }
@keyframes wsxCmdkIn { from { opacity: 0; transform: translateY(-10px) scale(.985); } to { opacity: 1; transform: none; } }
@keyframes wsxCmdkFade { from { opacity: 0; } to { opacity: 1; } }

.wsx-cmdk__inputrow { display: flex; align-items: center; gap: 12px; padding: 17px 20px; border-bottom: 1px solid var(--color-border); }
.wsx-cmdk__inputrow svg { width: 20px; height: 20px; color: var(--color-primary); flex: 0 0 auto; }
.wsx-cmdk__input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; color: var(--color-text); font: 500 var(--text-lg) var(--font-body); }
.wsx-cmdk__input::placeholder { color: var(--color-text-tertiary); }
.wsx-cmdk__esc { padding: 3px 8px; border-radius: 6px; background: var(--color-surface); border: 1px solid var(--color-border); font: 600 11px var(--font-mono, monospace); color: var(--color-text-tertiary); }

.wsx-cmdk__list { overflow-y: auto; padding: 8px; scroll-padding: 34px 0; }
.wsx-cmdk__gtitle { display: flex; align-items: center; gap: 8px; padding: 12px 12px 5px; font: 700 var(--text-xs) var(--font-body); letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-tertiary); }
.wsx-cmdk__gcount { display: inline-grid; place-items: center; min-width: 17px; height: 17px; padding: 0 5px; border-radius: 999px; background: var(--color-surface); color: var(--color-text-tertiary); font: 600 10px var(--font-body); letter-spacing: 0; }

.wsx-cmdk__item { display: flex; align-items: center; gap: 12px; width: 100%; padding: 8px 12px; border: 0; background: transparent; border-radius: var(--radius-md); cursor: pointer; text-align: left; position: relative; transition: background var(--duration-fast); }
.wsx-cmdk__item.is-sel { background: var(--color-primary-light); }
.wsx-cmdk__item.is-sel::before { content: ''; position: absolute; left: 3px; top: 9px; bottom: 9px; width: 3px; border-radius: 999px; background: var(--color-primary); }

/* leading visual: colored type-tile / preview thumbnail / avatar */
.wsx-cmdk__tile { flex: 0 0 auto; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 9px; background: color-mix(in srgb, var(--color-primary) 12%, transparent); color: var(--color-primary); }
.wsx-cmdk__tile svg { width: 18px; height: 18px; }
.wsx-cmdk__tile--folder { background: color-mix(in srgb, var(--color-warning) 15%, transparent); color: var(--color-warning); }
.wsx-cmdk__tile--dataset { background: color-mix(in srgb, var(--color-success) 15%, transparent); color: var(--color-success); }
.wsx-cmdk__tile--alert { background: color-mix(in srgb, var(--color-warning) 15%, transparent); color: var(--color-warning); }
.wsx-cmdk__tile--action { background: color-mix(in srgb, var(--color-primary) 14%, transparent); color: var(--color-primary); }
.wsx-cmdk__thumb { flex: 0 0 auto; position: relative; width: 46px; height: 34px; border-radius: 8px; overflow: hidden; background: var(--color-surface); border: 1px solid var(--color-border); display: grid; place-items: center; }
.wsx-cmdk__thumb img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wsx-cmdk__thumbfb { position: absolute; inset: 0; display: none; place-items: center; color: var(--color-text-tertiary); }
.wsx-cmdk__thumbfb svg { width: 16px; height: 16px; }
.wsx-cmdk__thumb.is-empty .wsx-cmdk__thumbfb { display: grid; }
.wsx-cmdk__ava { flex: 0 0 auto; display: grid; place-items: center; width: 34px; height: 34px; border-radius: 50%; overflow: hidden; background: color-mix(in srgb, var(--color-primary) 16%, transparent); color: var(--color-primary); font: 700 var(--text-xs) var(--font-body); text-transform: uppercase; }
.wsx-cmdk__ava img { width: 100%; height: 100%; object-fit: cover; }

.wsx-cmdk__txt { display: flex; flex-direction: column; min-width: 0; flex: 1 1 auto; gap: 1px; }
.wsx-cmdk__ttl { color: var(--color-text); font: 600 var(--text-sm) var(--font-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-cmdk__item.is-sel .wsx-cmdk__ttl { color: var(--color-primary); }
.wsx-cmdk__sub { color: var(--color-text-tertiary); font: 400 var(--text-xs) var(--font-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* trailing meta: status pill, view count, owner avatar */
.wsx-cmdk__metar { flex: 0 0 auto; display: flex; align-items: center; gap: 9px; margin-left: 6px; }
.wsx-cmdk__views { display: inline-flex; align-items: center; gap: 4px; color: var(--color-text-tertiary); font: 600 var(--text-xs) var(--font-body); font-variant-numeric: tabular-nums; }
.wsx-cmdk__views svg { width: 13px; height: 13px; }
.wsx-cmdk__own { width: 22px; height: 22px; border-radius: 50%; overflow: hidden; border: 1.5px solid var(--color-bg-elevated); box-shadow: 0 0 0 1px var(--color-border); }
.wsx-cmdk__own img { width: 100%; height: 100%; object-fit: cover; display: block; }
.wsx-cmdk__pill { padding: 2px 8px; border-radius: 999px; font: 600 10px var(--font-body); letter-spacing: .02em; text-transform: uppercase; background: var(--color-surface); color: var(--color-text-secondary); white-space: nowrap; }
.wsx-cmdk__pill--private { background: var(--color-surface); color: var(--color-text-tertiary); }
.wsx-cmdk__pill--paused { background: var(--color-warning-light); color: var(--color-warning); }
.wsx-cmdk__pill--failing { background: var(--color-error-light); color: var(--color-error); }
.wsx-cmdk__pill--triggered { background: var(--color-primary-light); color: var(--color-primary); }

/* ---- ask workspace (answer mode) ---- */
.wsx-cmdk__tile--ask { background: color-mix(in srgb, var(--color-primary) 16%, transparent); color: var(--color-primary); }
.wsx-cmdk__ask { padding: 14px 16px 18px; }
.wsx-cmdk__ask-q { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); margin-bottom: 10px; }
.wsx-cmdk__ask-status { color: var(--color-text-tertiary); font: 500 var(--text-sm) var(--font-body); }
.wsx-cmdk__ask-err { color: var(--color-error); font: 500 var(--text-sm) var(--font-body); }
.wsx-cmdk__ask-answer { color: var(--color-text-secondary); font: 400 var(--text-sm)/1.6 var(--font-body); }
.wsx-cmdk__ask-cites { margin-top: 14px; display: flex; flex-direction: column; gap: 4px; }
.wsx-cmdk__ask-citehd { font: 700 var(--text-xs) var(--font-body); letter-spacing: .05em; text-transform: uppercase; color: var(--color-text-tertiary); margin-bottom: 2px; }
.wsx-cmdk__cite { display: flex; align-items: center; gap: 9px; width: 100%; padding: 7px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-surface); cursor: pointer; text-align: left; transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx-cmdk__cite:hover { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.wsx-cmdk__cite-n { flex: 0 0 auto; display: grid; place-items: center; width: 20px; height: 20px; border-radius: 6px; background: var(--color-primary-light); color: var(--color-primary); font: 700 11px var(--font-body); }
.wsx-cmdk__cite-t { color: var(--color-text); font: 600 var(--text-sm) var(--font-body); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.wsx-cmdk__empty { padding: 34px 16px; text-align: center; color: var(--color-text-tertiary); font: 500 var(--text-sm) var(--font-body); }
.wsx-cmdk__foot { display: flex; align-items: center; gap: 18px; padding: 11px 18px; border-top: 1px solid var(--color-border); color: var(--color-text-tertiary); font: 500 var(--text-xs) var(--font-body); }
.wsx-cmdk__foothint { display: inline-flex; align-items: center; gap: 5px; }
.wsx-cmdk__foot kbd { padding: 1px 6px; border-radius: 5px; background: var(--color-surface); border: 1px solid var(--color-border); font: 600 11px var(--font-mono, monospace); }
.wsx-cmdk__footbrand { margin-left: auto; font: 700 var(--text-xs) var(--font-display, var(--font-body)); color: var(--color-text-tertiary); opacity: .7; letter-spacing: .02em; }
@media (max-width: 640px) { .wsx-cmdk__panel { margin-top: 5vh; max-height: 84vh; width: 96vw; } .wsx-cmdk__footbrand { display: none; } }
`;
