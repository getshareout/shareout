import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const publishGeneratedHtml = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());

vi.mock('../../../src/data/agent/build-page', () => ({ generateArtifactHtml: vi.fn(async () => '<!doctype html><h1>A generated page</h1>') }));
vi.mock('../../../src/publish/publish-generated-html', () => ({ publishGeneratedHtml }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));

import { executeBuildArtifact } from '../../../src/chat-agent/actions';

const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ email: 'me@example.com' }) }) }) },
} as unknown as Env;

beforeEach(() => {
  publishGeneratedHtml.mockReset().mockResolvedValue({
    artifact: { id: 'art_1' }, deployment: { url: 'https://x/a/p/', slug: 'p' },
  });
  getInternalWorkspaceRole.mockReset();
});

describe('executeBuildArtifact — chat builds default to private, in the chat\'s workspace', () => {
  it('publishes private into the workspace the user is chatting in', async () => {
    getInternalWorkspaceRole.mockResolvedValue('member');
    await executeBuildArtifact(env, 'u1', { kind: 'build_artifact', name: 'P', prompt: 'p', workspace_id: 'wsp_1' });
    expect(publishGeneratedHtml.mock.calls[0][2]).toMatchObject({ workspaceId: 'wsp_1', visibility: 'private' });
  });

  it('falls back to personal when not a member of that workspace', async () => {
    getInternalWorkspaceRole.mockResolvedValue(null);
    await executeBuildArtifact(env, 'u1', { kind: 'build_artifact', name: 'P', prompt: 'p', workspace_id: 'wsp_1' });
    expect(publishGeneratedHtml.mock.calls[0][2]).toMatchObject({ workspaceId: null, visibility: 'private' });
  });

  it('personal chat builds stay personal and private', async () => {
    await executeBuildArtifact(env, 'u1', { kind: 'build_artifact', name: 'P', prompt: 'p' });
    expect(publishGeneratedHtml.mock.calls[0][2]).toMatchObject({ workspaceId: null, visibility: 'private' });
    expect(getInternalWorkspaceRole).not.toHaveBeenCalled();
  });
});
