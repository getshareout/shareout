import { TOOLBAR_STYLES } from './styles/index';
import { renderToolbarMarkup } from './markup';
import { renderToolbarScript } from './script';
import { componentStylesheet, componentScripts } from '../../../design-system/components/index';
import type { ToolbarRenderContext } from '../types';

/**
 * Render the full viewer toolbar: styles, overlay markup, and client scripts.
 * Returns an empty string when the toolbar should be hidden.
 *
 * The toolbar renders in the top-level viewer document, which does NOT ship the
 * design-system base CSS variables, so the shared component sheet is injected
 * with { withVars: true } to carry the --color-* custom properties it needs.
 */
export function renderToolbar(ctx: ToolbarRenderContext): string {
  if (!ctx.showToolbar) return '';

  return `
  <style>
${componentStylesheet({ withVars: true })}
${TOOLBAR_STYLES}
  </style>
${renderToolbarMarkup(ctx)}<script>${componentScripts}</script>${renderToolbarScript(ctx)}`;
}
