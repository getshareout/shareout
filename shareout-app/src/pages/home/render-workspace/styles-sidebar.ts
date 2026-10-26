/**
 * Right activity rail: timeline, inspector details, comments, and automate tab.
 * Split out of styles.ts to stay under the per-module line cap; concatenated into
 * WORKSPACE_STYLES in the same cascade position so order is unchanged.
 */
export const WORKSPACE_SIDEBAR_STYLES = `/* ---- right rail (the working Inspector: Activity · Details · Comments · Automate · History) ---- */
.wsx__activity { grid-row: 2; position: relative; margin: 12px 12px 12px 0; background: var(--glass-bg-strong); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); border: 1px solid var(--color-border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
/* Four tabs fit the default 300px rail in en and es; a narrower (resized) rail scrolls the row instead of clipping a label. */
.wsx__rtabs { display: flex; gap: 0; padding: 0 6px; flex: none; min-height: var(--wsx-headbar); box-sizing: border-box; align-items: stretch; overflow-x: auto; scrollbar-width: none; }
.wsx__rtabs::-webkit-scrollbar { display: none; }
.wsx__rtab { flex: 1 0 auto; padding: 0 6px; border: 0; border-bottom: 2px solid transparent; background: transparent; color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 7px; white-space: nowrap; }
.wsx__rtab:hover { color: var(--color-text); }
.wsx__rtab.is-active { color: var(--color-primary); border-bottom-color: var(--color-primary); }
.wsx__rtab .wsx__live-dot { width: 7px; height: 7px; }
.wsx__rbody { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; position: relative; }
.wsx__live-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--color-success); box-shadow: 0 0 0 0 rgba(22,163,74,0.5); animation: wsx-pulse 2.4s ease-out infinite; }
.wsx__activity-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; }
/* grouped activity timeline */
.wsx-tl-wrap { position: relative; padding: 10px 12px 18px; }
.wsx-tl-wrap::before { content: ''; position: absolute; left: 22px; top: 18px; bottom: 18px; width: 2px; background: var(--color-border); }
.wsx-tl { display: flex; gap: 11px; padding: 8px; border-radius: var(--radius-md); text-decoration: none; color: inherit; position: relative; }
.wsx-tl:hover { background: var(--color-surface); }
.wsx-tl__rail { width: 22px; flex: none; display: flex; justify-content: center; }
.wsx-tl__dot { width: 11px; height: 11px; border-radius: 50%; margin-top: 4px; background: var(--color-text-tertiary); box-shadow: 0 0 0 3px var(--color-bg-elevated); }
.wsx-tl__av { width: 22px; height: 22px; border-radius: 50%; object-fit: cover; box-shadow: 0 0 0 3px var(--color-bg-elevated); }
.wsx-tl__dot.k-comment, .wsx-tl__dot.k-reply { background: var(--color-primary); }
.wsx-tl__dot.k-share, .wsx-tl__dot.k-run { background: var(--color-success); }
.wsx-tl__dot.k-alert { background: var(--color-warning); }
.wsx-tl__main { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 1px; }
.wsx-tl__top { font: 600 var(--text-sm) var(--font-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-tl__sum { font-size: var(--text-xs); color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-tl__time { font-size: var(--text-xs); color: var(--color-text-tertiary); flex: none; padding-top: 2px; }

/* ---- Inspector (Details tab) ---- */
.wsx__details { padding: 16px 16px 28px; display: flex; flex-direction: column; gap: var(--space-4); }
.wsx-det__head { display: flex; gap: 12px; align-items: flex-start; }
.wsx-det__thumb { width: 44px; height: 44px; border-radius: var(--radius-md); object-fit: cover; background: var(--color-surface); flex: none; }
.wsx-det__htext { min-width: 0; flex: 1; }
.wsx-det__name { font: 700 var(--text-base) var(--font-body); line-height: 1.25; word-break: break-word; border-radius: var(--radius-sm); padding: 2px 4px; margin: -2px -4px; }
.wsx-det__name[contenteditable]:hover { background: var(--color-surface); }
.wsx-det__name[contenteditable]:focus { background: var(--color-bg); box-shadow: 0 0 0 2px var(--color-primary-light); outline: none; }
.wsx-det__pill { display: inline-flex; align-items: center; gap: 5px; margin-top: 6px; font: 600 var(--text-xs) var(--font-body); padding: 2px 9px; border-radius: 999px; background: var(--color-surface); color: var(--color-text-secondary); cursor: pointer; border: 0; text-transform: capitalize; }
.wsx-det__pill.is-public { background: var(--color-success-light); color: var(--color-success); }
.wsx-det__pill.is-private { background: var(--color-warning-light); color: var(--color-warning); }
.wsx-det__icons { display: flex; gap: 4px; flex-wrap: wrap; }
.wsx-det__icon { width: 34px; height: 34px; display: grid; place-items: center; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text-secondary); cursor: pointer; transition: border-color var(--duration-fast), color var(--duration-fast), background var(--duration-fast); }
.wsx-det__icon:hover { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
.wsx-det__icon.is-danger:hover { border-color: var(--color-error); color: var(--color-error); background: var(--color-error-light); }
.wsx-det__icon.is-on { border-color: var(--color-primary); color: var(--color-primary); background: var(--color-primary-light); }
.wsx-det__label { font: 600 var(--text-xs) var(--font-body); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-tertiary); margin-bottom: 7px; }
.wsx-det__sec { display: flex; flex-direction: column; border-top: 1px solid var(--color-border); padding-top: var(--space-3); }
.wsx-det__sec[hidden] { display: none; }
.wsx-det__sec > summary { list-style: none; cursor: pointer; margin-bottom: 0; }
.wsx-det__sec > summary::-webkit-details-marker { display: none; }
.wsx-det__sec > summary::after { content: ''; width: 7px; height: 7px; margin-right: 3px; border-right: 1.5px solid var(--color-text-tertiary); border-bottom: 1.5px solid var(--color-text-tertiary); transform: rotate(-45deg); transition: transform var(--duration-fast); }
.wsx-det__sec[open] > summary::after { transform: rotate(45deg); }
.wsx-det__sec > summary:hover .wsx-det__labeltxt { color: var(--color-text); }
.wsx-det__secbody { padding-top: 10px; display: flex; flex-direction: column; gap: 8px; }
.wsx-det__secic { width: 22px; height: 22px; flex: none; display: grid; place-items: center; border-radius: var(--radius-sm); color: var(--tone); background: color-mix(in srgb, var(--tone) 13%, transparent); }
.wsx-det__secic svg { width: 13px; height: 13px; }
.t-p { --tone: var(--color-primary); } .t-s { --tone: var(--color-success); } .t-w { --tone: var(--color-warning); } .t-n { --tone: var(--color-text-secondary); }
.wsx-det__head { display: flex; flex-direction: column; gap: 8px; }
.wsx-det__metaline { font: 500 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); }
.wsx-det__acts { display: flex; gap: 6px; margin-top: 4px; }
.wsx-det__acts .is-danger { margin-left: auto; }
.wsx-det__mpill.is-ok .dot { background: var(--color-success); } .wsx-det__mpill.is-warn .dot { background: var(--color-warning); }
.wsx-det__modnote { padding: 10px 12px; border-radius: var(--radius-md); font-size: var(--text-xs); line-height: 1.45; color: var(--color-text-secondary); background: var(--color-warning-light); border: 1px solid color-mix(in srgb, var(--color-warning) 30%, transparent); }
.wsx-det__modnote strong { color: var(--color-warning); } .wsx-det__modnote.is-err { background: var(--color-error-light); } .wsx-det__modnote.is-err strong { color: var(--color-error); }
.wsx-det__apst { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-radius: var(--radius-md); background: var(--color-surface); }
.wsx-det__apst.is-ok { background: var(--color-success-light); }
.wsx-det__apchip { flex: none; padding: 2px 8px; border-radius: 999px; font: 700 var(--text-xs) var(--font-body); background: var(--color-bg-elevated); color: var(--color-text-secondary); }
.wsx-det__apst.is-ok .wsx-det__apchip { background: var(--color-success); color: var(--color-text-inverse); }
.wsx-det__apst.is-flash { animation: wsx-ap-flash var(--duration-slow) var(--ease-out); }
@keyframes wsx-ap-flash { from { transform: scale(0.97); box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-success) 35%, transparent); } to { transform: none; box-shadow: none; } }
@media (prefers-reduced-motion: reduce) { .wsx-det__apst.is-flash { animation: none; } }
.wsx-det__approve.is-busy { opacity: 0.7; cursor: progress; }
.wsx-auto__sec { display: flex; flex-direction: column; gap: 8px; padding-bottom: var(--space-3); border-bottom: 1px solid var(--color-border); }
.wsx-auto__sec:last-child { border-bottom: 0; }
.wsx-det__desc { font: 400 var(--text-sm) var(--font-body); line-height: 1.5; color: var(--color-text-secondary); border-radius: var(--radius-sm); padding: 7px 9px; margin: -7px -9px; min-height: 1.2em; }
.wsx-det__desc[contenteditable]:empty::before { content: attr(data-ph); color: var(--color-text-tertiary); }
.wsx-det__desc[contenteditable]:hover { background: var(--color-surface); }
.wsx-det__desc[contenteditable]:focus { background: var(--color-bg); box-shadow: 0 0 0 2px var(--color-primary-light); outline: none; color: var(--color-text); }
.wsx-det__open { font-size: var(--text-sm); color: var(--color-primary); text-decoration: none; }
.wsx-det__open:hover { text-decoration: underline; }
.wsx-det__chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wsx-det__who { display: inline-flex; align-items: center; gap: 6px; padding: 3px 6px 3px 3px; border-radius: 999px; background: var(--color-surface); font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-det__who img, .wsx-det__who span.av { width: 20px; height: 20px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--color-primary-light); color: var(--color-primary); font: 700 10px var(--font-body); }
.wsx-det__who button { border: 0; background: transparent; color: var(--color-text-tertiary); cursor: pointer; font-size: 13px; line-height: 1; padding: 0 2px; }
.wsx-det__who button:hover { color: var(--color-error); }
.wsx-det__add { border: 1.5px dashed var(--color-border-strong); background: transparent; color: var(--color-text-tertiary); border-radius: 999px; width: 26px; height: 26px; cursor: pointer; font-size: 15px; line-height: 1; flex: none; }
.wsx-det__add:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-det__addin { border: 1.5px solid var(--color-primary); border-radius: 999px; padding: 4px 11px; font: 400 var(--text-xs) var(--font-body); outline: none; min-width: 120px; }
.wsx-det__actions { display: flex; flex-direction: column; gap: 7px; }
.wsx-det__actions .wsx-abtn { justify-content: flex-start; width: 100%; }
.wsx-det__actions .wsx__deliver { width: 100%; }
.wsx-det__actions .wsx__deliver .wsx-abtn { justify-content: space-between; }
.wsx-det__actions .wsx__deliver-menu { width: 100%; }
/* Deliver destinations */
.wsx-det__dests { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 4px; }
.wsx-det__dest { display: flex; flex-direction: column; align-items: center; gap: 5px; padding: 8px 6px; border: 1.5px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; transition: border-color var(--duration-fast), background var(--duration-fast); }
.wsx-det__dest:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-det__dest.is-on { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); }
.wsx-det__destlogo { width: 22px; height: 22px; object-fit: contain; }
.wsx-tests__off { font-size: var(--text-sm); color: var(--color-text-tertiary); line-height: 1.5; }
.wsx-link { border: 0; background: transparent; color: var(--color-primary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; padding: 0; }
/* section label help (?) */
.wsx-det__label { display: flex; align-items: center; gap: 5px; }
.wsx-det__help { width: 13px; height: 13px; border-radius: 50%; border: 1px solid var(--color-border-strong); background: transparent; color: var(--color-text-tertiary); font: 700 8px var(--font-body); cursor: default; line-height: 1; padding: 0; display: inline-grid; place-items: center; text-transform: none; letter-spacing: 0; flex: none; transition: border-color var(--duration-fast), color var(--duration-fast); }
.wsx-det__help:hover { border-color: var(--color-primary); color: var(--color-primary); }
/* body-appended tooltip for [data-tip] */
.wsx-tip { position: fixed; z-index: 500; max-width: 240px; padding: 6px 10px; border-radius: 8px; background: var(--color-text); color: var(--color-bg); font: 500 var(--text-xs) var(--font-body); line-height: 1.45; box-shadow: var(--shadow-lg); pointer-events: none; opacity: 0; transform: translateY(2px); transition: opacity var(--duration-fast), transform var(--duration-fast); display: none; }
.wsx-tip.is-show { opacity: 1; transform: translateY(0); }
/* share picker */
.wsx-share__roletog { display: inline-flex; border: 1.5px solid var(--color-border); border-radius: 999px; overflow: hidden; align-self: flex-start; }
.wsx-share__roletog button { border: 0; background: transparent; padding: 5px 13px; font: 600 var(--text-xs) var(--font-body); color: var(--color-text-secondary); cursor: pointer; }
.wsx-share__roletog button.is-on { background: var(--color-primary); color: var(--color-text-inverse); }
.wsx-share__search { width: 100%; box-sizing: border-box; padding: 10px 13px; border: 1px solid var(--color-border); border-radius: var(--radius-md); font: 400 var(--text-sm) var(--font-body); color: var(--color-text); background: var(--color-bg-elevated); outline: none; box-shadow: 0 1px 2px rgba(28,25,23,0.04); transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx-share__search::placeholder { color: var(--color-text-tertiary); }
.wsx-share__search:focus { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.wsx-share__drop { display: flex; flex-direction: column; gap: 2px; max-height: 190px; overflow-y: auto; border: 1px solid var(--color-border); border-radius: var(--radius-md); }
.wsx-share__drop:empty { display: none; }
.wsx-share__opt { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border: 0; background: transparent; text-align: left; cursor: pointer; font: 500 var(--text-sm) var(--font-body); color: var(--color-text); }
.wsx-share__opt:hover { background: var(--color-surface); }
.wsx-share__opt small { color: var(--color-text-tertiary); font-size: var(--text-xs); margin-left: auto; }
.wsx-det__who .role { font-size: var(--text-xs); color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 0.04em; }
/* ===== Studio inspector redesign ===== */
.wsx-det__hrow { display: flex; align-items: flex-start; gap: 8px; }
.wsx-det__hrow .wsx-det__name { flex: 1; }
.wsx-det__star { flex: none; width: 28px; height: 28px; margin-top: 1px; display: grid; place-items: center; border: 0; border-radius: 999px; background: transparent; color: var(--color-text-tertiary); cursor: pointer; transition: color var(--duration-fast), background var(--duration-fast); }
.wsx-det__star svg { width: 18px; height: 18px; }
.wsx-det__star:hover { color: var(--color-warning); background: var(--color-warning-light); }
.wsx-det__star.is-on { color: var(--color-warning); }
.wsx-det__star.is-on svg { fill: var(--color-warning); animation: wsx-star-pop var(--duration-slow) var(--ease-out); }
.wsx-det__star:focus-visible { outline: none; box-shadow: 0 0 0 2px var(--color-bg), 0 0 0 3.5px var(--color-primary); }
@keyframes wsx-star-pop { 0% { transform: scale(0.7); } 55% { transform: scale(1.15); } 100% { transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .wsx-det__star.is-on svg { animation: none; } }
.wsx-vis-seg { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; border: 1.5px solid var(--color-border); border-radius: 999px; overflow: hidden; background: var(--color-surface); }
.wsx-vis-seg button { border: 0; background: transparent; padding: 5px 4px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; font: 600 var(--text-xs) var(--font-body); color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast); }
.wsx-vis-seg button:hover { color: var(--color-text); }
.wsx-vis-seg button:focus-visible { outline: none; box-shadow: inset 0 0 0 2px var(--color-primary); }
.wsx-vis-seg .dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; opacity: 0; flex: none; }
.wsx-vis-seg .is-sel { color: var(--color-text); } .wsx-vis-seg .is-sel .dot { opacity: 1; }
.wsx-vis-seg .is-sel.vk-private { background: var(--color-warning-light); } .wsx-vis-seg .is-sel.vk-private .dot { background: var(--color-warning); }
.wsx-vis-seg .is-sel.vk-workspace { background: var(--color-primary-light); } .wsx-vis-seg .is-sel.vk-workspace .dot { background: var(--color-primary); }
.wsx-vis-seg .is-sel.vk-unlisted { background: var(--color-bg-elevated); } .wsx-vis-seg .is-sel.vk-unlisted .dot { background: var(--color-text-tertiary); }
.wsx-vis-seg .is-sel.vk-public { background: var(--color-success-light); } .wsx-vis-seg .is-sel.vk-public .dot { background: var(--color-success); }
.wsx-vis-seg__sub { font: 400 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); margin-top: 5px; }
.wsx-det__secs { display: flex; flex-direction: column; gap: var(--space-3); }
.wsx-det__labeltxt { flex: 1; }
.wsx-det__meta { display: flex; flex-wrap: wrap; gap: 6px; }
.wsx-det__mpill { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px; background: var(--color-surface); font: 600 var(--text-xs) var(--font-body); color: var(--color-text-secondary); }
.wsx-det__mpill .dot { width: 7px; height: 7px; border-radius: 50%; flex: none; }
.wsx-det__mpill svg { flex: none; }
.wsx-det__pages { display: flex; flex-direction: column; gap: 2px; max-height: 220px; overflow-y: auto; }
.wsx-det__page { text-align: left; padding: 5px 8px; border: 0; border-radius: var(--radius-sm); background: none; font: 500 var(--text-sm) var(--font-body); color: var(--color-text-secondary); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-det__page:hover { background: var(--color-surface); color: var(--color-text); }
.wsx-det__page.is-on { background: var(--color-surface); color: var(--color-text); font-weight: 600; }
.wsx-det__sharecard { flex-direction: column; align-items: stretch; gap: 8px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-md); padding: 12px; box-shadow: var(--shadow-sm); }
.wsx-det__sharecard { min-width: 0; max-width: 100%; box-sizing: border-box; }
.wsx-det__sharecard > * { min-width: 0; max-width: 100%; }
.wsx-share__head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.wsx-share__roletog { flex: none; }
.wsx-share__chips .wsx-det__who { max-width: 100%; min-width: 0; box-sizing: border-box; }
.wsx-det__who .em { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-det__who .role, .wsx-det__who button { flex: none; }
.wsx-share__count { font: 400 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); }
.wsx-share__empty { display: flex; align-items: flex-start; gap: 9px; }
.wsx-share__emptyic { color: var(--color-text-tertiary); flex: none; margin-top: 1px; }
.wsx-share__emptyt { font: 500 var(--text-sm) var(--font-body); color: var(--color-text-secondary); }
.wsx-share__emptys { font: 400 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); margin-top: 1px; }
.wsx-share__note { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-share__chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
.wsx-share__kbd { margin-left: auto; font: 500 11px var(--font-mono); padding: 1px 5px; border: 1px solid var(--color-border-strong); border-radius: 5px; color: var(--color-text-tertiary); }
.wsx-folder { position: relative; }
.wsx-folder__btn { width: 100%; justify-content: flex-start; gap: 8px; }
.wsx-folder__btn > svg:first-child { width: 16px; height: 16px; flex: none; color: var(--color-text-tertiary); }
.wsx-folder__path { flex: 1; min-width: 0; display: flex; align-items: center; gap: 4px; overflow: hidden; }
.wsx-folder__seg { color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-folder__seg.is-leaf { color: var(--color-text); flex: none; }
.wsx-folder__sep { color: var(--color-text-tertiary); flex: none; }
.wsx-folder__none { color: var(--color-text-tertiary); }
.wsx-folder__btn > svg:last-child { width: 14px; height: 14px; margin-left: auto; flex: none; opacity: 0.6; }
.wsx-folder__menu { position: absolute; z-index: 100; top: calc(100% + 5px); left: 0; right: 0; max-height: 240px; overflow-y: auto; padding: 5px; background: var(--glass-bg-strong); -webkit-backdrop-filter: blur(16px); backdrop-filter: blur(16px); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl); } .wsx-folder__menu[hidden] { display: none; }
.wsx-folder__opt { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 7px 10px; border: 0; background: transparent; border-radius: var(--radius-sm); cursor: pointer; text-align: left; font: 500 var(--text-sm) var(--font-body); color: var(--color-text); }
.wsx-folder__opt[data-depth] { padding-left: calc(10px + attr(data-depth type(<number>)) * 16px); }
.wsx-folder__opt > svg:first-child { width: 15px; height: 15px; flex: none; color: var(--color-text-tertiary); }
.wsx-folder__optt { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-folder__opt:hover { background: var(--color-primary-light); }
.wsx-folder__opt.is-sel { background: var(--color-primary-light); }
.wsx-folder__opt.is-sel > svg:last-child { width: 14px; height: 14px; color: var(--color-primary); flex: none; }
.wsx-det__recip { margin-top: 8px; } .wsx-det__recip[hidden] { display: none; }
.wsx-det__delact { display: flex; gap: 7px; margin-top: 8px; }
.wsx-det__send { flex: 1; justify-content: center; background: var(--color-primary); color: var(--color-text-inverse); border-color: var(--color-primary); }
.wsx-det__send:hover:not(:disabled) { background: var(--color-primary-hover); border-color: var(--color-primary-hover); }
.wsx-det__send:active:not(:disabled) { transform: scale(0.98); } .wsx-det__send:disabled { opacity: 0.5; cursor: default; }
.wsx-det__sched { justify-content: center; }
.wsx-det__freq { display: flex; gap: 6px; margin-top: 7px; } .wsx-det__freq[hidden] { display: none; }
.wsx-det__freqbtn { flex: 1; justify-content: center; } .wsx-det__delbody:empty { display: none; } .wsx-det__connect { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; } .wsx-det__connhint { margin-top: 8px; font: 400 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); line-height: 1.45; } .wsx-det__connect .wsx-det__connhint { margin-top: 0; } a.wsx-det__send { text-decoration: none; }
/* comments: fixed-bottom composer + mention dropdown */
.wsx-cm { flex: 1; min-height: 0; display: flex; flex-direction: column; padding: 0; gap: 0; }
.wsx-cm__list { flex: 1; min-height: 0; overflow-y: auto; padding: 14px; display: flex; flex-direction: column; gap: 10px; }
.wsx-cm__empty { flex: 1; display: grid; place-items: center; color: var(--color-text-tertiary); font-size: var(--text-sm); padding: 20px; text-align: center; }
/* premium comment composer */
.wsx-cc { position: relative; flex: none; }
.wsx-cc__field, .wsx-cm__replybox { display: flex; flex-direction: column; gap: 2px; padding: 6px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: 0 1px 2px rgba(28,25,23,0.05); transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx-cc__field:focus-within, .wsx-cm__replybox:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.wsx-cc__ta { width: 100%; box-sizing: border-box; resize: none; min-height: 24px; max-height: 160px; border: 0; padding: 6px 8px 2px; font: 400 var(--text-sm) var(--font-body); line-height: 1.5; color: var(--color-text); background: transparent; outline: none; }
.wsx-cc__ta::placeholder { color: var(--color-text-tertiary); }
.wsx-cc__bar { display: flex; align-items: center; gap: 4px; padding: 0 2px; }
.wsx-cc__grow { flex: 1; }
.wsx-cc__tool { width: 30px; height: 30px; display: grid; place-items: center; border: 0; background: transparent; border-radius: var(--radius-sm); color: var(--color-text-tertiary); cursor: pointer; font: 700 15px var(--font-body); transition: background var(--duration-fast), color var(--duration-fast); }
.wsx-cc__tool:hover { background: var(--color-surface); color: var(--color-text); }
.wsx-cc__tool svg { width: 18px; height: 18px; }
.wsx-cc__send { width: 34px; height: 34px; display: grid; place-items: center; border: 0; border-radius: 50%; background: var(--color-primary); color: var(--color-text-inverse); cursor: pointer; transition: background var(--duration-fast), opacity var(--duration-fast); }
.wsx-cc__send svg { width: 17px; height: 17px; }
.wsx-cc__send:hover:not(:disabled) { background: var(--color-primary-hover); }
.wsx-cc__send:disabled { opacity: 0.4; cursor: default; }
.wsx-cc__err { margin-top: 6px; font: 400 var(--text-xs) var(--font-body); color: var(--color-error); }
.wsx-cc__emoji { position: absolute; left: 8px; right: 8px; bottom: calc(100% + 6px); z-index: 7; display: flex; flex-wrap: wrap; gap: 2px; padding: 8px; background: var(--glass-bg-strong); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl); }
.wsx-cc__emoji[hidden] { display: none; }
.wsx-cc__emojibtn { width: 32px; height: 32px; border: 0; background: transparent; border-radius: var(--radius-sm); font-size: 18px; cursor: pointer; line-height: 1; }
.wsx-cc__emojibtn:hover { background: var(--color-surface); }
.wsx-cm__mentions { position: absolute; left: 8px; right: 8px; bottom: calc(100% + 6px); z-index: 7; background: var(--glass-bg-strong); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid var(--color-border); border-radius: var(--radius-md); box-shadow: var(--shadow-xl); max-height: 200px; overflow-y: auto; }
.wsx-cm__mentions[hidden] { display: none; }
.wsx-cm__mention { display: flex; align-items: center; gap: 9px; padding: 8px 11px; cursor: pointer; font: 500 var(--text-sm) var(--font-body); }
.wsx-cm__mention.is-active, .wsx-cm__mention:hover { background: var(--color-primary-light); }
.wsx-cm__mention small { color: var(--color-text-tertiary); }

/* ---- Comments tab (full thread + composer) ---- */
.wsx-cm { padding: 14px; display: flex; flex-direction: column; gap: 12px; min-height: 0; }
.wsx-cm__ta { width: 100%; box-sizing: border-box; resize: none; min-height: 48px; max-height: 200px; border: 0; border-radius: var(--radius-md); padding: 8px 10px; font: 400 var(--text-sm) var(--font-body); line-height: 1.5; color: var(--color-text); background: transparent; outline: none; }
.wsx-cm__ta::placeholder { color: var(--color-text-tertiary); }
.wsx-cm__ta:focus { border: 0; box-shadow: none; }
.wsx-cm__send { align-self: flex-end; padding: 7px 16px; margin: 0 2px 2px; border: 0; border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-text-inverse); font: 600 var(--text-sm) var(--font-body); cursor: pointer; transition: background var(--duration-fast); }
.wsx-cm__send:hover:not(:disabled) { background: var(--color-primary-hover); }
.wsx-cm__send:disabled { opacity: 0.55; cursor: default; }
.wsx-cm__mentiontag { color: var(--color-primary); font-weight: 600; }
.wsx-cm__mtxt { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-cm__mention small { flex: none; }
.wsx-cm__mic { width: 22px; height: 22px; border-radius: 6px; flex: none; display: grid; place-items: center; }
.wsx-cm__mic svg { width: 14px; height: 14px; }
.wsx-cm__mic.is-artifact { background: var(--color-primary-light); color: var(--color-primary); }
.wsx-cm__mic.is-source { background: color-mix(in srgb, var(--color-success) 16%, transparent); color: var(--color-success); }
.wsx-cm__mic.is-tag { background: var(--color-surface); color: var(--color-text-secondary); font: 700 12px var(--font-body); }
/* mention chips inside rendered comment bodies, class-distinct */
.wsx-cm__ent { display: inline-flex; align-items: center; gap: 3px; padding: 0 5px; border-radius: 5px; font-weight: 600; font-size: 0.95em; line-height: 1.45; text-decoration: none; vertical-align: baseline; }
.wsx-cm__ent svg { width: 12px; height: 12px; flex: none; }
.wsx-cm__ent.is-user { color: var(--color-primary); background: var(--color-primary-light); }
.wsx-cm__ent.is-artifact { color: var(--color-primary); background: var(--color-primary-light); cursor: pointer; }
.wsx-cm__ent.is-artifact:hover { text-decoration: underline; }
.wsx-cm__ent.is-source { color: var(--color-success); background: color-mix(in srgb, var(--color-success) 14%, transparent); }
.wsx-cm__ent.is-tag { color: var(--color-text-secondary); background: var(--color-surface); }
.wsx-cc--reply { margin-top: 8px; }
.wsx-cm__pin { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; margin: 1px 0 5px; padding: 3px 9px 3px 7px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; transition: border-color var(--duration-fast), color var(--duration-fast); }
.wsx-cm__pin:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-cm__pin svg { width: 13px; height: 13px; flex: none; }
.wsx-cm__pin span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-cm__list { display: flex; flex-direction: column; gap: 10px; }
.wsx-cm__row { padding: 11px 13px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); }
.wsx-cm__kids { margin-top: 8px; padding-left: 12px; border-left: 2px solid var(--color-border); display: flex; flex-direction: column; gap: 8px; }
.wsx-cm__top { display: flex; align-items: center; gap: 8px; margin-bottom: 5px; }
.wsx-cm__av { width: 22px; height: 22px; border-radius: 50%; flex: none; display: grid; place-items: center; background: var(--color-primary-light); color: var(--color-primary); font: 700 10px var(--font-body); }
.wsx-cm__who { font: 600 var(--text-sm) var(--font-body); }
.wsx-cm__ago { font-size: var(--text-xs); color: var(--color-text-tertiary); margin-left: auto; }
.wsx-cm__body { font-size: var(--text-sm); line-height: 1.5; color: var(--color-text-secondary); white-space: pre-wrap; word-break: break-word; }
.wsx-cm__agent { font: 600 10px var(--font-body); text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-primary); }
.wsx-cm__done { font-size: var(--text-xs); color: var(--color-success); margin-top: 4px; }
.wsx-cm__reply { background: transparent; border: 0; padding: 4px 0 0; color: var(--color-text-tertiary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; }
.wsx-cm__reply:hover { color: var(--color-primary); }
.wsx-cm__reply + .wsx-cm__reply { margin-left: 12px; }
.wsx-cm__filter { display: flex; gap: 6px; padding: 10px 14px 0; flex: none; }
.wsx-cm__fbtn { padding: 3px 10px; border: 1px solid var(--color-border); border-radius: 999px; background: transparent; color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; }
.wsx-cm__fbtn span { color: var(--color-text-tertiary); font-weight: 500; }
.wsx-cm__fbtn.is-on { border-color: var(--color-primary); background: var(--color-primary-light); color: var(--color-primary); }
.wsx-cm__rv { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 5px; }
.wsx-cm__ver, .wsx-cm__asg { padding: 1px 7px; border-radius: 999px; font: 600 var(--text-xs) var(--font-body); background: var(--color-surface); color: var(--color-text-secondary); }
.wsx-cm__asg { background: var(--color-primary-light); color: var(--color-primary); }
.wsx-cm__picker { margin-top: 6px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); box-shadow: var(--shadow-xl); max-height: 200px; overflow-y: auto; }
.wsx-cm__picker .wsx-cm__mention:hover { background: var(--color-primary-light); }
.wsx-det__approve { align-self: flex-start; }
.wsx-vh__rv { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-cm__replybox { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; }

/* ---- Details: analytics (minimal, no boxed empty state) ---- */
.wsx-det__stats { padding-top: 2px; }
.wsx-det__statempty { font-size: var(--text-sm); color: var(--color-text-tertiary); padding: 2px 0; }

/* ---- Automate: quick-action tiles ---- */
.wsx-auto { padding: 14px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
.wsx-qa-grid { display: flex; flex-direction: column; gap: 8px; }
.wsx-qa { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 12px 14px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); box-shadow: 0 1px 2px rgba(28,25,23,0.04); cursor: pointer; transition: border-color var(--duration-fast), box-shadow var(--duration-fast), transform var(--duration-fast); }
.wsx-qa:hover { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.wsx-qa__ic { width: 36px; height: 36px; flex: none; display: grid; place-items: center; border-radius: var(--radius-sm); background: var(--color-primary-light); color: var(--color-primary); }
.wsx-qa__txt { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.wsx-qa__t { font: 700 var(--text-sm) var(--font-body); color: var(--color-text); }
.wsx-qa__s { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-auto__chat { display: flex; align-items: center; gap: 8px; width: 100%; justify-content: center; margin-top: 4px; padding: 10px 12px; border: 1px dashed var(--color-border-strong); border-radius: var(--radius-md); background: transparent; color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; transition: border-color var(--duration-fast), color var(--duration-fast); }
.wsx-auto__chat:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-auto__chat svg { width: 16px; height: 16px; flex: none; }

/* version history (inspector-history.ts) */
.wsx-vh { padding: 12px; display: flex; flex-direction: column; gap: 10px; }
.wsx-vh__cmp { display: flex; align-items: center; gap: 6px; }
.wsx-vh__cmp select { flex: 1 1 0; min-width: 0; padding: 5px 8px; }
.wsx-vh__cmp .wsx-abtn { flex: none; }
.wsx-vh__list { display: flex; flex-direction: column; gap: 6px; }
.wsx-vh__row { padding: 10px 12px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wsx-vh__row.is-live { border-color: color-mix(in srgb, var(--color-success) 45%, var(--color-border)); }
.wsx-vh__top { display: flex; align-items: center; gap: 8px; }
.wsx-vh__no { font: 600 var(--text-sm) var(--font-mono); }
.wsx-vh__size { margin-left: auto; font-size: var(--text-xs); color: var(--color-text-tertiary); font-variant-numeric: tabular-nums; }
.wsx-vh__note { font-size: var(--text-xs); color: var(--color-text-secondary); overflow-wrap: anywhere; }
.wsx-vh__ai { display: inline-block; margin-right: 5px; padding: 0 6px; border-radius: 999px; background: var(--color-surface); color: var(--color-text-tertiary); font: 600 10px/16px var(--font-body); letter-spacing: 0.02em; vertical-align: 1px; }
.wsx-det__change { margin-top: 8px; font-size: var(--text-xs); color: var(--color-text-secondary); overflow-wrap: anywhere; }
.wsx-vh__acts { display: flex; flex-wrap: wrap; gap: 4px 14px; margin-top: 4px; }
.wsx-vh__acts .wsx-link { font-size: var(--text-xs); }
.wsx-vh__more { text-align: center; }
.wsx-vd-overlay { z-index: 1200; }
.wsx-vd { --soc-modal-width: min(980px, calc(100vw - 32px)); height: min(760px, calc(100vh - 48px)); }
.wsx-vd__body { padding: 0; display: flex; flex-direction: column; }
.wsx-vd__body.is-preview { overflow: hidden; }
.wsx-vd__stats { padding: 8px 16px; font-size: var(--text-xs); color: var(--color-text-secondary); border-bottom: 1px solid var(--color-border); position: sticky; top: 0; background: var(--color-bg-elevated); z-index: 1; }
.wsx-vd__stats .k-add, .wsx-vd__mk { font-weight: 600; }
.wsx-vd__stats .k-add { color: var(--color-success); }
.wsx-vd__stats .k-del { color: var(--color-error); font-weight: 600; }
.wsx-vd__code { font: var(--text-xs)/1.55 var(--font-mono); padding: 4px 0 12px; }
.wsx-vd__ln { display: grid; grid-template-columns: 44px 44px 18px 1fr; }
.wsx-vd__ln code { font: inherit; white-space: pre-wrap; overflow-wrap: anywhere; padding-right: 12px; }
.wsx-vd__no { color: var(--color-text-tertiary); text-align: right; padding-right: 8px; user-select: none; }
.wsx-vd__mk { text-align: center; user-select: none; }
.wsx-vd__ln.k-add { background: var(--color-success-light); }
.wsx-vd__ln.k-add .wsx-vd__mk { color: var(--color-success); }
.wsx-vd__ln.k-del { background: var(--color-error-light); }
.wsx-vd__ln.k-del .wsx-vd__mk { color: var(--color-error); }
.wsx-vd__fold { display: block; width: 100%; border: 0; border-block: 1px dashed var(--color-border); background: var(--color-surface); color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); padding: 4px 0; cursor: pointer; }
.wsx-vd__fold:hover { color: var(--color-primary); }
.wsx-vd__hint { padding: 8px 16px; border-bottom: 1px solid var(--color-border); }
.wsx-vd__frame { flex: 1; width: 100%; border: 0; background: var(--color-bg); }
.wsx-vd__foot { justify-content: flex-end; }
.wsx-vd__foot .so-c-btn { flex: none; }
.wsx__sharewrap { position: relative; flex: none; order: 99; }
.wsx__sharewrap[hidden] { display: none; }
.wsx-sharepop { position: absolute; top: calc(100% + 8px); right: 0; z-index: 30; width: min(360px, calc(100vw - 32px)); box-sizing: border-box; display: flex; flex-direction: column; gap: 10px; padding: 14px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); }
.wsx-sharepop__title { font: 700 var(--text-base) var(--font-display, var(--font-body)); color: var(--color-text); }
.wsx-sharepop__copy { align-self: flex-start; }
.wsx-sharepop__copy svg { width: 15px; height: 15px; }
`;
