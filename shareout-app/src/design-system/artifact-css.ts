/**
 * ShareOut UI — artifact-facing stylesheet.
 * Served at /sdk/shareout.css. Brand-correct UI for published artifacts
 * with near-zero authored CSS: link once, use `.so-` classes.
 *
 * The `:root` block is GENERATED from tokens.ts so values never drift.
 * Component classes are authored here and reference `var(--so-*)`.
 */

import {
  colors,
  spacing,
  radius,
  shadows,
  fontSizes,
  fontWeights,
  fonts,
  animation,
  layout,
  fontshareDisplayUrl,
  googleFontsUrl,
} from './tokens';

const kebab = (s: string) =>
  s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();

function varsFrom(prefix: string, obj: Record<string, string | number>): string {
  return Object.entries(obj)
    .map(([key, value]) => `  --so-${prefix}-${kebab(String(key))}: ${value};`)
    .join('\n');
}

// Brand chart palette for JS chart libs to read via getComputedStyle / ShareOutUI.chartColors().
const chartPalette = [
  colors.primary,
  colors.success,
  colors.warning,
  colors.error,
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

const rootVars = `:root {
${varsFrom('color', colors)}
${varsFrom('space', spacing)}
${varsFrom('radius', radius)}
${varsFrom('shadow', shadows)}
${varsFrom('text', fontSizes)}
${varsFrom('weight', fontWeights)}
${varsFrom('font', fonts)}
  --so-ease-out: ${animation.easeOut};
  --so-ease-in-out: ${animation.easeInOut};
  --so-duration-fast: ${animation.durationFast};
  --so-duration-normal: ${animation.durationNormal};
  --so-duration-slow: ${animation.durationSlow};
  --so-touch-target: ${layout.touchTarget};
  --so-max-width: ${layout.maxWidth};
  --so-max-width-narrow: ${layout.maxWidthNarrow};
  --so-max-width-wide: ${layout.maxWidthWide};
${chartPalette.map((c, i) => `  --so-chart-${i + 1}: ${c};`).join('\n')}
}`;

const fontImports = `@import url('${fontshareDisplayUrl}');
@import url('${googleFontsUrl}');`;

// Light classless base — even unstyled HTML looks on-brand. Body only; no aggressive reset.
const base = `
*, *::before, *::after { box-sizing: border-box; }

body {
  margin: 0;
  font-family: var(--so-font-body);
  font-size: var(--so-text-base);
  line-height: 1.6;
  color: var(--so-color-text);
  background: var(--so-color-bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

h1, h2, h3, h4, h5, h6 {
  font-family: var(--so-font-display);
  color: var(--so-color-text);
  line-height: 1.2;
  margin: 0 0 var(--so-space-4);
}
h1 { font-size: var(--so-text-4xl); }
h2 { font-size: var(--so-text-3xl); }
h3 { font-size: var(--so-text-2xl); }
h4 { font-size: var(--so-text-xl); }

p { margin: 0 0 var(--so-space-4); }

a { color: var(--so-color-primary); text-decoration: none; }
a:hover { color: var(--so-color-primary-hover); text-decoration: underline; }

code, pre, kbd {
  font-family: var(--so-font-mono);
  font-size: 0.9em;
}
code {
  background: var(--so-color-surface);
  border-radius: var(--so-radius-sm);
  padding: 2px 6px;
}`;

const layoutClasses = `
.so-container { width: 100%; max-width: var(--so-max-width); margin: 0 auto; padding: 0 var(--so-space-6); }
.so-container-narrow { max-width: var(--so-max-width-narrow); }
.so-container-wide { max-width: var(--so-max-width-wide); }

.so-page { padding: var(--so-space-10) 0; }
.so-section { padding: var(--so-space-8) 0; }
.so-section + .so-section { border-top: 1px solid var(--so-color-border); }

.so-stack { display: flex; flex-direction: column; gap: var(--so-space-4); }
.so-row { display: flex; align-items: center; gap: var(--so-space-3); }
.so-row-between { display: flex; align-items: center; justify-content: space-between; gap: var(--so-space-3); }

.so-grid { display: grid; gap: var(--so-space-4); grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.so-grid-2 { grid-template-columns: repeat(2, 1fr); }
.so-grid-3 { grid-template-columns: repeat(3, 1fr); }
.so-grid-4 { grid-template-columns: repeat(4, 1fr); }
@media (max-width: 640px) {
  .so-grid-2, .so-grid-3, .so-grid-4 { grid-template-columns: 1fr; }
}

.so-header {
  position: sticky; top: 0; z-index: 100;
  height: var(--so-touch-target);
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 var(--so-space-6);
  background: var(--so-color-bg-elevated);
  border-bottom: 1px solid var(--so-color-border);
}
.so-header-title { font-family: var(--so-font-display); font-weight: var(--so-weight-bold); font-size: var(--so-text-xl); }

.so-empty { text-align: center; padding: var(--so-space-12) var(--so-space-6); }
.so-empty-title { font-family: var(--so-font-display); font-weight: var(--so-weight-semibold); font-size: var(--so-text-lg); margin-bottom: var(--so-space-2); }
.so-empty-text { color: var(--so-color-text-secondary); }`;

const buttonClasses = `
.so-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--so-space-2);
  min-height: var(--so-touch-target); padding: 14px 28px;
  border-radius: var(--so-radius-sm); border: none; cursor: pointer;
  font: var(--so-weight-semibold) var(--so-text-md) var(--so-font-body);
  text-decoration: none;
  transition: transform var(--so-duration-fast) var(--so-ease-out),
              background var(--so-duration-normal) var(--so-ease-out),
              border-color var(--so-duration-normal) var(--so-ease-out);
}
.so-btn:disabled, .so-btn[disabled] { opacity: 0.5; cursor: not-allowed; }

.so-btn-primary { background: var(--so-color-primary); color: var(--so-color-text-inverse); }
.so-btn-primary:hover:not(:disabled) { background: var(--so-color-primary-hover); transform: translateY(-1px); text-decoration: none; }
.so-btn-primary:active:not(:disabled) { transform: translateY(0) scale(0.98); }

.so-btn-secondary { background: var(--so-color-bg-elevated); color: var(--so-color-text); border: 1px solid var(--so-color-border); font-weight: var(--so-weight-medium); }
.so-btn-secondary:hover:not(:disabled) { border-color: var(--so-color-border-strong); background: var(--so-color-surface); }

.so-btn-ghost { background: transparent; color: var(--so-color-text-secondary); padding: var(--so-space-3) var(--so-space-4); min-height: 44px; font-weight: var(--so-weight-medium); font-size: var(--so-text-base); }
.so-btn-ghost:hover:not(:disabled) { background: var(--so-color-surface); color: var(--so-color-text); }

.so-btn-icon { width: var(--so-touch-target); height: var(--so-touch-target); padding: 0; background: transparent; color: var(--so-color-text-secondary); }
.so-btn-icon:hover:not(:disabled) { background: var(--so-color-surface); color: var(--so-color-text); }`;

const inputClasses = `
.so-field { display: block; margin-bottom: var(--so-space-4); }
.so-label { display: block; margin-bottom: var(--so-space-2); font: var(--so-weight-medium) var(--so-text-sm) var(--so-font-body); color: var(--so-color-text-secondary); }
.so-input, .so-select, .so-textarea {
  width: 100%; min-height: var(--so-touch-target);
  padding: var(--so-space-3) var(--so-space-4);
  border-radius: var(--so-radius-sm); border: 1px solid var(--so-color-border);
  background: var(--so-color-bg-elevated); color: var(--so-color-text);
  font: var(--so-weight-normal) var(--so-text-md) var(--so-font-body);
  transition: border-color var(--so-duration-normal) var(--so-ease-out), box-shadow var(--so-duration-normal) var(--so-ease-out);
}
.so-textarea { min-height: 96px; resize: vertical; line-height: 1.5; }
.so-input:focus, .so-select:focus, .so-textarea:focus {
  outline: none; border-color: var(--so-color-primary);
  box-shadow: 0 0 0 3px var(--so-color-primary-alpha15);
}
.so-input.so-error, .so-input:invalid:not(:placeholder-shown) { border-color: var(--so-color-error); }
.so-hint { margin-top: var(--so-space-2); font-size: var(--so-text-sm); color: var(--so-color-text-tertiary); }
.so-error-message { margin-top: var(--so-space-2); font-size: var(--so-text-sm); color: var(--so-color-error); }`;

const cardClasses = `
.so-card {
  background: var(--so-color-bg-elevated); border-radius: var(--so-radius-md);
  border: 1px solid var(--so-color-border); padding: var(--so-space-6);
  box-shadow: var(--so-shadow-sm);
}
.so-card-title { font: var(--so-weight-semibold) var(--so-text-lg) var(--so-font-display); color: var(--so-color-text); margin: 0 0 var(--so-space-4); }
.so-card-interactive { cursor: pointer; transition: transform var(--so-duration-normal) var(--so-ease-out), box-shadow var(--so-duration-normal) var(--so-ease-out), border-color var(--so-duration-normal) var(--so-ease-out); }
.so-card-interactive:hover { transform: translateY(-2px); box-shadow: var(--so-shadow-md); border-color: var(--so-color-border-strong); }`;

const badgeClasses = `
.so-badge { display: inline-flex; align-items: center; padding: var(--so-space-1) var(--so-space-3); border-radius: var(--so-radius-full); font: var(--so-weight-medium) var(--so-text-sm) var(--so-font-body); background: var(--so-color-surface); color: var(--so-color-text-secondary); }
.so-badge-primary { background: var(--so-color-primary-light); color: var(--so-color-primary); }
.so-badge-success { background: var(--so-color-success-light); color: var(--so-color-success); }
.so-badge-warning { background: var(--so-color-warning-light); color: var(--so-color-warning); }
.so-badge-error { background: var(--so-color-error-light); color: var(--so-color-error); }`;

const dataClasses = `
.so-table { width: 100%; border-collapse: collapse; }
.so-table th { padding: var(--so-space-4) var(--so-space-3); text-align: left; border-bottom: 1px solid var(--so-color-border); font: var(--so-weight-medium) var(--so-text-sm) var(--so-font-body); color: var(--so-color-text-tertiary); }
.so-table td { padding: var(--so-space-4) var(--so-space-3); text-align: left; border-bottom: 1px solid var(--so-color-border); font-size: var(--so-text-base); color: var(--so-color-text); }
.so-table tr:hover td { background: var(--so-color-surface); }

.so-stat { background: var(--so-color-surface); border-radius: var(--so-radius-md); padding: var(--so-space-5); text-align: center; }
.so-stat-value { font: var(--so-weight-bold) var(--so-text-3xl) var(--so-font-display); color: var(--so-color-primary); line-height: 1.2; }
.so-stat-label { margin-top: var(--so-space-2); font: var(--so-weight-medium) var(--so-text-sm) var(--so-font-body); color: var(--so-color-text-secondary); }

.so-kpi {
  background: var(--so-color-bg-elevated); border: 1px solid var(--so-color-border);
  border-radius: var(--so-radius-md); padding: var(--so-space-5); box-shadow: var(--so-shadow-sm);
}
.so-kpi-label { font: var(--so-weight-medium) var(--so-text-sm) var(--so-font-body); color: var(--so-color-text-secondary); }
.so-kpi-value { margin-top: var(--so-space-2); font: var(--so-weight-bold) var(--so-text-4xl) var(--so-font-display); color: var(--so-color-text); line-height: 1.1; }
.so-kpi-delta { margin-top: var(--so-space-1); font-size: var(--so-text-sm); }
.so-kpi-delta.so-up { color: var(--so-color-success); }
.so-kpi-delta.so-down { color: var(--so-color-error); }`;

const interactiveClasses = `
.so-toast-container { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%); z-index: 1000; display: flex; flex-direction: column; gap: var(--so-space-3); }
.so-toast {
  min-height: var(--so-touch-target); display: flex; align-items: center;
  padding: 14px 20px; border-radius: var(--so-radius-lg);
  font: var(--so-weight-medium) var(--so-text-base) var(--so-font-body);
  color: var(--so-color-text-inverse); background: var(--so-color-primary); box-shadow: var(--so-shadow-lg);
  animation: so-toast-in var(--so-duration-slow) var(--so-ease-out);
}
.so-toast.so-success { background: var(--so-color-success); }
.so-toast.so-warning { background: var(--so-color-warning); }
.so-toast.so-error { background: var(--so-color-error); }
@keyframes so-toast-in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

.so-modal-backdrop { position: fixed; inset: 0; z-index: 300; display: flex; align-items: center; justify-content: center; padding: var(--so-space-4); background: rgba(28, 25, 23, 0.45); }
.so-modal {
  background: var(--so-color-bg-elevated); border-radius: var(--so-radius-lg);
  padding: var(--so-space-8); width: 100%; max-width: 480px; max-height: 90vh; overflow-y: auto;
  box-shadow: var(--so-shadow-xl); animation: so-toast-in var(--so-duration-slow) var(--so-ease-out);
}

.so-tabs { display: flex; gap: var(--so-space-1); border-bottom: 1px solid var(--so-color-border); }
.so-tab {
  padding: var(--so-space-3) var(--so-space-4); border: none; background: transparent; cursor: pointer;
  font: var(--so-weight-medium) var(--so-text-base) var(--so-font-body); color: var(--so-color-text-secondary);
  border-bottom: 2px solid transparent; margin-bottom: -1px;
}
.so-tab:hover { color: var(--so-color-text); }
.so-tab.so-active { color: var(--so-color-primary); border-bottom-color: var(--so-color-primary); }
.so-tab-panel { padding: var(--so-space-5) 0; }
.so-tab-panel[hidden] { display: none; }

.so-dropdown { position: relative; display: inline-block; }
.so-dropdown-menu {
  position: absolute; top: calc(100% + 4px); left: 0; z-index: 100; min-width: 180px;
  background: var(--so-color-bg-elevated); border: 1px solid var(--so-color-border);
  border-radius: var(--so-radius-sm); box-shadow: var(--so-shadow-lg); padding: var(--so-space-1);
}
.so-dropdown-menu[hidden] { display: none; }
.so-dropdown-item {
  display: block; width: 100%; text-align: left; padding: var(--so-space-2) var(--so-space-3);
  border: none; background: transparent; border-radius: var(--so-radius-sm); cursor: pointer;
  font: var(--so-weight-normal) var(--so-text-base) var(--so-font-body); color: var(--so-color-text);
}
.so-dropdown-item:hover { background: var(--so-color-surface); }`;

export const artifactStylesheet = [
  fontImports,
  rootVars,
  base,
  layoutClasses,
  buttonClasses,
  inputClasses,
  cardClasses,
  badgeClasses,
  dataClasses,
  interactiveClasses,
].join('\n');
