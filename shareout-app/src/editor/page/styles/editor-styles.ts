// ShareOut Visual Editor - Chat-first, grandma-friendly styles
/**
 * Composes the full editor stylesheet from focused section modules.
 * Each section lives under `sections/` and stays under 1000 lines.
 *
 * @see sections/ for individual UI areas (topbar, studio rail, validation, etc.)
 */
import { tokensCss } from './sections/tokens.css';
import { baseCss } from './sections/base.css';
import { topbarCss } from './sections/topbar.css';
import { workspaceMenuCss } from './sections/workspace-menu.css';
import { canvasCss } from './sections/canvas.css';
import { stylePopoverCss } from './sections/style-popover.css';
import { studioRailShellCss } from './sections/studio-rail-shell.css';
import { studioRailAgentCss } from './sections/studio-rail-agent.css';
import { studioRailInspectCss } from './sections/studio-rail-inspect.css';
import { studioRailDataCss } from './sections/studio-rail-data.css';
import { workspaceDrawerCss } from './sections/workspace-drawer.css';
import { outlinePanelCss } from './sections/outline-panel.css';
import { artifactDetailsDrawerCss } from './sections/artifact-details-drawer.css';
import { selectionHandlesCss } from './sections/selection-handles.css';
import { lassoToolCss } from './sections/lasso-tool.css';
import { responsiveCss } from './sections/responsive.css';
import { utilitiesCss } from './sections/utilities.css';
import { variablePopoverCss } from './sections/variable-popover.css';
import { artifactDetailsEnhancedCss } from './sections/artifact-details-enhanced.css';
import { validationPanelCss } from './sections/validation-panel.css';
import { shortcutsHelpCss } from './sections/shortcuts-help.css';
import { approvalPickerCss } from './sections/approval-picker.css';
import { componentStylesheet } from '../../../design-system/components/index';

/**
 * Returns the complete CSS bundle injected into the visual editor page.
 * Sections are concatenated in DOM-cascade order (tokens → base → layout → panels).
 */
export function getEditorStyles(): string {
  return [
    tokensCss,
    componentStylesheet(),
    baseCss,
    topbarCss,
    workspaceMenuCss,
    canvasCss,
    stylePopoverCss,
    studioRailShellCss,
    studioRailAgentCss,
    studioRailInspectCss,
    studioRailDataCss,
    workspaceDrawerCss,
    outlinePanelCss,
    artifactDetailsDrawerCss,
    selectionHandlesCss,
    lassoToolCss,
    responsiveCss,
    utilitiesCss,
    variablePopoverCss,
    artifactDetailsEnhancedCss,
    validationPanelCss,
    shortcutsHelpCss,
    approvalPickerCss,
  ].join('\n');
}
