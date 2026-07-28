/**
 * Root shell layout, left rail, and sidebar resize handle for the workspace (.wsx).
 * Split out of styles.ts to stay under the per-module line cap; concatenated into
 * WORKSPACE_STYLES in the same cascade position so order is unchanged.
 */
export const WORKSPACE_SHELL_STYLES = `.wsx { position: relative; height: 100vh; height: 100dvh; overflow: hidden; color: var(--color-text); background-color: var(--color-bg); background-image: radial-gradient(circle, color-mix(in srgb, var(--color-text) 11%, transparent) 1px, transparent 1.4px); background-size: 22px 22px; background-position: -1px -1px; }
.wsx__body { height: 100%; display: grid; grid-template-columns: var(--wsx-rail) minmax(0,1fr) var(--wsx-act); min-height: 0; }
/* !important so the collapsed width beats any inline --wsx-rail. */
.wsx.is-rail-collapsed { --wsx-rail: 70px !important; }

/* ---- right-sidebar resize handle (appears on sidebar hover) ---- */
.wsx__acthandle { position: absolute; left: 3px; top: 50%; transform: translateY(-50%); width: 6px; height: 46px; padding: 0; border: 0; border-radius: 999px; background: var(--color-border-strong); cursor: col-resize; opacity: 0; transition: opacity var(--duration-fast), background var(--duration-fast); z-index: 6; }
.wsx__activity:hover .wsx__acthandle, .wsx__acthandle:focus-visible { opacity: 1; }
.wsx__acthandle:hover, .wsx__acthandle.is-dragging { background: var(--color-primary); }

/* ---- rail (floating liquid-glass panel on the canvas) ---- */
.wsx__rail { margin: 12px 0 12px 12px; background: var(--glass-bg-strong); -webkit-backdrop-filter: blur(20px); backdrop-filter: blur(20px); border: 1px solid var(--color-border); border-radius: var(--radius-xl); box-shadow: var(--shadow-lg); padding: var(--space-3) var(--space-2) var(--space-3); display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow-y: auto; overflow-x: hidden; }
.wsx__railtop { display: flex; align-items: center; gap: 8px; padding: 4px 8px 8px; }
.wsx__brand { font: 800 var(--text-base) var(--font-display, var(--font-body)); color: var(--color-text); white-space: nowrap; overflow: hidden; }
.wsx__collapse { margin-left: auto; width: 26px; height: 26px; display: grid; place-items: center; border: 0; background: transparent; border-radius: var(--radius-sm); color: var(--color-text-tertiary); cursor: pointer; flex: none; }
.wsx__collapse:hover { background: var(--color-surface); color: var(--color-text); }
/* mobile-only chrome (hamburger + drawer close) — hidden on desktop */
.wsx__hamb { display: none; }
.wsx__railclose { display: none; }
.wsx__create { display: flex; align-items: center; gap: 9px; padding: 10px 12px; border: 0; border-radius: var(--radius-md); background: var(--color-primary); color: var(--color-text-inverse); font: 600 var(--text-sm) var(--font-body); cursor: pointer; transition: background var(--duration-fast); margin-bottom: var(--space-2); white-space: nowrap; overflow: hidden; }
.wsx__create:hover { background: var(--color-primary-hover); }
.wsx-lens { display: flex; align-items: center; gap: 11px; width: 100%; padding: 9px 12px; border: 0; border-radius: var(--radius-md); background: transparent; color: var(--color-text-secondary); font: 600 var(--text-sm) var(--font-body); text-align: left; cursor: pointer; transition: background var(--duration-fast), color var(--duration-fast); white-space: nowrap; overflow: hidden; }
.wsx-lens:hover { background: var(--color-surface); color: var(--color-text); }
.wsx-lens.is-active { background: var(--color-primary-light); color: var(--color-primary); }
.wsx-lens svg, .wsx__create svg { flex: none; }
.wsx__railgroup-title { font: 600 var(--text-xs) var(--font-body); text-transform: uppercase; letter-spacing: 0.06em; color: var(--color-text-tertiary); padding: var(--space-3) 12px var(--space-1); white-space: nowrap; }
.wsx__follows:empty::after { content: 'Nothing followed yet'; font-size: var(--text-xs); color: var(--color-text-tertiary); padding: 0 12px; white-space: nowrap; }
.wsx__railspace { flex: 1; min-height: 8px; } .wsx__railfoot { display: flex; align-items: center; gap: 4px; margin-top: var(--space-2); padding-top: var(--space-2); border-top: 1px solid var(--color-border); }
.wsx__footbtn { display: grid; place-items: center; width: 34px; height: 34px; flex: none; border: none; background: none; border-radius: var(--radius-md); color: var(--color-text-tertiary); cursor: pointer; text-decoration: none; } .wsx__footbtn:hover { background: var(--color-surface); color: var(--color-text); }
.wsx__footver { margin-left: auto; padding: 3px 8px; border-radius: var(--radius-pill, 999px); font: 600 var(--text-xs) var(--font-mono, var(--font-body)); color: var(--color-text-tertiary); text-decoration: none; white-space: nowrap; letter-spacing: 0.02em; } .wsx__footver:hover { color: var(--color-text-secondary); background: var(--color-surface); }
.wsx__acct { display: flex; align-items: center; gap: 9px; padding: 8px 10px; border-radius: var(--radius-md); text-decoration: none; color: var(--color-text-secondary); }
.wsx__acct:hover { background: var(--color-surface); }
.wsx__avatar { width: 28px; height: 28px; border-radius: 50%; object-fit: cover; background: var(--color-primary-light); display: grid; place-items: center; color: var(--color-primary); font: 700 12px var(--font-body); flex: none; }
.wsx__acctname { font: 600 var(--text-sm) var(--font-body); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1; }
.wsx__acctout { color: var(--color-text-tertiary); flex: none; }
/* collapsed rail: icons only */
.wsx.is-rail-collapsed .wsx-lens span, .wsx.is-rail-collapsed .wsx__create span,
.wsx.is-rail-collapsed .wsx__brand, .wsx.is-rail-collapsed .wsx__railgroup-title,
.wsx.is-rail-collapsed .wsx__follows, .wsx.is-rail-collapsed .wsx__acctname,
.wsx.is-rail-collapsed .wsx__acctout, .wsx.is-rail-collapsed .wsx__footver { display: none; }
.wsx.is-rail-collapsed .wsx-lens, .wsx.is-rail-collapsed .wsx__create, .wsx.is-rail-collapsed .wsx__acct { justify-content: center; padding-inline: 0; } .wsx.is-rail-collapsed .wsx__railfoot { flex-direction: column; gap: 2px; }
/* collapsed: logo mark only (no wordmark), stacked above the expand chevron so
   neither gets clipped in the 58px rail. */
.wsx.is-rail-collapsed .wsx__railtop { flex-direction: column; gap: 8px; padding: 4px 0 10px; }
.wsx.is-rail-collapsed .brand { justify-content: center; gap: 0; }
.wsx.is-rail-collapsed .brand-mark { width: 30px; height: 30px; }
.wsx.is-rail-collapsed .wsx__collapse { margin-left: 0; transform: rotate(180deg); }

`;
