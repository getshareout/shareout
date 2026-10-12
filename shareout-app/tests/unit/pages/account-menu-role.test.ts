// @vitest-environment node
// The account menu's "API token" entry is for whoever manages a workspace (or a
// personal account) — a plain workspace member doesn't get the developer jargon.
import { describe, expect, it } from 'vitest';
import { buildWorkspaceView } from '../../../src/pages/home/render-workspace';
import type { RenderArgs } from '../../../src/pages/home/types';

function body(extra: Partial<RenderArgs>): string {
  return buildWorkspaceView({
    user: { id: 'u1', email: 'a@b.com' },
    userInfo: { name: 'Test', picture: null },
    workspaces: [],
    ...extra,
  } as RenderArgs).body;
}

describe('account menu — API token entry', () => {
  it('is hidden for a plain workspace member', () => {
    expect(body({ workspaceRole: 'member', workspaceId: 'ws1', workspace: 'ws1' })).not.toContain('data-i18n="account.apiToken"');
  });

  it('is shown to workspace owners/admins and in a personal account', () => {
    expect(body({ workspaceRole: 'admin', workspaceId: 'ws1', workspace: 'ws1' })).toContain('data-i18n="account.apiToken"');
    expect(body({})).toContain('data-i18n="account.apiToken"');
  });
});
