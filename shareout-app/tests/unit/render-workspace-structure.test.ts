import { describe, expect, it } from 'vitest';
import { buildWorkspaceView, WORKSPACE_STYLES } from '../../src/pages/home/render-workspace';
import type { RenderArgs } from '../../src/pages/home/types';

const args = {
  user: { id: 'u1', email: 'a@b.com' },
  userInfo: { name: 'Test', picture: null },
  workspaces: [],
  workspaceRole: 'owner',
  workspaceId: 'ws1',
  workspace: 'ws1',
} as RenderArgs;

describe('render-workspace module structure', () => {
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
