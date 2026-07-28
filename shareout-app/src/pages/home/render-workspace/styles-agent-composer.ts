/**
 * Agent dock, floating composer, responsive breakpoints, and table view.
 * Split out of styles.ts to stay under the per-module line cap; concatenated into
 * WORKSPACE_STYLES in the same cascade position so order is unchanged.
 */
export const WORKSPACE_AGENT_COMPOSER_STYLES = `/* ---- agent dock (inside canvas) ---- */
.wsx__dock { flex: none; border-top: 1px solid var(--color-border); background: var(--color-bg-elevated); padding: 12px clamp(12px, 3vw, 28px); }
.wsx__thread { max-width: 820px; margin: 0 auto 10px; max-height: 38vh; overflow-y: auto; padding: 12px 14px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-lg); position: relative; }
.wsx__thread[hidden] { display: none; }
.wsx__threadclose { position: absolute; top: 8px; right: 10px; border: 0; background: transparent; color: var(--color-text-tertiary); cursor: pointer; font-size: 14px; }
.wsx__threadlist { display: flex; flex-direction: column; gap: 12px; }
/* message rows: avatar + column, grouped (consecutive same-role) hides chrome */
.wsx-row { display: flex; gap: 9px; align-items: flex-start; max-width: 100%; }
.wsx-row.user { flex-direction: row-reverse; }
.wsx-row.grouped { margin-top: -6px; }
.wsx-av { width: 26px; height: 26px; border-radius: 50%; flex: none; display: grid; place-items: center; font: 600 12px var(--font-body); line-height: 1; }
.wsx-av.bot { background: var(--color-primary-light); color: var(--color-primary); }
.wsx-av.user { background: var(--color-surface); color: var(--color-text-secondary); }
.wsx-row.grouped .wsx-av { visibility: hidden; }
.wsx-col { display: flex; flex-direction: column; gap: 4px; min-width: 0; max-width: 86%; }
.wsx-row.user .wsx-col { align-items: flex-end; }
.wsx-meta { display: flex; gap: 7px; align-items: baseline; font-size: var(--text-xs); color: var(--color-text-tertiary); padding: 0 2px; }
.wsx-meta__name { font-weight: 600; color: var(--color-text-secondary); }
.wsx-msg { font-size: var(--text-sm); line-height: 1.55; padding: 8px 12px; border-radius: var(--radius-md); word-break: break-word; overflow-wrap: anywhere; }
.wsx-msg.user { background: var(--color-primary); color: var(--color-text-inverse); border-bottom-right-radius: var(--radius-xs, 4px); }
.wsx-msg.bot { background: var(--color-surface); color: var(--color-text); border-bottom-left-radius: var(--radius-xs, 4px); }
.wsx-msg.bot.is-typing { color: var(--color-text-tertiary); }
.wsx-msg.is-streaming::after { content: '\\u258C'; margin-left: 1px; color: var(--color-primary); animation: wsx-caret 1s steps(1) infinite; }
@keyframes wsx-caret { 50% { opacity: 0; } }
/* markdown blocks inside a bot bubble */
.wsx-msg.bot p { margin: 0 0 7px; } .wsx-msg.bot p:last-child { margin-bottom: 0; }
.wsx-msg.bot .wsx-h { font: 700 var(--text-sm) var(--font-body); margin: 8px 0 4px; }
.wsx-msg.bot .wsx-ul, .wsx-msg.bot .wsx-ol { margin: 4px 0 7px; padding-left: 20px; }
.wsx-msg.bot li { margin: 2px 0; }
.wsx-msg.bot code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.92em; background: var(--color-bg); padding: 1px 5px; border-radius: 5px; }
.wsx-msg.bot .wsx-pre { margin: 6px 0; padding: 10px 12px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-sm); overflow-x: auto; }
.wsx-msg.bot .wsx-pre code { background: transparent; padding: 0; font-size: 0.86em; line-height: 1.5; white-space: pre; }
.wsx-msg.bot .wsx-bq { margin: 6px 0; padding: 2px 0 2px 11px; border-left: 3px solid var(--color-border-strong); color: var(--color-text-secondary); }
.wsx-msg.bot .wsx-hr { border: 0; border-top: 1px solid var(--color-border); margin: 9px 0; }
.wsx-msg.bot a { color: var(--color-primary); }
/* copy affordance under bot bubbles */
.wsx-copy { align-self: flex-start; border: 0; background: transparent; color: var(--color-text-tertiary); font: 600 var(--text-xs) var(--font-body); padding: 1px 2px; cursor: pointer; opacity: 0; transition: opacity var(--duration-fast); }
.wsx-row.bot:hover .wsx-copy { opacity: 1; }
.wsx-copy:hover { color: var(--color-primary); }
/* inline artifact cards */
.wsx-cards { display: flex; flex-direction: column; gap: 7px; }
.wsx-card { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; padding: 9px 11px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); cursor: pointer; transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx-card:hover { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.wsx-card__ic { font-size: 18px; flex: none; line-height: 1; }
.wsx-card__main { display: flex; flex-direction: column; gap: 1px; min-width: 0; flex: 1; }
.wsx-card__top { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-card__sub { font-size: var(--text-xs); color: var(--color-text-tertiary); text-transform: capitalize; }
.wsx-card__go { font: 600 var(--text-xs) var(--font-body); color: var(--color-primary); flex: none; }
/* inline media */
.wsx-media { margin: 0; max-width: 100%; }
.wsx-media img { max-width: 100%; border-radius: var(--radius-md); border: 1px solid var(--color-border); display: block; }
.wsx-media figcaption { font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: 4px; }
.wsx-file { display: inline-flex; align-items: center; gap: 6px; padding: 7px 11px; border: 1px solid var(--color-border); border-radius: var(--radius-md); background: var(--color-bg-elevated); color: var(--color-text); font: 600 var(--text-sm) var(--font-body); text-decoration: none; }
.wsx-file:hover { border-color: var(--color-primary); }
/* build-in-progress widget */
.wsx-build { padding: 12px 14px; border: 1px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary-light); display: flex; flex-direction: column; gap: 7px; }
.wsx-build__head { display: flex; align-items: center; gap: 9px; font: 700 var(--text-sm) var(--font-body); color: var(--color-text); }
.wsx-build__spin { width: 14px; height: 14px; flex: none; border: 2px solid color-mix(in srgb, var(--color-primary) 35%, transparent); border-top-color: var(--color-primary); border-radius: 50%; animation: wsx-spin 0.8s linear infinite; }
.wsx-build__spin.is-done { border: 0; animation: none; } .wsx-build__spin.is-done::after { content: '\\u2713'; color: var(--color-success); font-weight: 700; }
@keyframes wsx-spin { to { transform: rotate(360deg); } }
/* shared inline spinner + busy affordances (design-system) */
.wsx-spin { display: inline-block; width: 13px; height: 13px; flex: none; vertical-align: -2px; border: 2px solid color-mix(in srgb, currentColor 28%, transparent); border-top-color: currentColor; border-radius: 50%; animation: wsx-spin 0.7s linear infinite; }
.wsx-loading { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 22px 14px; font-size: var(--text-sm); color: var(--color-text-tertiary); }
.wsx-abtn.is-busy, .wsx-atbl__act.is-busy { pointer-events: none; opacity: 0.7; }
.wsx-abtn.is-busy::before, .wsx-atbl__act.is-busy::before { content: ''; width: 13px; height: 13px; flex: none; margin-right: 6px; border: 2px solid color-mix(in srgb, currentColor 28%, transparent); border-top-color: currentColor; border-radius: 50%; animation: wsx-spin 0.7s linear infinite; }
.wsx-atbl__act.is-busy { display: inline-flex; align-items: center; }
.wsx-build__step { font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-build__line { font-size: var(--text-sm); color: var(--color-text); }
.wsx-build__open { align-self: flex-start; margin-top: 2px; padding: 6px 14px; border: 0; border-radius: var(--radius-sm); background: var(--color-primary); color: var(--color-text-inverse); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-build__open:hover { background: var(--color-primary-hover); }
/* rich approval card */
.wsx-approve { padding: 12px 14px; border: 1.5px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary-light); display: flex; flex-direction: column; gap: 5px; }
.wsx-approve.is-danger { border-color: var(--color-error); background: color-mix(in srgb, var(--color-error) 9%, transparent); }
.wsx-approve__title { font: 700 var(--text-sm) var(--font-body); color: var(--color-text); }
.wsx-approve__subject { font: 600 var(--text-sm) var(--font-body); color: var(--color-primary); }
.wsx-approve.is-danger .wsx-approve__subject { color: var(--color-error); }
.wsx-approve__detail { font-size: var(--text-sm); color: var(--color-text-secondary); line-height: 1.5; }
.wsx-approve__lines { margin: 2px 0 0; padding-left: 18px; font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-approve__lines li { margin: 1px 0; word-break: break-all; }
.wsx-approve__row { display: flex; gap: 8px; margin-top: 6px; }
.wsx-approve__ok { padding: 6px 14px; border: 0; border-radius: var(--radius-sm); background: var(--color-primary); color: var(--color-text-inverse); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-approve.is-danger .wsx-approve__ok { background: var(--color-error); }
.wsx-approve__no { padding: 6px 14px; border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-confirm { align-self: flex-start; max-width: 92%; padding: 11px 13px; border: 1.5px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary-light); }
.wsx-confirm__p { font-size: var(--text-sm); color: var(--color-text); margin-bottom: 9px; }
.wsx-confirm__row { display: flex; gap: 8px; }
.wsx-confirm__ok { padding: 6px 14px; border: 0; border-radius: var(--radius-sm); background: var(--color-primary); color: var(--color-text-inverse); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-confirm__ok:disabled { opacity: 0.6; cursor: default; }
.wsx-confirm__no { padding: 6px 14px; border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
/* stop-generating pill + scroll-to-latest pill */
.wsx-stop { position: absolute; left: 50%; transform: translateX(-50%); bottom: 62px; z-index: 5; padding: 5px 14px; border: 1px solid var(--color-border-strong); border-radius: 999px; background: var(--glass-bg-strong); -webkit-backdrop-filter: blur(10px); backdrop-filter: blur(10px); color: var(--color-text); font: 600 var(--text-xs) var(--font-body); cursor: pointer; box-shadow: var(--shadow-md); }
.wsx-stop[hidden] { display: none; }
.wsx-stop:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx__scrolldown { position: absolute; right: 14px; bottom: 12px; z-index: 4; width: 30px; height: 30px; display: grid; place-items: center; border: 1px solid var(--color-border); border-radius: 50%; background: var(--color-bg-elevated); color: var(--color-text-secondary); cursor: pointer; box-shadow: var(--shadow-sm); }
.wsx__scrolldown[hidden] { display: none; }
.wsx__scrolldown:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx__scrolldown svg { width: 16px; height: 16px; }
/* Unread badge on the jump button — "N new" while the reader is scrolled away. [8] */
.wsx__scrolldown[data-count]:not([data-count=""])::after { content: attr(data-count); position: absolute; top: -6px; right: -6px; min-width: 16px; height: 16px; padding: 0 4px; display: grid; place-items: center; border-radius: 8px; background: var(--color-primary); color: var(--color-text-inverse); font: 600 10px/1 var(--font-body); }
/* Off-screen rows skip layout/paint — keeps long threads responsive. [14] */
.wsx__threadlist > .wsx-row { content-visibility: auto; contain-intrinsic-size: auto 56px; }
/* In-thread search highlights + load-earlier control. [10,14] */
.wsx-row mark.cc-hit { background: var(--color-primary-light); color: inherit; border-radius: 2px; }
.wsx-row mark.cc-hit-active { background: var(--color-primary); color: var(--color-text-inverse); }
.wsx-loadearlier { align-self: center; margin: 4px 0 8px; border: 1px solid var(--color-border); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 600 var(--text-xs) var(--font-body); padding: 4px 12px; border-radius: 999px; cursor: pointer; }
.wsx-loadearlier:hover { border-color: var(--color-primary); color: var(--color-primary); }
.wsx__searchbar { max-width: 820px; margin: 0 auto 6px; display: flex; align-items: center; gap: 6px; padding: 6px 10px; background: var(--color-bg); border: 1px solid var(--color-border); border-radius: var(--radius-lg); }
.wsx__searchbar[hidden] { display: none; }
.wsx__searchinput { flex: 1; border: 0; background: transparent; color: var(--color-text); font: var(--text-sm) var(--font-body); outline: none; }
.wsx__searchcount { font: var(--text-xs) var(--font-body); color: var(--color-text-tertiary); min-width: 40px; text-align: right; }
.wsx__searchbar button { display: grid; place-items: center; width: 26px; height: 26px; border: 0; background: transparent; color: var(--color-text-secondary); cursor: pointer; border-radius: var(--radius-sm); }
.wsx__searchbar button:hover { background: var(--color-surface); color: var(--color-primary); }
.wsx__searchbar svg { width: 15px; height: 15px; }
/* chat history drawer (overlays the thread within the composer) */
.wsx__threads { position: absolute; left: 0; right: 0; top: 49px; bottom: 0; z-index: 6; display: flex; flex-direction: column; background: var(--color-bg); }
.wsx__threads[hidden] { display: none; }
.wsx__threads-head { display: flex; align-items: center; justify-content: space-between; padding: 11px 14px; border-bottom: 1px solid var(--color-border); font: 700 var(--text-sm) var(--font-body); }
.wsx__threads-head button { border: 0; background: transparent; color: var(--color-text-tertiary); cursor: pointer; display: grid; place-items: center; width: 26px; height: 26px; border-radius: var(--radius-sm); }
.wsx__threads-head button:hover { background: var(--color-surface); color: var(--color-text); }
.wsx__threads-head svg { width: 16px; height: 16px; }
.wsx__threads-list { flex: 1; min-height: 0; overflow-y: auto; padding: 8px; display: flex; flex-direction: column; gap: 2px; }
.wsx-thread { display: flex; align-items: center; gap: 4px; border-radius: var(--radius-md); padding: 2px; transition: background var(--duration-fast); }
.wsx-thread:hover { background: var(--color-surface); }
.wsx-thread.is-active { background: var(--color-primary-light); }
.wsx-thread__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; text-align: left; border: 0; background: transparent; padding: 8px 9px; cursor: pointer; }
.wsx-thread__title { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-thread__preview { font-size: var(--text-xs); color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-thread__act { flex: none; width: 26px; height: 26px; border: 0; background: transparent; color: var(--color-text-tertiary); border-radius: var(--radius-sm); cursor: pointer; opacity: 0; font-size: 14px; }
.wsx-thread:hover .wsx-thread__act { opacity: 1; }
.wsx-thread__act:hover { background: var(--color-bg-elevated); color: var(--color-text); }
.wsx__dockbar { display: flex; align-items: center; gap: 10px; max-width: 820px; margin: 0 auto; padding: 7px 7px 7px 16px; border: 1.5px solid var(--color-border-strong); border-radius: 999px; background: var(--color-bg); box-shadow: var(--shadow-sm); }
.wsx__dockbar svg { color: var(--color-primary); flex: none; }
.wsx__dockinput { flex: 1; border: 0; background: transparent; font: 400 var(--text-base) var(--font-body); color: var(--color-text); outline: none; }
.wsx__docksend { width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--color-primary); color: var(--color-text-inverse); display: grid; place-items: center; cursor: pointer; flex: none; }
.wsx__docksend svg { color: var(--color-text-inverse); }
.wsx__dockmic { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; display: grid; place-items: center; cursor: pointer; flex: none; }
.wsx__dockmic svg { color: var(--color-text-muted); width: 18px; height: 18px; }
.wsx__dockmic:hover svg { color: var(--color-primary); }
.wsx__dockmic[data-state="recording"] { background: var(--color-error); }
.wsx__dockmic[data-state="recording"] svg { color: var(--color-text-inverse); animation: wsxMicPulse 1.2s ease-in-out infinite; }
.wsx__dockmic[data-state="busy"] { opacity: 0.6; cursor: default; }
.wsx__dockattach { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; display: grid; place-items: center; cursor: pointer; flex: none; }
.wsx__dockattach svg { color: var(--color-text-muted); width: 18px; height: 18px; }
.wsx__dockattach:hover svg { color: var(--color-primary); }
.wsx__dockattach.is-busy { opacity: 0.6; cursor: default; }
.wsx__attachchip { max-width: 820px; margin: 0 auto 6px; padding: 0 12px; }
.wsx__attachchip:not([hidden]) { display: flex; }
.wsx__attachchip__pill { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px 4px 12px; border-radius: 999px; background: var(--color-bg-muted); border: 1px solid var(--color-border); font-size: 13px; max-width: 100%; }
.wsx__attachchip__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx__attachchip__x { border: 0; background: transparent; cursor: pointer; color: var(--color-text-muted); padding: 0 2px; line-height: 1; }
.wsx__attachchip__x:hover { color: var(--color-text); }
.wsx__composer .wsx__attachchip { max-width: none; margin: 0 12px 6px; }
@keyframes wsxMicPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

@keyframes wsx-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 45%, transparent); } 70% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--color-success) 0%, transparent); } 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 0%, transparent); } }
@media (max-width: 1100px) { .wsx__body { grid-template-columns: var(--wsx-rail) minmax(0,1fr); } .wsx__activity { display: none; } }
@media (max-width: 720px) { .wsx__body { grid-template-columns: 1fr; } }
@media (prefers-reduced-motion: reduce) { .wsx__live-dot { animation: none; } }

/* ===== Home: contextual inspector hidden — canvas gets the room ===== */
.wsx.is-home .wsx__activity { display: none; }
.wsx.is-home .wsx__body { grid-template-columns: var(--wsx-rail) minmax(0,1fr) 0; }

/* ===== composer (chat): one floating layer — resting · sheet · docked ===== */
.wsx__scrim { position: absolute; inset: 0; z-index: 30; background: color-mix(in srgb, var(--color-text) 6%, transparent); -webkit-backdrop-filter: blur(1px); backdrop-filter: blur(1px); opacity: 0; transition: opacity var(--duration-normal, .2s) var(--ease-out-expo); }
.wsx__scrim[hidden] { display: none; }
.wsx.is-composer-sheet .wsx__scrim { opacity: 1; }
.wsx__help-scrim { position: fixed; inset: 0; z-index: 49; background: color-mix(in srgb, var(--color-text) 10%, transparent); }
.wsx__help-scrim[hidden] { display: none; }
.wsx__help-panel { position: fixed; left: 18px; bottom: 72px; z-index: 50; width: min(360px, calc(100vw - 36px)); display: flex; flex-direction: column; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-xl); overflow: hidden; }
.wsx__help-panel[hidden] { display: none; }
.wsx__help-head { display: flex; align-items: center; justify-content: space-between; padding: 12px 14px; border-bottom: 1px solid var(--color-border); font: 600 var(--text-sm) var(--font-body); }
.wsx__help-head button { border: 0; background: transparent; color: var(--color-text-tertiary); cursor: pointer; display: grid; place-items: center; }
.wsx__help-body { padding: 14px; display: flex; flex-direction: column; gap: 8px; }
.wsx__help-body .wsx-field__in { width: 100%; box-sizing: border-box; }
.wsx__help-body .wsx-field__ta { min-height: 96px; }
.wsx__help-actions { display: flex; align-items: center; gap: 10px; margin-top: 0; }
.wsx__help-mine { margin-top: 14px; }
.wsx__help-minetitle { font: 600 var(--text-xs) var(--font-body); color: var(--color-text-secondary); margin-bottom: 6px; }
.wsx__help-mineitem { display: flex; flex-direction: column; gap: 2px; padding: 6px 0; border-top: 1px solid var(--color-border); font: 500 var(--text-sm) var(--font-body); }
.wsx__composer { position: absolute; z-index: 40; display: flex; flex-direction: column; background: var(--glass-bg-strong); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); border: 1px solid var(--color-border); box-shadow: var(--shadow-xl); overflow: hidden; transition: width var(--duration-normal, .22s) var(--ease-out-expo), height var(--duration-normal, .22s) var(--ease-out-expo), max-height var(--duration-normal, .22s) var(--ease-out-expo), border-radius var(--duration-fast); }
.wsx__composer.is-resizing { transition: none; user-select: none; } /* drag grip resizes the open panel height */
.wsx__composer[data-state="resting"] { left: calc(50% + (var(--wsx-rail) - var(--wsx-rightcol)) / 2); transform: translateX(-50%); bottom: 18px; width: min(680px, 92%); max-height: 60px; border-radius: 999px; box-shadow: var(--shadow-lg); }
.wsx__composer[data-state="sheet"] { left: calc(50% + (var(--wsx-rail) - var(--wsx-rightcol)) / 2); transform: translateX(-50%); bottom: 18px; width: min(740px, 94%); height: var(--wsx-sheet-h, min(480px, 52vh)); max-height: calc(100vh - 36px); border-radius: var(--radius-2xl); }
.wsx__composer-grip { display: none; } .wsx__composer[data-state="sheet"] .wsx__composer-grip { display: block; position: absolute; top: 0; left: 0; right: 0; height: 12px; cursor: ns-resize; z-index: 3; touch-action: none; } .wsx__composer-grip::after { content: ""; position: absolute; top: 5px; left: 50%; transform: translateX(-50%); width: 40px; height: 4px; border-radius: 999px; background: var(--color-border); transition: background var(--duration-fast); } .wsx__composer-grip:hover::after { background: var(--color-text-tertiary); }
.wsx__composer-bar { display: none; align-items: center; gap: 8px; padding: 11px 8px 11px 16px; border-bottom: 1px solid var(--color-border); flex: none; } .wsx__composer[data-state="sheet"] .wsx__composer-bar { display: flex; }
.wsx__composer-title { font: 700 var(--text-sm) var(--font-body); display: inline-flex; align-items: center; gap: 7px; }
.wsx__composer-title .wsx__live-dot { width: 7px; height: 7px; }
.wsx__composer-btns { margin-left: auto; display: flex; gap: 2px; }
.wsx__composer-btns button { width: 30px; height: 30px; display: grid; place-items: center; border: 0; background: transparent; border-radius: var(--radius-sm); color: var(--color-text-tertiary); cursor: pointer; }
.wsx__composer-btns button:hover { background: var(--color-surface); color: var(--color-text); }
.wsx__composer .wsx__thread { flex: 1; min-height: 0; max-height: none; max-width: none; margin: 0; border: 0; border-radius: 0; background: transparent; overflow-y: auto; padding: 14px 16px; }
.wsx__composer[data-state="resting"] .wsx__thread { display: none; }
.wsx__composer .wsx__thread[hidden] { display: none; }
.wsx__composer .wsx__dockbar { margin: 0; max-width: none; border: 0; box-shadow: none; background: transparent; border-radius: 0; }
.wsx__composer[data-state="resting"] .wsx__dockbar { padding: 7px 7px 7px 18px; }
.wsx__composer[data-state="sheet"] .wsx__dockbar { border-top: 1px solid var(--color-border); padding: 10px 12px; }

/* ===== widgets that self-hide when empty + activity-as-widget ===== */
.wsx-widget.is-empty-hidden { display: none; }
.wsx-actwidget { position: relative; }
.wsx-actwidget .wsx-widget__body { padding: 0; max-height: 460px; }
.wsx-actwidget .wsx__actbar { border-bottom: 1px solid var(--color-border); }

/* ===== tile/table toggle + table view ===== */
.wsx-viewseg { display: inline-flex; gap: 2px; margin-left: 8px; background: var(--color-surface); border-radius: 8px; padding: 2px; flex: none; }
#wsxArtChips .wsx-viewseg { margin-left: auto; }
/* "Recently deleted" trigger — quiet text link at the far right of the filter row */
.wsx-trash-link { display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; border: 0; background: transparent; color: var(--color-text-tertiary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; border-radius: var(--radius-sm); transition: color var(--duration-fast), background var(--duration-fast); }
.wsx-trash-link svg { width: 14px; height: 14px; }
.wsx-trash-link:hover { color: var(--color-text); background: var(--color-surface); }
.wsx-viewseg button { display: grid; place-items: center; width: 26px; height: 24px; border: 0; background: transparent; color: var(--color-text-tertiary); border-radius: 6px; cursor: pointer; }
.wsx-viewseg button svg { width: 15px; height: 15px; }
.wsx-viewseg button.is-on { background: var(--color-bg-elevated); color: var(--color-text); box-shadow: var(--shadow-xs, 0 1px 2px rgba(0,0,0,.06)); }
.wsx-tbl { display: flex; flex-direction: column; padding: 4px 0; }
.wsx-tbl__head, .wsx-tr { display: grid; grid-template-columns: 22px minmax(0,1fr) 88px 60px 104px; gap: 10px; align-items: center; padding: 8px 14px; }
.wsx-tbl__head { font: 600 var(--text-xs) var(--font-body); text-transform: uppercase; letter-spacing: 0.05em; color: var(--color-text-tertiary); border-bottom: 1px solid var(--color-border); }
.wsx-tr { border-bottom: 1px solid var(--color-border); text-decoration: none; color: inherit; }
.wsx-tr:last-child { border-bottom: 0; }
.wsx-tr:hover { background: var(--color-surface); }
.wsx-tr__icon { width: 22px; height: 22px; display: grid; place-items: center; color: var(--type-color, var(--color-primary)); }
.wsx-tr__icon svg { width: 17px; height: 17px; }
.wsx-tr__name { font: 600 var(--text-sm) var(--font-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-tr__type { font-size: var(--text-xs); color: var(--color-text-secondary); text-transform: capitalize; }
.wsx-tr__views { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-tr__date { font-size: var(--text-xs); color: var(--color-text-tertiary); text-align: right; }
@media (max-width: 560px) {
  .wsx-tbl__head, .wsx-tr { grid-template-columns: 22px minmax(0,1fr) 88px; }
  .wsx-tr__type, .wsx-tr__views, .wsx-tbl__head span:nth-child(3), .wsx-tbl__head span:nth-child(4) { display: none; }
}

/* dismiss (×) on actionable Needs-you rows */
.wsx-ev, .wsx-tl { position: relative; }
.wsx-ev__x, .wsx-tl__x { position: absolute; top: 6px; right: 6px; width: 20px; height: 20px; display: grid; place-items: center; border: 0; background: var(--color-bg-elevated); color: var(--color-text-tertiary); border-radius: 50%; cursor: pointer; font-size: 14px; line-height: 1; opacity: 0; transition: opacity var(--duration-fast), color var(--duration-fast), background var(--duration-fast); }
.wsx-ev:hover .wsx-ev__x, .wsx-tl:hover .wsx-tl__x { opacity: 1; }
.wsx-ev__x:hover, .wsx-tl__x:hover { color: var(--color-error); background: var(--color-error-light); }
`;
