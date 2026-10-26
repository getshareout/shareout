/**
 * Inspector Data tab (client-script/inspector-data.ts). Same anatomy as the shared-link
 * viewer's Data sources panel, in the Studio's type scale and tokens.
 */
export const WORKSPACE_DATA_SOURCES_STYLES = `
.wsx-ds { display: flex; flex-direction: column; gap: var(--space-3); padding: var(--space-4); }
.wsx-ds__lead { margin: 0; font-size: var(--text-sm); color: var(--color-text-secondary); }
.wsx-ds__list { display: flex; flex-direction: column; gap: var(--space-1); margin: 0; padding: 0; list-style: none; }
.wsx-ds__src { display: flex; align-items: flex-start; gap: var(--space-3); width: 100%; min-height: var(--touch-target-min); padding: var(--space-3); border: 1px solid transparent; border-radius: var(--radius-sm); background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; transition: background var(--duration-fast) var(--ease-out), border-color var(--duration-fast) var(--ease-out); }
.wsx-ds__src:hover, .wsx-ds__src:focus-visible { background: var(--color-surface); }
.wsx-ds__src:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.wsx-ds__src[aria-pressed="true"] { border-color: color-mix(in srgb, var(--color-primary) 35%, transparent); background: var(--color-primary-light); }
.wsx-ds__ico { display: grid; place-items: center; flex: none; width: 28px; height: 28px; border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text-secondary); }
.wsx-ds__src:hover .wsx-ds__ico, .wsx-ds__src[aria-pressed="true"] .wsx-ds__ico { background: var(--color-bg-elevated); }
.wsx-ds__src[aria-pressed="true"] .wsx-ds__ico { color: var(--color-primary); }
.wsx-ds__main { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.wsx-ds__name { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); overflow-wrap: anywhere; }
.wsx-ds__tag { display: inline-block; margin-left: var(--space-2); padding: 1px var(--space-2); border-radius: var(--radius-full); background: var(--color-surface); color: var(--color-text-secondary); font-size: var(--text-xs); font-weight: 500; vertical-align: 1px; }
.wsx-ds__meta { font-size: var(--text-xs); color: var(--color-text-secondary); overflow-wrap: anywhere; }
.wsx-ds__stale { display: inline-flex; align-items: center; gap: var(--space-1); width: fit-content; margin-top: 2px; padding: 2px var(--space-2); border-radius: var(--radius-full); background: var(--color-warning-light); color: var(--color-text); font-size: var(--text-xs); font-weight: 500; }
.wsx-ds__stale svg { flex: none; color: var(--color-warning); }
.wsx-ds__more { margin: 0 var(--space-3) var(--space-2) calc(28px + 2 * var(--space-3)); font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-ds__more summary { min-height: 28px; display: inline-flex; align-items: center; color: var(--color-primary); font-weight: 500; cursor: pointer; }
.wsx-ds__more summary:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.wsx-ds__more pre { max-height: 180px; margin: var(--space-2) 0; padding: var(--space-3); overflow: auto; border-radius: var(--radius-sm); background: var(--color-surface); color: var(--color-text); font: 12px/1.5 var(--font-mono); white-space: pre-wrap; overflow-wrap: anywhere; }
.wsx-ds__more dl { display: grid; grid-template-columns: auto 1fr; gap: var(--space-1) var(--space-3); margin: var(--space-2) 0 0; }
.wsx-ds__more dt { font-weight: 600; color: var(--color-text-secondary); }
.wsx-ds__more dd { margin: 0; color: var(--color-text); overflow-wrap: anywhere; }
.wsx-ds__links { display: flex; flex-wrap: wrap; gap: var(--space-2) var(--space-4); margin-top: var(--space-2); }
.wsx-ds__note { margin: 0; font-size: var(--text-xs); color: var(--color-text-secondary); }
@media (prefers-reduced-motion: reduce) { .wsx-ds__src { transition: none; } }
`;
