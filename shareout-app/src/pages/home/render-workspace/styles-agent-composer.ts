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
.wsx__threadlist { display: flex; flex-direction: column; gap: 14px; }
/* message rows: user = quiet neutral bubble (right); assistant = full-width text, no bubble */
.wsx-row { display: flex; align-items: flex-start; max-width: 100%; }
.wsx-row.user { justify-content: flex-end; }
.wsx-row.grouped { margin-top: -8px; }
.wsx__threadlist > .wsx-row { animation: wsx-rise 180ms var(--ease-out-expo) both; }
@keyframes wsx-rise { from { opacity: 0; transform: translateY(4px); } }
@media (prefers-reduced-motion: reduce) { .wsx__threadlist > .wsx-row { animation: none; } }
.wsx-col { display: flex; flex-direction: column; gap: 4px; min-width: 0; width: 100%; }
.wsx-row.user .wsx-col { align-items: flex-end; width: auto; max-width: 85%; }
.wsx-msg { font-size: var(--text-sm); line-height: 1.65; word-break: break-word; overflow-wrap: anywhere; }
.wsx-msg.user { padding: 11px 16px; background: color-mix(in srgb, var(--color-primary) 14%, var(--color-bg-elevated)); color: var(--color-text); border-radius: 20px 20px 6px 20px; white-space: pre-wrap; display: flex; flex-direction: column; align-items: flex-end; gap: 6px; }
.wsx-msg.bot { align-self: flex-start; width: fit-content; max-width: min(88%, 68ch); padding: 12px 16px; color: var(--color-text); background: var(--color-bg-elevated); border-radius: 20px 20px 20px 6px; box-shadow: 0 1px 2px rgba(28,25,23,.05), 0 10px 28px -14px rgba(28,25,23,.22); }
.wsx-msg.bot.is-note { color: var(--color-text-tertiary); }
.wsx-msg.bot.is-typing { display: inline-flex; align-items: center; gap: 10px; padding: 10px 16px 10px 14px; border-radius: 999px; color: var(--color-text-secondary); font-weight: 500; }
.wsx-msg.bot.is-typing::before { content: ''; width: 8px; height: 8px; flex: none; border-radius: 50%; background: var(--color-primary); animation: wsx-breathe 1.4s ease-in-out infinite; }
@keyframes wsx-breathe { 0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-primary) 40%, transparent); } 50% { box-shadow: 0 0 0 6px color-mix(in srgb, var(--color-primary) 0%, transparent); } }
@media (prefers-reduced-motion: reduce) { .wsx-msg.bot.is-typing::before { animation: none; } }
.wsx-msg.is-streaming:empty::after, .wsx-msg.is-streaming > :last-child::after { content: ''; display: inline-block; width: 7px; height: 1em; margin-left: 2px; vertical-align: -2px; border-radius: 2px; background: var(--color-text-secondary); animation: wsx-caret 1s steps(1) infinite; }
@keyframes wsx-caret { 50% { opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .wsx-msg.is-streaming:empty::after, .wsx-msg.is-streaming > :last-child::after { animation: none; } }
.wsx-msgfile { display: inline-flex; align-items: center; gap: 6px; max-width: 100%; padding: 4px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-full); background: var(--color-bg-elevated); color: var(--color-text-secondary); font: 500 var(--text-xs) var(--font-body); white-space: nowrap; }
.wsx-msgfile__name { overflow: hidden; text-overflow: ellipsis; }
/* failure row: plain-language message + Retry */
.wsx-err { display: flex; align-items: center; flex-wrap: wrap; gap: 10px; padding: 12px 14px 12px 16px; border: 0; border-left: 3px solid var(--color-error); border-radius: 16px; background: var(--color-bg-elevated); box-shadow: 0 1px 2px rgba(28,25,23,.05), 0 10px 28px -14px rgba(28,25,23,.22); color: var(--color-text); font-size: var(--text-sm); line-height: 1.5; }
.wsx-err__msg { flex: 1; min-width: 12ch; }
.wsx-err__retry { flex: none; height: 32px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--color-error-light); color: var(--color-error); font: 600 var(--text-xs) var(--font-body); cursor: pointer; }
.wsx-err__retry:hover { background: color-mix(in srgb, var(--color-error) 16%, var(--color-bg-elevated)); }
/* empty state: greeting + neutral starters */
.wsx-chatempty { display: flex; flex-direction: column; align-items: flex-start; gap: 12px; padding: 12px 2px; }
.wsx-chatempty__title { margin: 0; font: 600 var(--text-base) var(--font-body); color: var(--color-text); }
.wsx-chatempty__chips { display: flex; flex-wrap: wrap; gap: 8px; }
.wsx-chatempty .wsx-chip:hover { border-color: var(--color-border-strong); color: var(--color-text); }
.wsx-sr { position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip: rect(0 0 0 0); clip-path: inset(50%); white-space: nowrap; }
/* markdown blocks inside a bot bubble */
.wsx-msg.bot p { margin: 0 0 10px; } .wsx-msg.bot p:last-child { margin-bottom: 0; }
.wsx-msg.bot .wsx-h { font: 650 var(--text-base)/1.35 var(--font-body); margin: 16px 0 6px; } .wsx-msg.bot .wsx-h:first-child { margin-top: 0; }
.wsx-msg.bot .wsx-ul, .wsx-msg.bot .wsx-ol { margin: 4px 0 10px; padding-left: 20px; }
.wsx-msg.bot li::marker { color: var(--color-text-tertiary); }
.wsx-msg.bot li { margin: 4px 0; padding-left: 2px; }
.wsx-msg.bot code { font-family: var(--font-mono, ui-monospace, monospace); font-size: 0.88em; background: var(--color-surface); padding: 1px 6px; border-radius: 6px; }
.wsx-msg.bot .wsx-pre { margin: 8px 0 10px; padding: 12px 14px; background: var(--color-surface); border: 0; border-radius: 12px; overflow-x: auto; }
.wsx-msg.bot .wsx-pre code { background: transparent; padding: 0; font-size: 0.86em; line-height: 1.5; white-space: pre; }
.wsx-msg.bot .wsx-tablewrap { margin: 8px 0 10px; overflow-x: auto; border: 1px solid var(--color-border); border-radius: 12px; }
.wsx-msg.bot .wsx-table { border-collapse: collapse; width: 100%; font-size: 0.92em; }
.wsx-msg.bot .wsx-table th, .wsx-msg.bot .wsx-table td { padding: 7px 12px; border: 0; border-bottom: 1px solid var(--color-border); text-align: left; vertical-align: top; }
.wsx-msg.bot .wsx-table tr:last-child td { border-bottom: 0; }
.wsx-msg.bot .wsx-table th { background: var(--color-surface); font-weight: 600; font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-msg.bot .wsx-bq { margin: 8px 0; padding: 2px 0 2px 12px; border-left: 2px solid var(--color-border-strong); color: var(--color-text-secondary); }
.wsx-msg.bot .wsx-hr { border: 0; border-top: 1px solid var(--color-border); margin: 16px 0; }
.wsx-msg.bot a { color: var(--color-primary); text-decoration: none; text-underline-offset: 3px; } .wsx-msg.bot a:hover { text-decoration: underline; }
/* copy affordance under bot bubbles */
.wsx-copy { align-self: flex-start; margin-top: 2px; border: 0; background: transparent; color: var(--color-text-tertiary); font: 600 var(--text-xs) var(--font-body); padding: 3px 7px; border-radius: 6px; cursor: pointer; opacity: 0; transition: opacity 120ms, background var(--duration-fast), color var(--duration-fast); }
.wsx-row.bot:hover .wsx-copy { opacity: 1; }
@media (hover: none) { .wsx-copy { opacity: 1; } }
.wsx-copy:hover { color: var(--color-text); background: var(--color-surface); }
/* inline artifact cards */
.wsx-cards { display: flex; flex-direction: column; gap: 8px; }
.wsx-card { display: flex; align-items: center; gap: 12px; width: 100%; text-align: left; padding: 12px 12px 12px 12px; border: 0; border-radius: 18px; background: var(--color-bg-elevated); box-shadow: 0 1px 2px rgba(28,25,23,.05), 0 10px 28px -14px rgba(28,25,23,.22); cursor: pointer; transition: transform 160ms var(--ease-out-expo), box-shadow 160ms; }
.wsx-card:hover { transform: translateY(-2px); box-shadow: 0 1px 2px rgba(28,25,23,.06), 0 16px 32px -14px rgba(28,25,23,.28); }
.wsx-card:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.wsx-card:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.wsx-card__ic { width: 42px; height: 42px; flex: none; display: grid; place-items: center; border-radius: 13px; background: var(--color-primary-light); font-size: 19px; line-height: 1; }
.wsx-card__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
.wsx-card__top { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-card__sub { font-size: var(--text-xs); color: var(--color-text-tertiary); text-transform: capitalize; }
.wsx-card__go { flex: none; padding: 6px 12px; border-radius: 999px; background: var(--color-surface); color: var(--color-text); font: 600 var(--text-xs) var(--font-body); }
/* inline media */
.wsx-media { margin: 0; max-width: 100%; }
.wsx-media img { max-width: min(100%, 380px); border-radius: 18px; border: 0; box-shadow: 0 1px 2px rgba(28,25,23,.05), 0 10px 28px -14px rgba(28,25,23,.22); display: block; }
.wsx-media figcaption { font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: 4px; }
.wsx-file { display: inline-flex; align-items: center; gap: 8px; min-height: 40px; padding: 0 14px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-bg-elevated); color: var(--color-text); font: 600 var(--text-sm) var(--font-body); text-decoration: none; transition: border-color 150ms; }
.wsx-file:hover { border-color: var(--color-border-strong); }
/* build-in-progress widget */
.wsx-build { padding: 16px 18px; border: 0; border-radius: 20px; background: var(--color-bg-elevated); box-shadow: 0 1px 2px rgba(28,25,23,.05), 0 10px 28px -14px rgba(28,25,23,.22); display: flex; flex-direction: column; gap: 8px; }
.wsx-build.is-error .wsx-build__step { color: var(--color-error); }
.wsx-build__head { display: flex; align-items: center; gap: 10px; font: 700 var(--text-base) var(--font-body); color: var(--color-text); letter-spacing: -0.01em; }
.wsx-build__spin { width: 16px; height: 16px; flex: none; border: 2px solid color-mix(in srgb, var(--color-primary) 22%, transparent); border-top-color: var(--color-primary); border-radius: 50%; animation: wsx-spin 0.8s linear infinite; }
.wsx-build__spin.is-done { border: 0; animation: wsx-pop 200ms var(--ease-out-expo); } .wsx-build__spin.is-done::after { content: '\\2713'; color: var(--color-success); font-weight: 700; }
@keyframes wsx-pop { from { transform: scale(.8); opacity: 0; } }
.wsx-build.is-error .wsx-build__spin.is-done::after { content: '!'; color: var(--color-error); }
@keyframes wsx-spin { to { transform: rotate(360deg); } }
/* shared inline spinner + busy affordances (design-system) */
.wsx-spin { display: inline-block; width: 13px; height: 13px; flex: none; vertical-align: -2px; border: 2px solid color-mix(in srgb, currentColor 28%, transparent); border-top-color: currentColor; border-radius: 50%; animation: wsx-spin 0.7s linear infinite; }
.wsx-loading { display: flex; align-items: center; justify-content: center; gap: 9px; padding: 22px 14px; font-size: var(--text-sm); color: var(--color-text-tertiary); }
.wsx-abtn.is-busy, .wsx-atbl__act.is-busy { pointer-events: none; opacity: 0.7; }
.wsx-abtn.is-busy::before, .wsx-atbl__act.is-busy::before { content: ''; width: 13px; height: 13px; flex: none; margin-right: 6px; border: 2px solid color-mix(in srgb, currentColor 28%, transparent); border-top-color: currentColor; border-radius: 50%; animation: wsx-spin 0.7s linear infinite; }
.wsx-atbl__act.is-busy { display: inline-flex; align-items: center; }
.wsx-build__step { padding-left: 26px; font-size: var(--text-sm); color: var(--color-text-secondary); }
.wsx-build__line { font-size: var(--text-sm); color: var(--color-text); }
.wsx-build__open { align-self: stretch; margin-top: 6px; height: 40px; padding: 0 16px; border: 0; border-radius: 999px; background: var(--color-text); color: var(--color-bg-elevated); font: 600 var(--text-sm) var(--font-body); cursor: pointer; transition: background var(--duration-fast); }
.wsx-build__open:hover { background: var(--color-primary); color: var(--color-text-inverse); }
/* rich approval card */
.wsx-approve { padding: 16px 18px; border: 0; border-radius: 20px; background: var(--color-bg-elevated); box-shadow: 0 1px 2px rgba(28,25,23,.05), 0 10px 28px -14px rgba(28,25,23,.22); display: flex; flex-direction: column; gap: 6px; }
.wsx-approve.is-danger { background: color-mix(in srgb, var(--color-error) 4%, var(--color-bg-elevated)); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-error) 22%, transparent), 0 1px 2px rgba(28,25,23,.05), 0 10px 28px -14px rgba(28,25,23,.22); }
.wsx-approve__title { font: 700 var(--text-base) var(--font-body); color: var(--color-text); letter-spacing: -0.01em; }
.wsx-approve__subject { font: 500 var(--text-sm) var(--font-body); color: var(--color-text-secondary); }
.wsx-approve.is-danger .wsx-approve__subject { color: var(--color-error); }
.wsx-approve__detail { font-size: var(--text-sm); color: var(--color-text-secondary); line-height: 1.5; }
.wsx-approve__lines { margin: 4px 0 0; padding: 10px 14px 10px 30px; border-radius: 14px; background: var(--color-surface); font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-approve__lines li { margin: 1px 0; word-break: break-all; }
.wsx-approve__row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 10px; }
.wsx-approve__ok { height: 40px; padding: 0 16px; border: 0; border-radius: 999px; background: var(--color-primary); color: var(--color-text-inverse); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-approve.is-danger .wsx-approve__ok { background: var(--color-error); }
.wsx-approve__ok:hover { background: var(--color-primary-hover); }
.wsx-approve__no { order: -1; height: 40px; padding: 0 14px; border: 0; border-radius: 999px; background: var(--color-surface); color: var(--color-text); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-approve__no:hover { background: var(--color-border); color: var(--color-text); }
.wsx-confirm { align-self: flex-start; max-width: 92%; padding: 16px 18px; border: 0; border-radius: 20px; background: var(--color-bg-elevated); box-shadow: 0 1px 2px rgba(28,25,23,.05), 0 10px 28px -14px rgba(28,25,23,.22); }
.wsx-confirm__p { font-size: var(--text-sm); color: var(--color-text); margin-bottom: 9px; }
.wsx-confirm__row { display: flex; gap: 8px; }
.wsx-confirm__ok { height: 40px; padding: 0 18px; border: 0; border-radius: 999px; background: var(--color-primary); color: var(--color-text-inverse); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-confirm__ok:disabled { opacity: 0.6; cursor: default; }
.wsx-confirm__no { height: 40px; padding: 0 16px; border: 0; border-radius: 999px; background: var(--color-surface); color: var(--color-text); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
/* jump-to-latest: pinned to the thread pane (not the scroller), so it never scrolls away */
.wsx__scrolldown { position: absolute; left: 50%; transform: translateX(-50%); bottom: 12px; z-index: 4; width: 34px; height: 34px; display: grid; place-items: center; border: 1px solid var(--color-border); border-radius: 50%; background: var(--color-bg-elevated); color: var(--color-text-secondary); cursor: pointer; box-shadow: var(--shadow-md); }
.wsx__scrolldown[hidden] { display: none; }
.wsx__scrolldown:hover { border-color: var(--color-border-strong); color: var(--color-text); }
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
.wsx-thread { display: flex; flex-direction: column; border-radius: var(--radius-md); padding: 2px; transition: background var(--duration-fast); }
.wsx-thread:hover { background: var(--color-surface); }
.wsx-thread.is-active { background: color-mix(in srgb, var(--color-primary) 7%, var(--color-bg-elevated)); }
.wsx-thread__line { display: flex; align-items: center; gap: 4px; }
.wsx-thread__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; text-align: left; border: 0; background: transparent; padding: 9px 10px; cursor: pointer; color: inherit; }
.wsx-thread__title { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-thread.is-active .wsx-thread__title::before { content: ''; display: inline-block; width: 6px; height: 6px; margin-right: 7px; vertical-align: 2px; border-radius: 50%; background: var(--color-text-secondary); }
.wsx-thread__preview { font-size: var(--text-xs); color: var(--color-text-tertiary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-thread__more { flex: none; width: 32px; height: 32px; border: 0; background: transparent; color: var(--color-text-secondary); border-radius: var(--radius-sm); cursor: pointer; font-size: 16px; line-height: 1; }
.wsx-thread__more:hover, .wsx-thread__more[aria-expanded="true"] { background: var(--color-bg-elevated); color: var(--color-text); }
.wsx-thread__panel { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 4px 9px 9px; }
.wsx-thread__panel[hidden] { display: none; }
.wsx-thread__opt { padding: 5px 11px; border: 1px solid var(--color-border); border-radius: var(--radius-sm); background: var(--color-bg-elevated); color: var(--color-text); font: 600 var(--text-xs) var(--font-body); cursor: pointer; }
.wsx-thread__opt:hover { border-color: var(--color-border-strong); }
.wsx-thread__opt.is-primary { background: var(--color-text); border-color: var(--color-text); color: var(--color-bg-elevated); }
.wsx-thread__opt.is-danger { color: var(--color-error); }
.wsx-thread__input { flex: 1 1 160px; min-width: 0; padding: 5px 9px; border: 1px solid var(--color-border-strong); border-radius: var(--radius-sm); background: var(--color-bg); color: var(--color-text); font: var(--text-sm) var(--font-body); }
.wsx-thread__msg { flex: 1 1 100%; font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-thread__msg:empty { display: none; }
.wsx__dockbar { display: flex; align-items: flex-end; gap: 6px; max-width: 820px; margin: 0 auto; padding: 7px 7px 7px 16px; border: 1.5px solid var(--color-border-strong); border-radius: var(--radius-xl); background: var(--color-bg); box-shadow: var(--shadow-sm); }
.wsx__dockinput { flex: 1; min-width: 0; align-self: center; resize: none; border: 0; background: transparent; padding: 7px 0; margin: 0; font: 400 var(--text-base)/1.45 var(--font-body); color: var(--color-text); outline: none; max-height: 184px; overflow-y: auto; }
.wsx__docksend { width: 36px; height: 36px; border: 0; border-radius: 50%; background: var(--color-surface); color: var(--color-text-tertiary); display: grid; place-items: center; cursor: pointer; flex: none; transition: background var(--duration-fast), color var(--duration-fast), transform 120ms; }
.wsx__docksend:active:not(:disabled) { transform: scale(.94); }
.wsx__docksend:disabled { cursor: default; }
.wsx__docksend.is-ready { background: var(--color-text); color: var(--color-bg-elevated); }
.wsx__docksend.is-ready:hover { background: var(--color-primary); color: var(--color-text-inverse); }
.wsx__docksend[data-mode="stop"] { background: var(--color-text); color: var(--color-bg-elevated); }
.wsx__docksend:focus-visible, .wsx__dockattach:focus-visible, .wsx__dockmic:focus-visible, .wsx__pill:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.wsx__dockmic { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; display: grid; place-items: center; cursor: pointer; flex: none; }
.wsx__dockmic svg { color: var(--color-text-muted); width: 18px; height: 18px; }
.wsx__dockmic:hover svg { color: var(--color-text); }
.wsx__dockmic[data-state="recording"] { background: var(--color-error); }
.wsx__dockmic[data-state="recording"] svg { color: var(--color-text-inverse); animation: wsxMicPulse 1.2s ease-in-out infinite; }
.wsx__dockmic[data-state="busy"] { opacity: 0.6; cursor: default; }
.wsx__dockattach { width: 36px; height: 36px; border: 0; border-radius: 50%; background: transparent; display: grid; place-items: center; cursor: pointer; flex: none; }
.wsx__dockattach svg { color: var(--color-text-muted); width: 18px; height: 18px; }
.wsx__dockattach:hover svg { color: var(--color-text); }
.wsx__dockattach.is-busy { opacity: 0.6; cursor: default; }
.wsx__attachchip { max-width: 820px; margin: 0 auto 6px; padding: 0 12px; }
.wsx__attachchip:not([hidden]) { display: flex; }
.wsx__attachchip__pill { display: inline-flex; align-items: center; gap: 6px; color: var(--color-text-secondary); padding: 4px 10px 4px 12px; border-radius: 999px; background: var(--color-bg-muted); border: 1px solid var(--color-border); font-size: 13px; max-width: 100%; }
.wsx__attachchip__name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx__attachchip__x { border: 0; background: transparent; cursor: pointer; color: var(--color-text-muted); padding: 0 2px; line-height: 1; }
.wsx__attachchip__x:hover { color: var(--color-text); }
.wsx__composer .wsx__attachchip { max-width: none; margin: 0 12px 6px; }
@keyframes wsxMicPulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

@keyframes wsx-pulse { 0% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 45%, transparent); } 70% { box-shadow: 0 0 0 7px color-mix(in srgb, var(--color-success) 0%, transparent); } 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--color-success) 0%, transparent); } }
@media (max-width: 1100px) { .wsx__body { grid-template-columns: var(--wsx-rail) minmax(0,1fr); } .wsx__activity { display: none; } }
@media (max-width: 720px) { .wsx__body { grid-template-columns: minmax(0, 1fr); } }
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
.wsx__help-mineitem[data-help-ticket] { cursor: pointer; }
.wsx__help-mineitem[data-help-ticket]:hover { color: var(--color-primary); }
.wsx__help-form[hidden] { display: none; }
.wsx__help-thread { max-height: 260px; overflow: auto; display: flex; flex-direction: column; gap: 8px; margin: 8px 0; }
.wsx__help-msg { padding: 8px 10px; border-radius: var(--radius-md); background: var(--color-surface); font: 400 var(--text-sm) var(--font-body); white-space: pre-wrap; }
.wsx__help-msg--staff { border-left: 2px solid var(--color-primary); }
.wsx__composer { position: absolute; z-index: 40; display: flex; flex-direction: column; background: var(--glass-bg-strong); -webkit-backdrop-filter: blur(18px); backdrop-filter: blur(18px); border: 1px solid var(--color-border); box-shadow: var(--shadow-xl); overflow: hidden; transition: width var(--duration-normal, .22s) var(--ease-out-expo), height var(--duration-normal, .22s) var(--ease-out-expo), max-height var(--duration-normal, .22s) var(--ease-out-expo), border-radius var(--duration-fast); }
.wsx__composer.is-resizing { transition: none; user-select: none; } /* drag grip resizes the open panel height */
.wsx__composer[data-state="resting"] { left: calc(50% + (var(--wsx-rail) - var(--wsx-rightcol)) / 2); transform: translateX(-50%); bottom: calc(18px + env(safe-area-inset-bottom, 0px)); width: min(680px, 92%); max-height: 60px; border-radius: 999px; box-shadow: var(--shadow-lg); }
/* resting = one pill button; everything else lives in the open sheet */
.wsx__pill { display: none; }
.wsx__composer[data-state="resting"] .wsx__pill { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 52px; padding: 0 20px; border: 0; background: transparent; color: var(--color-text-tertiary); font: 400 var(--text-base) var(--font-body); text-align: left; cursor: text; border-radius: 999px; }
.wsx__pill-text { flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx__pill-dot { flex: none; width: 9px; height: 9px; border-radius: 50%; background: var(--color-primary); }
.wsx__pill-dot[hidden] { display: none; }
.wsx__composer[data-state="resting"] .wsx__dockbar, .wsx__composer[data-state="resting"] .wsx__attachchip, .wsx__composer[data-state="resting"] .wsx__threadpane, .wsx__composer[data-state="resting"] .wsx__searchbar, .wsx__composer[data-state="resting"] .wsx__threads { display: none; }
.wsx__composer[data-state="sheet"] { left: calc(50% + (var(--wsx-rail) - var(--wsx-rightcol)) / 2); transform: translateX(-50%); bottom: 18px; width: min(740px, 94%); height: var(--wsx-sheet-h, min(480px, 52vh)); max-height: calc(100vh - 36px); border-radius: 28px; background: linear-gradient(180deg, color-mix(in srgb, var(--color-bg-elevated) 94%, transparent) 0%, color-mix(in srgb, var(--color-bg) 92%, transparent) 55%, color-mix(in srgb, var(--color-primary) 7%, var(--color-bg)) 100%); }
.wsx__composer-grip { display: none; } .wsx__composer[data-state="sheet"] .wsx__composer-grip { display: block; position: absolute; top: 0; left: 0; right: 0; height: 12px; cursor: ns-resize; z-index: 3; touch-action: none; } .wsx__composer-grip::after { content: ""; position: absolute; top: 5px; left: 50%; transform: translateX(-50%); width: 40px; height: 4px; border-radius: 999px; background: var(--color-border); transition: background var(--duration-fast); } .wsx__composer-grip:hover::after { background: var(--color-text-tertiary); }
.wsx__composer-bar { display: none; align-items: center; gap: 8px; padding: 16px 12px 12px 16px; flex: none; } .wsx__composer[data-state="sheet"] .wsx__composer-bar { display: flex; }
.wsx__composer-title { margin: 0; display: flex; align-items: center; gap: 11px; min-width: 0; }
.wsx__ai-av { position: relative; width: 40px; height: 40px; flex: none; display: grid; place-items: center; border-radius: 50%; background: var(--color-bg-elevated); box-shadow: 0 0 0 1px var(--color-border), 0 6px 16px -8px color-mix(in srgb, var(--color-primary) 55%, transparent); }
.wsx__ai-mark { width: 22px; height: 22px; display: block; }
.wsx__ai-live { position: absolute; right: 0; bottom: 1px; width: 11px; height: 11px; border-radius: 50%; background: var(--color-success); box-shadow: 0 0 0 2px var(--color-bg-elevated); }
.wsx__ai-id { display: flex; flex-direction: column; min-width: 0; line-height: 1.2; }
.wsx__ai-name { font: 800 var(--text-base) var(--font-display, var(--font-body)); color: var(--color-text); letter-spacing: -0.01em; }
.wsx__composer-btns { margin-left: auto; display: flex; gap: 2px; }
.wsx__composer-btns button { width: 32px; height: 32px; display: grid; place-items: center; border: 0; background: transparent; border-radius: 999px; color: var(--color-text-tertiary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast); }
.wsx__composer-btns button:hover { background: var(--color-surface); color: var(--color-text); }
.wsx__composer-btns .wsx__composer-new { width: auto; display: inline-flex; gap: 5px; padding: 0 13px 0 10px; border: 0; background: var(--color-surface); color: var(--color-text); font: 600 var(--text-xs) var(--font-body); }
.wsx__composer-new svg { width: 15px; height: 15px; }
.wsx__composer-more { position: relative; display: flex; }
.wsx__composer-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 6; min-width: 190px; display: flex; flex-direction: column; gap: 2px; padding: 6px; background: var(--color-bg-elevated); border: 1px solid var(--color-border); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); }
.wsx__composer-menu[hidden] { display: none; }
.wsx__composer-btns .wsx__composer-menu button { width: 100%; height: auto; display: flex; align-items: center; justify-content: flex-start; gap: 10px; padding: 9px 10px; border-radius: var(--radius-md); color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); text-align: left; white-space: nowrap; }
.wsx__composer-btns .wsx__composer-menu button[hidden] { display: none; }
.wsx__composer-menu svg { width: 16px; height: 16px; flex: none; }
.wsx__composer-btns button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.wsx__threadpane { flex: 1; min-height: 0; position: relative; display: flex; flex-direction: column; }
.wsx__composer .wsx__thread { flex: 1; min-height: 0; max-height: none; max-width: none; margin: 0; border: 0; border-radius: 0; background: transparent; overflow-y: auto; padding: 6px 18px 22px; }
.wsx__composer .wsx__thread[hidden] { display: none; }
.wsx__composer .wsx__dockbar { margin: 0; max-width: none; border: 0; box-shadow: none; background: transparent; border-radius: 0; }
.wsx__composer[data-state="sheet"] .wsx__dockbar { margin: 0 14px 14px; padding: 6px 6px 6px 18px; border: 1px solid var(--color-border); border-radius: 26px; background: var(--color-bg-elevated); box-shadow: 0 1px 2px rgba(28,25,23,.05), 0 12px 32px -16px rgba(28,25,23,.28); transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx__composer[data-state="sheet"] .wsx__dockbar:focus-within { border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border)); box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary) 12%, transparent), 0 12px 32px -16px rgba(28,25,23,.28); }

