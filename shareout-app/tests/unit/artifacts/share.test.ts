// P0 robustness: artifact share email path — not found, JSON, emails, role, rate limit.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

vi.mock('../../../src/email/gateway', () => ({
  dispatchLifecycleEmail: vi.fn().mockResolvedValue({ sent: true }),
}));

vi.mock('../../../src/scheduling/email', () => ({
  checkEmailRateLimit: vi.fn().mockResolvedValue({ allowed: true, remaining: 10, resetAt: null }),
  incrementEmailCount: vi.fn().mockResolvedValue(undefined),
}));

import { handleShareArtifact } from '../../../src/artifacts/share';
import { checkEmailRateLimit } from '../../../src/scheduling/email';
import { dispatchLifecycleEmail } from '../../../src/email/gateway';

const e = env as unknown as Env;
const owner: AuthUser = { id: 'usr_owner', email: 'owner@x.com', username: null };
const stranger: AuthUser = { id: 'usr_stranger', email: 'stranger@x.com', username: null };

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, username TEXT, name TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, description TEXT, slug TEXT, display_slug TEXT, auth_method TEXT, owner_id TEXT, workspace_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT, channel TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS collaborators (artifact_id TEXT, email TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT)`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  for (const t of ['workspace_members', 'collaborators', 'deployments', 'artifacts', 'workspaces', 'users']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  vi.mocked(checkEmailRateLimit).mockResolvedValue({ allowed: true, remaining: 10, resetAt: null } as never);
  vi.mocked(dispatchLifecycleEmail).mockResolvedValue({ sent: true } as never);

  await e.DB.exec(`INSERT INTO users (id, email, username) VALUES ('usr_owner','owner@x.com','Owner')`);
  await e.DB.exec(`INSERT INTO workspaces (id, slug) VALUES ('ws1','acme')`);
  await e.DB.exec(`INSERT INTO artifacts (id, name, description, slug, display_slug, auth_method, owner_id, workspace_id) VALUES ('art1','Demo','d','art1-slug','demo','none','usr_owner','ws1')`);
  await e.DB.exec(`INSERT INTO deployments (artifact_id, channel, slug) VALUES ('art1','production','art1-prod')`);
});

function req(body: unknown) {
  return new Request('https://shareout.site/v1/artifacts/art1/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

describe('handleShareArtifact', () => {
  it('404s unknown artifacts', async () => {
    const res = await handleShareArtifact(req({ recipients: ['a@b.com'] }), e, owner, 'missing');
    expect(res.status).toBe(404);
  });

  it('400s invalid JSON and empty recipients', async () => {
    expect((await handleShareArtifact(req('nope'), e, owner, 'art1')).status).toBe(400);
    const res = await handleShareArtifact(req({ recipients: ['not-email'] }), e, owner, 'art1');
    expect(res.status).toBe(400);
    expect((await res.json() as { code: string }).code).toBe('INVALID_EMAILS');
  });

  it('403s non-collaborators', async () => {
    const res = await handleShareArtifact(req({ recipients: ['a@b.com'], role: 'viewer' }), e, stranger, 'art1');
    expect(res.status).toBe(403);
  });

  it('sends share emails for the owner (notify-only role=none)', async () => {
    (e as Env & { SHAREOUT_BASE_URL?: string }).SHAREOUT_BASE_URL = 'https://shareout.site';
    // role=none: email only, no collaborator grant — still needs viewer-level access (owner has it)
    const res = await handleShareArtifact(
      req({ recipients: ['peer@x.com'], role: 'none', message: 'hi' }),
      e,
      owner,
      'art1',
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { success: boolean; sent: string[]; role: string };
    expect(body.success).toBe(true);
    expect(body.sent).toEqual(['peer@x.com']);
    expect(body.role).toBe('none');
    expect(dispatchLifecycleEmail).toHaveBeenCalledWith(e, expect.objectContaining({
      type: 'artifact_share',
      toEmail: 'peer@x.com',
    }));
  });

  it('429s when daily email limit is hit', async () => {
    vi.mocked(checkEmailRateLimit).mockResolvedValueOnce({
      allowed: false, remaining: 0, resetAt: 'tomorrow',
    } as never);
    const res = await handleShareArtifact(req({ recipients: ['a@b.com'] }), e, owner, 'art1');
    expect(res.status).toBe(429);
    expect((await res.json() as { code: string }).code).toBe('RATE_LIMITED');
  });
});
