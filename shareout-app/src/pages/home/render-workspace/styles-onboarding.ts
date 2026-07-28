/**
 * Onboarding checklist styles (work/033) — kept out of styles.ts to stay under the
 * per-module line cap. Blue ring (never gold), green checks, calm one-shot reveal;
 * all on design tokens, with a reduced-motion guard (styles.ts has no global reset).
 */
export const WORKSPACE_ONBOARDING_STYLES = `
.wsx-onb { border: 1.5px solid var(--color-primary); border-radius: var(--radius-md); background: var(--color-primary-light); padding: 12px 14px; display: flex; flex-direction: column; gap: 10px; }
.wsx-onb__head { display: flex; align-items: center; gap: 12px; }
.wsx-onb__ringwrap { flex: none; }
.wsx-onb__ring { display: block; }
.wsx-onb__ringbg { fill: none; stroke: color-mix(in srgb, var(--color-primary) 20%, transparent); stroke-width: 4; }
.wsx-onb__ringfg { fill: none; stroke: var(--color-primary); stroke-width: 4; stroke-linecap: round; transform: rotate(-90deg); transform-origin: 50% 50%; transition: stroke-dashoffset var(--duration-slow, 400ms) ease; }
.wsx-onb__htext { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wsx-onb__title { font: 700 var(--text-sm) var(--font-body); color: var(--color-text); }
.wsx-onb__progress { font-size: var(--text-xs); color: var(--color-text-secondary); }
.wsx-onb__hide { flex: none; border: 0; background: transparent; color: var(--color-text-tertiary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; padding: 4px 8px; border-radius: var(--radius-sm); }
.wsx-onb__hide:hover { color: var(--color-text); background: var(--color-surface); }
.wsx-onb__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.wsx-onb__item { display: flex; align-items: center; gap: 10px; padding: 8px; border-radius: var(--radius-sm); background: var(--color-bg); border: 1px solid var(--color-border); }
.wsx-onb__item.is-done { background: transparent; border-color: transparent; }
.wsx-onb__check { flex: none; width: 20px; height: 20px; display: grid; place-items: center; border-radius: 50%; font-size: 12px; font-weight: 700; color: var(--color-text-tertiary); }
.wsx-onb__item.is-done .wsx-onb__check { color: var(--color-success); }
.wsx-onb__body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
.wsx-onb__label { font: 600 var(--text-sm) var(--font-body); color: var(--color-text); }
.wsx-onb__item.is-done .wsx-onb__label { text-decoration: line-through; color: var(--color-text-secondary); }
.wsx-onb__why { font-size: var(--text-xs); color: var(--color-text-tertiary); line-height: 1.4; }
.wsx-onb__item.is-done .wsx-onb__why { display: none; }
.wsx-onb__cta { flex: none; min-height: 44px; padding: 8px 16px; border: 0; border-radius: var(--radius-sm); background: var(--color-primary); color: var(--color-text-inverse); font: 600 var(--text-sm) var(--font-body); cursor: pointer; }
.wsx-onb__cta:hover { background: var(--color-primary-hover); }
.wsx-onb__skipbtn { flex: none; min-height: 44px; padding: 8px 10px; border: 0; background: transparent; color: var(--color-text-tertiary); font: 600 var(--text-xs) var(--font-body); cursor: pointer; border-radius: var(--radius-sm); }
.wsx-onb__skipbtn:hover { color: var(--color-text-secondary); }
.wsx-onb__cta:focus-visible, .wsx-onb__skipbtn:focus-visible, .wsx-onb__hide:focus-visible { outline: 2px solid var(--color-primary); outline-offset: 2px; }
.wsx-onb.is-full { align-items: center; text-align: center; }
.wsx-onb__item.is-justdone { animation: wsx-onb-cross var(--duration-slow, 400ms) ease; }
.wsx-onb.is-celebrate { animation: wsx-onb-reveal var(--duration-slow, 400ms) ease; }
@keyframes wsx-onb-cross { from { background: var(--color-primary-light); } to { background: transparent; } }
@keyframes wsx-onb-reveal { from { opacity: 0.4; transform: scale(0.98); } to { opacity: 1; transform: scale(1); } }
@media (prefers-reduced-motion: reduce) { .wsx-onb__ringfg { transition: none; } .wsx-onb__item.is-justdone { animation: none; } .wsx-onb.is-celebrate { animation: none; } }
`;