/* ===== widgets that self-hide when empty + activity-as-widget ===== */
.wsx-widget.is-empty-hidden { display: none; }
.wsx-actwidget { position: relative; }
.wsx-actwidget .wsx-widget__body { padding: 0; max-height: 460px; }
.wsx-actwidget .wsx__actbar { border-bottom: 1px solid var(--color-border); }

/* ===== tile/table toggle + table view ===== */
.wsx-viewseg { display: inline-flex; gap: 2px; margin-left: 8px; background: var(--color-surface); border-radius: 8px; padding: 2px; flex: none; }
#wsxArtChips .wsx-viewseg, #wsxAssetChips .wsx-viewseg { margin-left: auto; }
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
.wsx-tr__views, .wsx-tr__visitors { font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-tr__date { font-size: var(--text-xs); color: var(--color-text-tertiary); text-align: right; }
/* Artifact tables: every row (and the header) shares one grid template, so cells line up
   as real columns whatever a row holds. Wide → every column (scrolls sideways if needed);
   narrower containers (Home widgets, phones) shed low-priority columns by class, and the
   template drops the same tracks. */
.wsx-tbl--art { container-type: inline-size; overflow-x: auto; }
.wsx-tbl--art .wsx-tbl__head, .wsx-tbl--art .wsx-tr { display: grid; gap: 12px; min-width: min-content;
  grid-template-columns: 22px minmax(200px,1fr) 150px 116px 124px 84px 96px 160px 64px 84px 112px 112px; }
.wsx-tbl--art :is(.wsx-tbl__head, .wsx-tr) > * { min-width: 0; overflow: hidden; }
.wsx-tbl--art .wsx-tbl__head > * { font: inherit; color: inherit; text-transform: inherit; letter-spacing: inherit; white-space: nowrap; text-overflow: ellipsis; }
.wsx-tbl--art .wsx-tr__feat { display: flex; gap: 3px; }
.wsx-tbl--art .wsx-tr__tags { display: flex; gap: 4px; align-items: center; }
.wsx-tbl--art :is(.wsx-tr__views, .wsx-tr__visitors) { text-align: right; font-variant-numeric: tabular-nums; }
.wsx-tbl--art :is(.wsx-tr__created, .wsx-tr__date) { text-align: right; white-space: nowrap; text-overflow: ellipsis; font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-tr__sub { flex: none; font: 400 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); }
.wsx-tbl--art .wsx-tr__owner .card-owner { margin: 0; max-width: 100%; }
.wsx-tbl--art .feature { width: 22px; height: 22px; }
.wsx-tbl--art .feature svg { width: 13px; height: 13px; }
.wsx-tr__none { color: var(--color-text-tertiary); font-size: var(--text-xs); }
/* Row select (over the type icon, Drive-style) + inline favorite star. */
.wsx-tr__icon { position: relative; }
.wsx-tr__sel { position: absolute; inset: 0; display: none; place-items: center; padding: 0; border: 1.5px solid var(--color-border-strong); border-radius: 5px; background: var(--color-bg-elevated); color: transparent; cursor: pointer; }
.wsx-tr__sel svg { width: 13px; height: 13px; }
.wsx-tr:hover .wsx-tr__sel, body.selecting .wsx-tr__sel, .wsx-tr.is-selected .wsx-tr__sel { display: grid; }
.wsx-tr.is-selected .wsx-tr__sel { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-text-inverse); }
.wsx-tr.is-selected { background: var(--color-primary-light); }
.wsx-tr__name { display: flex; align-items: center; gap: 6px; }
.wsx-tr__nm { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.wsx-tr__star { flex: none; display: grid; place-items: center; width: 24px; height: 24px; padding: 0; border: 0; border-radius: var(--radius-sm); background: transparent; color: var(--color-text-tertiary); cursor: pointer; opacity: 0; transition: opacity var(--duration-fast), color var(--duration-fast); }
.wsx-tr__star svg { width: 14px; height: 14px; }
.wsx-tr:hover .wsx-tr__star, .wsx-tr__star:focus-visible, .wsx-tr__star.is-on { opacity: 1; }
.wsx-tr__star:hover { color: var(--color-text); background: var(--color-surface); }
.wsx-tr__star.is-on { color: var(--color-warning); }
.wsx-tr__stack { display: inline-flex; align-items: center; }
.wsx-tr__stack .owner-avatar { box-shadow: 0 0 0 2px var(--color-bg-elevated); }
.wsx-tr__stack .owner-avatar + .owner-avatar { margin-left: -6px; }
.wsx-tr__more { margin-left: 4px; font-size: var(--text-xs); color: var(--color-text-tertiary); }
.wsx-tr__vis { display: inline-flex; align-items: center; gap: 5px; font-size: var(--text-xs); color: var(--color-text-secondary); white-space: nowrap; }
.wsx-tr__vis svg { width: 13px; height: 13px; flex: none; }
.wsx-tr__vis.is-ws { color: var(--color-primary); }
.wsx-tr__tag { padding: 2px 8px; border-radius: 999px; background: var(--color-surface); font-size: var(--text-xs); color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 72px; }
@container (max-width: 1380px) {
  .wsx-tbl--art :is(.wsx-tr__tags, .wsx-tr__feat, .wsx-tr__created) { display: none; }
  .wsx-tbl--art :is(.wsx-tbl__head, .wsx-tr) { grid-template-columns: 22px minmax(200px,1fr) 150px 116px 124px 84px 64px 84px 112px; }
}
@container (max-width: 1000px) {
  .wsx-tbl--art :is(.wsx-tr__shared, .wsx-tr__visitors, .wsx-tr__access) { display: none; }
  .wsx-tbl--art :is(.wsx-tbl__head, .wsx-tr) { grid-template-columns: 22px minmax(160px,1fr) 150px 84px 64px 112px; }
}
@container (max-width: 680px) {
  .wsx-tbl--art :is(.wsx-tr__owner, .wsx-tr__type, .wsx-tr__views) { display: none; }
  .wsx-tbl--art :is(.wsx-tbl__head, .wsx-tr) { grid-template-columns: 22px minmax(120px,1fr) 104px; }
}
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
