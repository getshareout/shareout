import { describe, expect, it } from 'vitest';
import { buildWorkspaceView, WORKSPACE_STYLES } from '../../src/pages/home/render-workspace';
import type { RenderArgs } from '../../src/pages/home/types';
import inspectorJs from '../../src/pages/home/render-workspace/client-script/inspector.ts?raw';
import editLiteJs from '../../src/pages/home/render-workspace/client-script/edit-lite.ts?raw';
import stylesTs from '../../src/pages/home/render-workspace/styles.ts?raw';
import shellCss from '../../src/pages/home/render-workspace/styles-shell.ts?raw';
import canvasCss from '../../src/pages/home/render-workspace/styles-canvas.ts?raw';
import lensesCss from '../../src/pages/home/render-workspace/styles-lenses.ts?raw';
import formsEditCss from '../../src/pages/home/render-workspace/styles-forms-edit.ts?raw';
import sidebarCss from '../../src/pages/home/render-workspace/styles-sidebar.ts?raw';
import agentComposerCss from '../../src/pages/home/render-workspace/styles-agent-composer.ts?raw';
import adminJs from '../../src/pages/home/render-workspace/client-script/home-views/admin.ts?raw';
import homeViewsBarrel from '../../src/pages/home/render-workspace/client-script/home-views.ts?raw';

const MAX_LINES = 1000;

/** Mirrors styles.ts assembly — guards against orphan style modules. */
const WORKSPACE_STYLE_MODULES = [
  shellCss,
  canvasCss,
  lensesCss,
  formsEditCss,
  sidebarCss,
  agentComposerCss,
] as const;

const args = {
  user: { id: 'u1', email: 'a@b.com' },
  userInfo: { name: 'Test', picture: null },
  workspaces: [],
  workspaceRole: 'owner',
  workspaceId: 'ws1',
  workspace: 'ws1',
} as RenderArgs;

describe('render-workspace module structure', () => {
  it('keeps the largest modules under the 1000-line limit', () => {
    for (const [name, src] of [
      ['inspector.ts', inspectorJs],
      ['edit-lite.ts', editLiteJs],
      ['styles.ts', stylesTs],
      ['styles-sidebar.ts', sidebarCss],
      ['home-views/admin.ts', adminJs],
      ['home-views.ts (barrel)', homeViewsBarrel],
    ] as const) {
      const lines = src.split('\n').length;
      expect(lines, `${name} has ${lines} lines`).toBeLessThanOrEqual(MAX_LINES);
    }
  });

  it('exports non-empty CSS from every workspace style section module', () => {
    for (const section of WORKSPACE_STYLE_MODULES) {
      expect(section.trim().length).toBeGreaterThan(50);
      expect(section).toContain('export const WORKSPACE_');
    }
  });

  it('concatenates style sections in cascade order without dropping selectors', () => {
    expect(WORKSPACE_STYLES.indexOf('.wsx {')).toBeLessThan(WORKSPACE_STYLES.indexOf('/* ---- canvas ---- */'));
    expect(WORKSPACE_STYLES.indexOf('/* ---- canvas ---- */')).toBeLessThan(
      WORKSPACE_STYLES.indexOf('/* ---- artifact stage (per tab) ---- */')
    );
    expect(WORKSPACE_STYLES.indexOf('/* ---- Modal + native create forms ---- */')).toBeLessThan(
      WORKSPACE_STYLES.indexOf('/* ---- right rail (the working Inspector')
    );
    expect(WORKSPACE_STYLES.indexOf('/* ---- agent dock (inside canvas) ---- */')).toBeLessThan(
      WORKSPACE_STYLES.indexOf('/* ===== account menu:')
    );
    expect(WORKSPACE_STYLES).toContain('--wsx-rail');
    expect(WORKSPACE_STYLES).toContain('.wsx__composer');
  });

  it('exports buildWorkspaceView and WORKSPACE_STYLES from the package entry', () => {
    const { body, scripts } = buildWorkspaceView(args);
    expect(body).toContain('id="wsx"');
    expect(body).toContain('data-view="brief"');
    expect(scripts).toContain('window.WSX_WS');
    expect(WORKSPACE_STYLES).toContain('--wsx-rail');
  });

  it('emits WSX_KNOWLEDGE_PAID from the workspace tier flag', () => {
    expect(buildWorkspaceView({ ...args, wsKnowledgePaid: true }).scripts)
      .toContain('window.WSX_KNOWLEDGE_PAID=true');
    expect(buildWorkspaceView({ ...args, wsKnowledgePaid: false }).scripts)
      .toContain('window.WSX_KNOWLEDGE_PAID=false');
  });

  it('client script composes to valid JavaScript', () => {
    const { scripts } = buildWorkspaceView(args);
    expect(() => new Function(scripts)).not.toThrow();
    expect(scripts).toContain('function loadFeed');
    expect(scripts).toContain('Edit-Lite');
  });
});
