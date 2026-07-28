import { describe, expect, it } from 'vitest';
import { HOME_COPY, getHomeI18nScript, homeLangSwitchHtml } from '../../src/pages/home/home-i18n';
import { buildWorkspaceView } from '../../src/pages/home/render-workspace';
import type { RenderArgs } from '../../src/pages/home/types';
import { ADMIN_COPY } from '../../src/pages/home/home-i18n/copy/admin';
import { SHELL_COPY } from '../../src/pages/home/home-i18n/copy/shell';

const args = {
  user: { id: 'u1', email: 'a@b.com' },
  userInfo: { name: 'Test', picture: null },
  workspaces: [],
  workspaceRole: 'owner',
  workspaceId: 'ws1',
  workspace: 'ws1',
} as RenderArgs;

describe('home i18n', () => {
  it('has matching keys in en and es', () => {
    const enKeys = Object.keys(HOME_COPY.en).sort();
    const esKeys = Object.keys(HOME_COPY.es).sort();
    expect(esKeys).toEqual(enKeys);
  });

  it('domain modules have matching keys per locale', () => {
    for (const mod of [SHELL_COPY, ADMIN_COPY]) {
      expect(Object.keys(mod.es).sort()).toEqual(Object.keys(mod.en).sort());
    }
  });

  it('merged copy includes keys from domain modules', () => {
    expect(HOME_COPY.en['nav.brief']).toBe(SHELL_COPY.en['nav.brief']);
    expect(HOME_COPY.es['admin.settings']).toBe(ADMIN_COPY.es['admin.settings']);
  });

  it('wires the Knowledge lens into the workspace shell (view, nav, loader, deep-link)', () => {
    const { body, scripts } = buildWorkspaceView(args);
    expect(body).toContain('data-view="knowledge"');
    expect(body).toContain('id="wsxKnMount"');
    expect(body).toContain('data-i18n="view.knowledge"');
    expect(body).toContain('data-i18n="intro.knowledge"');
    expect(scripts).toContain('function loadKnowledge()');
    expect(scripts).toContain('function knRoute(');
    expect(scripts).toContain("key === 'knowledge'");
    expect(scripts).toContain("'l/knowledge/'");
    for (const k of ['nav.knowledge', 'view.knowledge', 'intro.knowledge', 'knowledge.couldNotLoad', 'knowledge.noMatch']) {
      expect(HOME_COPY.en[k]).toBeTruthy();
      expect(HOME_COPY.es[k]).toBeTruthy();
    }
    // Parses (does not run) the whole inline bundle — catches syntax errors in the fragment.
    expect(() => new Function(scripts)).not.toThrow();
  });

  it('embeds i18n bootstrap and data-i18n markers in workspace shell', () => {
    const { body, scripts } = buildWorkspaceView(args);
    expect(scripts).toContain('__SO_HOME_T');
    expect(scripts).toContain('shareout_lang');
    expect(body).toContain('data-i18n="nav.brief"');
    expect(body).toContain('data-i18n="admin.settings"');
    expect(body).toContain('home-lang-btn');
    expect(homeLangSwitchHtml()).toContain('data-lang="es"');
    expect(() => new Function(getHomeI18nScript())).not.toThrow();
  });
});
