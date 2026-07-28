import { describe, expect, it } from 'vitest';
import { getEditorStyles } from '../../../../src/editor/page/styles/editor-styles';
import { tokensCss } from '../../../../src/editor/page/styles/sections/tokens.css';
import { baseCss } from '../../../../src/editor/page/styles/sections/base.css';
import { topbarCss } from '../../../../src/editor/page/styles/sections/topbar.css';
import { workspaceMenuCss } from '../../../../src/editor/page/styles/sections/workspace-menu.css';
import { canvasCss } from '../../../../src/editor/page/styles/sections/canvas.css';
import { stylePopoverCss } from '../../../../src/editor/page/styles/sections/style-popover.css';
import { studioRailShellCss } from '../../../../src/editor/page/styles/sections/studio-rail-shell.css';
import { studioRailAgentCss } from '../../../../src/editor/page/styles/sections/studio-rail-agent.css';
import { studioRailInspectCss } from '../../../../src/editor/page/styles/sections/studio-rail-inspect.css';
import { studioRailDataCss } from '../../../../src/editor/page/styles/sections/studio-rail-data.css';
import { workspaceDrawerCss } from '../../../../src/editor/page/styles/sections/workspace-drawer.css';
import { outlinePanelCss } from '../../../../src/editor/page/styles/sections/outline-panel.css';
import { artifactDetailsDrawerCss } from '../../../../src/editor/page/styles/sections/artifact-details-drawer.css';
import { selectionHandlesCss } from '../../../../src/editor/page/styles/sections/selection-handles.css';
import { lassoToolCss } from '../../../../src/editor/page/styles/sections/lasso-tool.css';
import { responsiveCss } from '../../../../src/editor/page/styles/sections/responsive.css';
import { utilitiesCss } from '../../../../src/editor/page/styles/sections/utilities.css';
import { variablePopoverCss } from '../../../../src/editor/page/styles/sections/variable-popover.css';
import { artifactDetailsEnhancedCss } from '../../../../src/editor/page/styles/sections/artifact-details-enhanced.css';
import { validationPanelCss } from '../../../../src/editor/page/styles/sections/validation-panel.css';

/** Mirrors the section list in editor-styles.ts — guards against orphan modules. */
const SECTION_CSS_MODULES = [
  tokensCss,
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
] as const;

const MAX_SECTION_CHARS = 45_000;

describe('getEditorStyles', () => {
  it('returns non-empty CSS with design tokens and layout classes', () => {
    const css = getEditorStyles();

    expect(css.length).toBeGreaterThan(1000);
    expect(css).toContain('--primary:');
    expect(css).toContain('.editor-topbar');
    expect(css).toContain('.studio-rail');
    expect(css).toContain('.canvas');
    expect(css).toContain('.validation-success');
  });

  it('concatenates section modules in cascade order without dropping content', () => {
    const css = getEditorStyles();

    expect(css.indexOf('--primary:')).toBeLessThan(css.indexOf('.editor-topbar'));
    expect(css.indexOf('.studio-rail')).toBeLessThan(css.indexOf('.workspace-drawer'));
    expect(css).toContain(tokensCss.trim());
    expect(css).toContain(studioRailInspectCss.trim());
    expect(css).toContain(validationPanelCss.trim());
  });
});

describe('editor style sections', () => {
  it('exports non-empty CSS from every section module', () => {
    for (const sectionCss of SECTION_CSS_MODULES) {
      expect(sectionCss.trim().length).toBeGreaterThan(10);
    }
  });

  it('keeps each section module within a reasonable size budget', () => {
    for (const sectionCss of SECTION_CSS_MODULES) {
      expect(sectionCss.length).toBeLessThanOrEqual(MAX_SECTION_CHARS);
    }
  });
});
