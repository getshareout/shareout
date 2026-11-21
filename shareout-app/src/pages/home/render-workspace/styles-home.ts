/** Home brief: greeting + ask-or-make box, Your artifacts, Needs you, In your workspace, This week, What's new, All your artifacts. */
export const WORKSPACE_HOME_STYLES = `
/* ===== Home: greeting + ask-or-make box, then cards — everything important on the first screen ===== */
.wsx__homehead { display: flex; align-items: center; gap: var(--space-5); margin-bottom: var(--space-4); }
.wsx-hello { flex: 0 1 auto; min-width: 0; max-width: 42%; }
.wsx-hello__t { margin: 0; font: 700 1.625rem/1.15 var(--font-display, var(--font-body)); letter-spacing: -0.01em; color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx__narration { margin: 3px 0 0; font: 400 var(--text-sm)/1.4 var(--font-body); color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx__narration b { font-weight: 600; color: color-mix(in srgb, var(--color-warning) 62%, var(--color-text)); }
.wsx__narration .muted { color: var(--color-text-secondary); }
.wsx-hero { flex: 1 1 auto; min-width: 0; max-width: 720px; margin-left: auto; display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 14px; border: 1px solid var(--color-border); border-radius: 18px; background: var(--color-bg-elevated); box-shadow: var(--shadow-md); transition: border-color var(--duration-fast), box-shadow var(--duration-fast); }
.wsx-hero:focus-within { border-color: var(--color-primary); box-shadow: 0 0 0 3px var(--color-primary-light); }
.wsx-hero__chat { position: relative; display: grid; place-items: center; flex: none; width: 30px; height: 30px; margin-left: -6px; padding: 0; border: 0; border-radius: 10px; background: transparent; color: var(--color-primary); cursor: pointer; }
.wsx-hero__chat svg { width: 17px; height: 17px; }
.wsx-hero__chat:hover, .wsx-hero__chat:focus-visible { background: var(--color-primary-light); outline: none; }
/* A chat reply that landed while the chat was closed: a dot on the way back in. */
.wsx:has(#wsxPillDot:not([hidden])) .wsx-hero__chat::after { content: ''; position: absolute; top: 4px; right: 4px; width: 8px; height: 8px; border-radius: 50%; background: var(--color-primary); box-shadow: 0 0 0 2px var(--color-bg-elevated); }
.wsx-hero__in { flex: 1 1 auto; min-width: 80px; padding: 8px 2px; border: 0; background: transparent; color: var(--color-text); font: 400 var(--text-base) var(--font-body); outline: none; }
.wsx-hero__in::placeholder { color: var(--color-text-tertiary); }
.wsx-hero__chip { display: inline-flex; align-items: center; gap: 6px; flex: none; padding: 6px 11px; border: 1px solid var(--color-border); border-radius: 999px; background: var(--color-surface); color: var(--color-text-secondary); font: 500 0.8125rem/1.2 var(--font-body); white-space: nowrap; cursor: pointer; transition: border-color var(--duration-fast), color var(--duration-fast); }
.wsx-hero__chip svg { width: 14px; height: 14px; }
.wsx-hero__chip:hover, .wsx-hero__chip:focus-visible { border-color: var(--color-primary); color: var(--color-primary); outline: none; }
.wsx-hero__go { order: 1; width: 38px; height: 38px; flex: none; display: grid; place-items: center; border: 0; border-radius: 12px; background: var(--color-primary); color: #fff; cursor: pointer; }
.wsx-hero__go svg { width: 18px; height: 18px; }
.wsx-hero__go:hover { background: var(--color-primary-hover, var(--color-primary)); }
.wsx-hero__go:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
/* On Home the box above is the way into the chat, so the floating pill steps aside. */
.wsx:has(#wsxHomePane.is-active .wsx__view[data-view="brief"].is-active) .wsx__composer[data-state="resting"] { display: none; }
.wsx__more { position: relative; flex: none; }
.wsx__morebtn { display: inline-grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text-tertiary); cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast); }
.wsx__morebtn:hover, .wsx__morebtn[aria-expanded="true"] { background: var(--color-surface); color: var(--color-text); }
.wsx__morebtn:focus-visible, .wsx__morem button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.wsx__morem { position: absolute; right: 0; top: 36px; z-index: 20; min-width: 200px; padding: 6px; display: flex; flex-direction: column; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); box-shadow: var(--shadow-md); }
.wsx__morem[hidden], .wsx__morem button[hidden] { display: none; }
.wsx__morem button { text-align: left; border: 0; background: transparent; color: var(--color-text); font: 500 var(--text-sm) var(--font-body); padding: 8px 10px; border-radius: var(--radius-md); cursor: pointer; }
.wsx__morem button:hover { background: var(--color-surface); }
.wsx__morem button.is-on { font-weight: 700; }
.wsx__morem button.is-on::after { content: '\\2713'; float: right; color: var(--color-primary); }
.wsx__morehd { padding: 10px 10px 4px; font: 700 var(--text-xs) var(--font-body); letter-spacing: .04em; text-transform: uppercase; color: var(--color-text-tertiary); }

/* Cards: a six-column grid — a card is a third, two thirds or the full width (More → Customize drags and resizes). */
.wsx__brief { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); grid-auto-flow: row dense; gap: var(--space-4); align-items: stretch; }
.wsx__brief .wsx-widget { grid-column: span 2; display: flex; flex-direction: column; min-width: 0; border: 1px solid var(--color-border); border-radius: var(--radius-lg); background: var(--color-bg-elevated); box-shadow: var(--shadow-sm); overflow: hidden; }
.wsx__brief .wsx-widget[data-span="2"] { grid-column: span 4; }
.wsx__brief .wsx-widget[data-span="3"] { grid-column: 1 / -1; }
.wsx__brief .wsx-widget__head { display: flex; align-items: center; gap: 8px; min-height: 46px; padding: 12px 14px 4px 16px; border: 0; }
.wsx__brief .wsx-widget__head > svg { width: 16px; height: 16px; flex: none; color: var(--color-text-tertiary); }
.wsx__brief .wsx-widget__body { flex: 1; padding: 2px 10px 10px; max-height: none; overflow: visible; }
.wsx-card__t { margin: 0; font: 600 0.95rem/1.2 var(--font-display, var(--font-body)); color: var(--color-text); white-space: nowrap; }
.wsx-card__n { padding: 1px 8px; border-radius: 999px; background: var(--color-warning-light); color: color-mix(in srgb, var(--color-warning) 62%, var(--color-text)); font: 700 var(--text-xs)/1.5 var(--font-body); }
.wsx-card__n[hidden] { display: none; }
.wsx-card__meta { font-size: var(--text-xs); color: var(--color-text-secondary); white-space: nowrap; }
.wsx-card__more { margin-left: auto; flex: none; padding: 4px 7px; border: 0; border-radius: 8px; background: transparent; color: var(--color-primary); font: 600 0.8125rem/1.2 var(--font-body); text-decoration: none; white-space: nowrap; cursor: pointer; }
.wsx-card__more:hover, .wsx-card__more:focus-visible { background: var(--color-primary-light); outline: none; }
.wsx-card__all { display: block; margin: 8px auto 2px; padding: 6px 12px; border: 0; border-radius: 8px; background: transparent; color: var(--color-primary); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-card__all:hover { background: var(--color-primary-light); }
.wsx__brief:not(.is-customizing) .wsx-widget__grip, .wsx__brief:not(.is-customizing) .wsx-widget__rz, .wsx__brief:not(.is-customizing) .wsx-viewseg { display: none; }
.wsx__brief.is-customizing .wsx-widget { border-style: dashed; border-color: var(--color-border-strong); }
.wsx__brief.is-customizing .wsx-widget__grip, .wsx__brief.is-customizing .wsx-widget__rz { opacity: 1; }
.wsx__brief.is-customizing .wsx-viewseg { margin-left: auto; }
.wsx__brief.is-customizing .wsx-viewseg + .wsx-card__more { margin-left: 4px; }
.wsx-empty--calm { padding: 26px 12px; }

/* Your artifacts: tabs, then small tiles with a preview (or the table) */
.wsx-arts__tabs { display: flex; gap: 2px; min-width: 0; margin-left: 8px; overflow-x: auto; scrollbar-width: none; }
.wsx-arts__tabs::-webkit-scrollbar { display: none; }
.wsx-arts__tabs button { flex: none; padding: 4px 10px; border: 0; border-radius: 999px; background: transparent; color: var(--color-text-secondary); font: 600 0.8125rem/1.4 var(--font-body); white-space: nowrap; cursor: pointer; }
.wsx-arts__tabs button:hover { color: var(--color-text); }
.wsx-arts__tabs button.is-on { background: var(--color-surface); color: var(--color-text); }
.wsx-arts__tabs button:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.wsx-arts__pane[hidden] { display: none; }
.wsx__brief [data-wid="wsxArtsW"] .wsx-tbl { max-height: 340px; overflow: auto; }
.wsx-minis { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px 10px; }
.wsx-minis .wsx-mini:nth-child(n+10) { display: none; }
.wsx-mini { display: flex; align-items: center; gap: 11px; min-width: 0; padding: 6px; border-radius: var(--radius-md); color: inherit; text-decoration: none; transition: background var(--duration-fast); }
.wsx-mini:hover { background: var(--color-surface); }
.wsx-mini:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 1px; }
.wsx-mini__th { position: relative; display: grid; place-items: center; flex: none; width: 76px; aspect-ratio: 16 / 10; overflow: hidden; border: 1px solid var(--color-border); border-radius: 8px; background: color-mix(in srgb, var(--type-color, var(--color-primary)) 10%, var(--color-surface)); color: var(--type-color, var(--color-text-tertiary)); }
.wsx-mini__th img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; object-position: top center; background: var(--color-bg-elevated); }
.wsx-mini__th svg { width: 20px; height: 20px; opacity: .8; }
.wsx-mini__main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.wsx-mini__t { font: 600 var(--text-sm)/1.3 var(--font-body); color: var(--color-text); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-mini__s { font-size: var(--text-xs); color: var(--color-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }

/* Needs you + In your workspace rows */
.wsx__brief .wsx-ev { position: relative; align-items: center; gap: 10px; padding: 7px 6px; }
.wsx__brief .wsx-ev + .wsx-ev::before, .wsx-news + .wsx-news::before { content: ''; position: absolute; top: 0; left: 6px; right: 6px; border-top: 1px solid var(--color-border); }
.wsx__brief .wsx-ev__main { display: flex; flex-direction: column; gap: 0; }
.wsx__brief .wsx-ev__ic { width: 28px; height: 28px; border-radius: 50%; }
.wsx-ev__go { flex: none; padding: 4px 11px; border: 1px solid var(--color-border); border-radius: 10px; background: var(--color-bg-elevated); color: var(--color-text); font: 600 var(--text-xs)/1.4 var(--font-body); }
.wsx-ev:hover .wsx-ev__go { border-color: var(--color-primary); color: var(--color-primary); }
.wsx-ev[data-kind="access"] .wsx-ev__go, .wsx-ev[data-kind="admin_request"] .wsx-ev__go { border-color: var(--color-primary); background: var(--color-primary); color: #fff; }

/* This week */
.wsx-week { display: flex; align-items: flex-end; gap: 14px; padding: 2px 6px 0; }
.wsx-week__big { display: flex; flex-direction: column; flex: none; }
.wsx-week__big b { font: 700 1.9rem/1 var(--font-display, var(--font-body)); color: var(--color-text); }
.wsx-week__big > span { margin-top: 2px; font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-week__delta { align-self: flex-start; margin-top: 6px; padding: 1px 6px; border-radius: 6px; background: var(--color-success-light); color: color-mix(in srgb, var(--color-success) 70%, var(--color-text)); font: 700 0.6875rem/1.5 var(--font-body); }
.wsx-week__delta.is-down { background: var(--color-surface); color: var(--color-text-secondary); }
.wsx-week__bars { flex: 1; min-width: 0; height: 70px; padding-bottom: 16px; display: flex; align-items: flex-end; gap: 5px; }
.wsx-week__bar { position: relative; flex: 1; height: var(--h); border-radius: 4px 4px 0 0; background: color-mix(in srgb, var(--color-primary) 28%, transparent); }
.wsx-week__bar.is-today { background: var(--color-primary); }
.wsx-week__bar i { position: absolute; top: 100%; left: 0; right: 0; margin-top: 3px; font: 600 0.6875rem/1 var(--font-body); font-style: normal; text-align: center; color: var(--color-text-secondary); }
.wsx-week__facts { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
.wsx-week__facts div { padding: 7px 10px; border-radius: 10px; background: var(--color-surface); min-width: 0; }
.wsx-week__facts b { display: block; font: 700 1.05rem/1.2 var(--font-display, var(--font-body)); color: var(--color-text); }
.wsx-week__facts span { font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-week__top { display: block; margin-top: 10px; padding: 0 2px; font-size: 0.8125rem; color: var(--color-text-secondary); text-decoration: none; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.wsx-week__top b { color: var(--color-text); font-weight: 600; }
.wsx-week__top:hover b { color: var(--color-primary); }

/* What's new in ShareOut */
.wsx-news { position: relative; display: flex; align-items: flex-start; gap: 10px; padding: 7px 6px; border-radius: var(--radius-md); color: inherit; text-decoration: none; }
.wsx-news:hover { background: var(--color-surface); }
.wsx-news__d { flex: none; width: 42px; padding: 3px 0; border: 1px solid var(--color-border); border-radius: 9px; text-align: center; color: var(--color-text-secondary); font: 700 0.625rem/1.15 var(--font-body); letter-spacing: .04em; text-transform: uppercase; }
.wsx-news__d b { display: block; font: 700 1rem/1.1 var(--font-display, var(--font-body)); color: var(--color-text); letter-spacing: 0; }
.wsx-news__t { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font: 600 var(--text-sm)/1.35 var(--font-body); color: var(--color-text); }
.wsx-news:hover .wsx-news__t { color: var(--color-primary); }
.wsx-news__new { display: inline-block; margin-right: 5px; padding: 0 5px; border-radius: 5px; background: var(--color-primary-light); color: var(--color-primary); font: 700 0.625rem/16px var(--font-body); text-transform: uppercase; vertical-align: 1px; }

/* All your artifacts (below the fold) */
[data-wid="wsxAllW"] .wsx-tr[hidden] { display: none; }

@media (max-width: 1180px) {
  .wsx__brief { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .wsx__brief .wsx-widget, .wsx__brief .wsx-widget[data-span="1"] { grid-column: span 1; }
  .wsx__brief .wsx-widget[data-span="2"], .wsx__brief .wsx-widget[data-span="3"] { grid-column: 1 / -1; }
}
@media (max-width: 760px) {
  .wsx__homehead { flex-wrap: wrap; gap: 12px; }
  .wsx-hello { flex: 1 1 0; max-width: none; }
  .wsx-hello__t { font-size: 1.5rem; }
  .wsx-hero { order: 3; flex: 1 1 100%; max-width: none; margin-left: 0; flex-wrap: wrap; row-gap: 6px; }
  .wsx-hero__in { flex: 1 1 calc(100% - 80px); }
  .wsx-hero__chip { order: 2; }
  .wsx__brief { grid-template-columns: minmax(0, 1fr); gap: var(--space-3); }
  .wsx__brief .wsx-widget, .wsx__brief .wsx-widget[data-span] { grid-column: 1 / -1; }
  .wsx__brief [data-wid="wsxNeedsW"] { order: -1; }
  .wsx__brief [data-wid="wsxArtsW"] .wsx-widget__head { flex-wrap: wrap; }
  .wsx-arts__tabs { order: 5; flex-basis: 100%; margin: 4px 0 0; }
  .wsx-minis { display: flex; gap: 10px; overflow-x: auto; scrollbar-width: none; scroll-snap-type: x proximity; padding-bottom: 2px; }
  .wsx-minis::-webkit-scrollbar { display: none; }
  .wsx-mini, .wsx-minis .wsx-mini:nth-child(n+10) { display: flex; flex: 0 0 132px; flex-direction: column; align-items: stretch; gap: 6px; padding: 4px; scroll-snap-align: start; }
  .wsx-mini__th { width: 100%; }
}
`;
