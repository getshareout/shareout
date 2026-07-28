/**
 * CSS for the notifications bell (topbar) + right-docked notifications panel.
 * Mirrors the account/help panel glass-sheet language of the workspace shell.
 */
export const WORKSPACE_NOTIF_STYLES = `/* ===== notifications: bell + badge (topbar, left of avatar) ===== */
.wsx__notifbtn { position: relative; flex: none; width: 36px; height: 36px; display: grid; place-items: center; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text-secondary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast); }
.wsx__notifbtn:hover { background: var(--color-surface); color: var(--color-text); }
.wsx__notifbtn:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.wsx__notifbtn.is-active { color: var(--color-primary); background: var(--color-primary-light); }
.wsx__notifbtn svg { width: 19px; height: 19px; }
.wsx__notifbadge { position: absolute; top: 2px; right: 2px; min-width: 16px; height: 16px; padding: 0 4px; box-sizing: border-box; border-radius: 999px; background: var(--color-error); color: var(--color-text-inverse); font: 700 0.62rem/16px var(--font-body); text-align: center; font-variant-numeric: tabular-nums; box-shadow: 0 0 0 2px var(--color-bg); pointer-events: none; }
.wsx__notifbadge[hidden] { display: none; }

/* ===== notifications panel (right-docked glass sheet + scrim) ===== */
.wsx__notif-scrim { position: fixed; inset: 0; z-index: 59; background: color-mix(in srgb, var(--color-text) 10%, transparent); -webkit-backdrop-filter: blur(1px); backdrop-filter: blur(1px); }
.wsx__notif-scrim[hidden] { display: none; }
.wsx__notif-panel { position: fixed; top: 12px; right: 12px; bottom: 12px; z-index: 60; width: min(400px, calc(100vw - 24px)); display: flex; flex-direction: column; background: var(--glass-bg-strong); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); border: 1px solid var(--color-border); border-radius: var(--radius-xl); box-shadow: var(--shadow-xl); overflow: hidden; animation: wsx-notif-in var(--duration-normal, .2s) var(--ease-out-expo); }
.wsx__notif-panel[hidden] { display: none; }
@keyframes wsx-notif-in { from { opacity: 0; transform: translateX(14px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .wsx__notif-panel { animation: none; } }
@media (max-width: 720px) { .wsx__notif-panel { top: 0; right: 0; bottom: 0; width: min(92vw, 400px); border-radius: 0; } }

.wsx__notif-head { display: flex; align-items: center; gap: 8px; padding: 14px 10px 12px 16px; border-bottom: 1px solid var(--color-border); flex: none; }
.wsx__notif-title { font: 700 var(--text-base) var(--font-display, var(--font-body)); color: var(--color-text); letter-spacing: -0.01em; }
.wsx__notif-headr { margin-left: auto; display: flex; align-items: center; gap: 2px; }
.wsx__notif-readall { border: 0; background: transparent; color: var(--color-text-tertiary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; padding: 6px 8px; border-radius: var(--radius-sm); white-space: nowrap; }
.wsx__notif-readall:hover { color: var(--color-primary); background: var(--color-primary-light); }
.wsx__notif-readall[hidden] { display: none; }
.wsx__notif-close { width: 30px; height: 30px; flex: none; display: grid; place-items: center; border: 0; background: transparent; color: var(--color-text-tertiary); border-radius: var(--radius-sm); cursor: pointer; }
.wsx__notif-close:hover { background: var(--color-surface); color: var(--color-text); }
.wsx__notif-close svg { width: 18px; height: 18px; }
.wsx__notif-body { flex: 1; min-height: 0; overflow-y: auto; padding: 10px; display: flex; flex-direction: column; gap: 8px; }

/* ---- unread / seen tabs ---- */
.wsx__notif-tabs { display: flex; gap: 2px; padding: 4px 10px 0; border-bottom: 1px solid var(--color-border); flex: none; }
.wsx__notif-tab { display: inline-flex; align-items: center; gap: 6px; border: 0; background: transparent; color: var(--color-text-tertiary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; padding: 8px 10px 10px; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.wsx__notif-tab:hover { color: var(--color-text-secondary); }
.wsx__notif-tab.is-on { color: var(--color-text); border-bottom-color: var(--color-primary); }
.wsx__notif-tabn { min-width: 18px; height: 18px; padding: 0 5px; box-sizing: border-box; border-radius: 999px; background: var(--color-primary); color: var(--color-text-inverse); font: 700 0.66rem/18px var(--font-body); text-align: center; font-variant-numeric: tabular-nums; }
.wsx__notif-tabn[hidden] { display: none; }

/* ---- seen (already-viewed) row: muted, non-actionable ---- */
.wsx-ncard.is-seen { background: transparent; border-color: color-mix(in srgb, var(--color-border) 60%, transparent); }
.wsx-ncard.is-seen .wsx-ncard__ic { opacity: 0.7; }
.wsx-ncard.is-seen .wsx-ncard__top { color: var(--color-text-secondary); font-weight: 600; }
a.wsx-ncard.is-seen:hover { border-color: var(--color-border-strong); box-shadow: none; transform: none; }

.wsx__notif-sec { font: 600 var(--text-xs) var(--font-body); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-tertiary); padding: 8px 6px 2px; }
.wsx__notif-sec:first-child { padding-top: 2px; }

/* ---- notification row card ---- */
.wsx-ncard { position: relative; display: flex; gap: 11px; padding: 12px 12px 12px 13px; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); text-decoration: none; color: inherit; transition: border-color var(--duration-fast), box-shadow var(--duration-fast), transform var(--duration-fast); }
a.wsx-ncard:hover { border-color: var(--color-border-strong); box-shadow: 0 2px 10px rgba(0,0,0,.06); transform: translateY(-1px); }
.wsx-ncard__ic { flex: none; width: 34px; height: 34px; display: grid; place-items: center; border-radius: 50%; background: var(--color-surface); color: var(--color-text-secondary); font-size: 15px; overflow: hidden; }
.wsx-ncard__ic img { width: 100%; height: 100%; object-fit: cover; }
.wsx-ncard__ic svg { width: 17px; height: 17px; }
.wsx-ncard__main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.wsx-ncard__top { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-ncard__sum { font: 400 var(--text-xs) var(--font-body); color: var(--color-text-secondary); line-height: 1.45; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.wsx-ncard__time { font-size: var(--text-xs); color: var(--color-text-tertiary); margin-top: 3px; }
.wsx-ncard__x { position: absolute; top: 8px; right: 8px; width: 22px; height: 22px; display: grid; place-items: center; border: 0; background: transparent; color: var(--color-text-tertiary); border-radius: 50%; cursor: pointer; font-size: 15px; line-height: 1; opacity: 0; transition: opacity var(--duration-fast), color var(--duration-fast), background var(--duration-fast); }
.wsx-ncard:hover .wsx-ncard__x, .wsx-ncard__x:focus-visible { opacity: 1; }
.wsx-ncard__x:hover { color: var(--color-error); background: var(--color-error-light); }

/* ---- approval card (actionable) ---- */
.wsx-ncard--approval { flex-direction: column; gap: 11px; padding: 13px; border-color: color-mix(in srgb, var(--color-primary) 32%, var(--color-border)); background: color-mix(in srgb, var(--color-primary) 5%, var(--color-bg-elevated)); }
.wsx-ncard__row { display: flex; gap: 11px; align-items: flex-start; }
.wsx-ncard--approval .wsx-ncard__ic { background: var(--color-primary-light); color: var(--color-primary); }
.wsx-ncard__actions { display: flex; gap: 8px; }
.wsx-ncard__actions .wsx-abtn { flex: 1; justify-content: center; min-height: 34px; }
.wsx-ncard__status { font: 600 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); padding: 2px 0; }
.wsx-ncard__done { padding: 8px; text-align: center; font: 600 var(--text-sm) var(--font-body); color: var(--color-success, var(--color-primary)); }

/* ---- action item card (assigned to me / my completed delegation) ---- */
.wsx__notif-sec-x { text-transform: none; letter-spacing: 0; color: var(--color-error); font-weight: 700; }
.wsx-ncard--action[data-overdue] { border-color: color-mix(in srgb, var(--color-error) 34%, var(--color-border)); background: color-mix(in srgb, var(--color-error) 5%, var(--color-bg-elevated)); }
.wsx-ncard__actrow { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
.wsx-ncard__act { flex: none; display: flex; align-items: center; }
.wsx-ncard__act .wsx-abtn { min-height: 30px; }
.wsx-duechip { font: 600 var(--text-xs) var(--font-body); color: var(--color-text-tertiary); padding: 1px 7px; border-radius: 999px; background: var(--color-surface); white-space: nowrap; }
.wsx-duechip.is-overdue { color: var(--color-error); background: var(--color-error-light); }

/* ---- empty state ---- */
.wsx-notif-empty { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 52px 24px; text-align: center; color: var(--color-text-tertiary); }
.wsx-notif-empty svg { width: 34px; height: 34px; opacity: 0.45; }
.wsx-notif-empty__t { font: 600 var(--text-sm) var(--font-body); color: var(--color-text-secondary); }
.wsx-notif-empty__s { font-size: var(--text-xs); max-width: 240px; line-height: 1.5; }
`;
