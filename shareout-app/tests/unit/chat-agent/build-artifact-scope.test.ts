import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const publishGeneratedHtml = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
const generateArtifactHtml = vi.hoisted(() => vi.fn());
const checkRateLimit = vi.hoisted(() => vi.fn());
const incrementRateLimit = vi.hoisted(() => vi.fn());
const checkStorageQuota = vi.hoisted(() => vi.fn());

vi.mock('../../../src/data/agent/build-page', async (importOriginal) => ({ ...(await importOriginal<object>()), generateArtifactHtml }));
vi.mock('../../../src/publish/publish-generated-html', () => ({ publishGeneratedHtml }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));
vi.mock('../../../src/api-auth', () => ({ checkRateLimit, incrementRateLimit, RATE_LIMIT_MAX: 100 }));
vi.mock('../../../src/quota', () => ({ checkStorageQuota }));

import { executeBuildArtifact } from '../../../src/chat-agent/actions';
import { BuildTruncatedError } from '../../../src/data/agent/build-page';

const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ email: 'me@example.com' }) }) }) },
} as unknown as Env;

beforeEach(() => {
  publishGeneratedHtml.mockReset().mockResolvedValue({
    artifact: { id: 'art_1' }, deployment: { url: 'https://x/a/p/', slug: 'p' },
  });
  getInternalWorkspaceRole.mockReset();
  generateArtifactHtml.mockReset().mockResolvedValue('<!doctype html><h1>A generated page</h1>');
  checkRateLimit.mockReset().mockResolvedValue({ allowed: true, remaining: 99, reset: 0 });
  incrementRateLimit.mockReset().mockResolvedValue(undefined);
  checkStorageQuota.mockReset().mockResolvedValue({ allowed: true, used: 0, incoming: 0, max: 0 });
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

describe('executeBuildArtifact — same daily publish cap and storage quota as POST /v1/publish', () => {
  const build = { kind: 'build_artifact' as const, name: 'P', prompt: 'p' };

  it('counts a successful chat build against the daily publish limit', async () => {
    await executeBuildArtifact(env, 'u1', build);
    expect(checkRateLimit).toHaveBeenCalledWith(env, 'u1', 'publish', 'me@example.com');
    expect(incrementRateLimit).toHaveBeenCalledOnce();
    expect(incrementRateLimit).toHaveBeenCalledWith(env, 'u1', 'publish', 'me@example.com');
  });

  it('refuses past the daily publish limit before generating, with the limit and reset', async () => {
    checkRateLimit.mockResolvedValue({ allowed: false, remaining: 0, reset: Math.floor(Date.UTC(2030, 0, 2) / 1000) });
    const r = await executeBuildArtifact(env, 'u1', build);
    expect(r.text).toMatch(/Daily publish limit reached \(100 per day\)/);
    expect(r.url).toBeUndefined();
    expect(generateArtifactHtml).not.toHaveBeenCalled();
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
    expect(incrementRateLimit).not.toHaveBeenCalled();
  });

  it('refuses a build over the storage quota without publishing', async () => {
    checkStorageQuota.mockResolvedValue({ allowed: false, used: 50_000_000, incoming: 10, max: 50_000_000 });
    const r = await executeBuildArtifact(env, 'u1', build);
    expect(r.text).toMatch(/Storage limit reached: 50 MB of 50 MB/);
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
    expect(incrementRateLimit).not.toHaveBeenCalled();
  });

  it('never publishes a page the builder could not finish, and says why', async () => {
    generateArtifactHtml.mockRejectedValue(new BuildTruncatedError());
    const r = await executeBuildArtifact(env, 'u1', build);
    expect(r.text).toMatch(/too long to finish/);
    expect(r.url).toBeUndefined();
    expect(publishGeneratedHtml).not.toHaveBeenCalled();
    expect(incrementRateLimit).not.toHaveBeenCalled();
  });
});
