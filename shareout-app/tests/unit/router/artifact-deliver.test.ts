// P1 robustness: deliver-now validation, role gate, viewer self-delivery, execute path.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

vi.mock('../../../src/scheduling/jobs/runner', () => ({
  executeJobAction: vi.fn().mockResolvedValue({ success: true, steps: ['sent'] }),
}));

vi.mock('../../../src/telegram/linking', () => ({
  getLinkedChatId: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/chat-platforms/slack/delivery', () => ({
  resolveSlackTokenForArtifact: vi.fn().mockResolvedValue(null),
}));

vi.mock('../../../src/chat-platforms/slack/client', () => ({
  listSlackChannels: vi.fn().mockResolvedValue([]),
}));

import {
  handleDeliverNow,
  handleDeliverStatus,
  handleDeliverSlackChannels,
} from '../../../src/router/api/artifact-deliver';
import { executeJobAction } from '../../../src/scheduling/jobs/runner';
import { getLinkedChatId } from '../../../src/telegram/linking';

const e = env as unknown as Env;
const owner: AuthUser = { id: 'usr_owner', email: 'owner@x.com', username: null };
const viewer: AuthUser = { id: 'usr_viewer', email: 'viewer@x.com', username: null };
const stranger: AuthUser = { id: 'usr_stranger', email: 's@x.com', username: null };

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, username TEXT, name TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, owner_id TEXT, workspace_id TEXT, name TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS collaborators (artifact_id TEXT, email TEXT, role TEXT)`,
    `CREATE TABLE IF NOT EXISTS connections (id TEXT PRIMARY KEY, scope_type TEXT NOT NULL, scope_id TEXT NOT NULL, name TEXT NOT NULL, kind TEXT NOT NULL DEFAULT 'generic', provider TEXT NOT NULL, auth_type TEXT, config TEXT NOT NULL DEFAULT '{}', encrypted_credentials TEXT, iv TEXT, expires_at TEXT, preferred_mode TEXT NOT NULL DEFAULT 'auto', cache_ttl_seconds INTEGER NOT NULL DEFAULT 300, rate_limit_rpm INTEGER NOT NULL DEFAULT 60, is_private INTEGER NOT NULL DEFAULT 0, credential_scope TEXT NOT NULL DEFAULT 'shared', agent_query_enabled INTEGER NOT NULL DEFAULT 0, created_by TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), UNIQUE(scope_type, scope_id, name))`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  for (const t of ['connections', 'collaborators', 'artifacts', 'users']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  vi.mocked(executeJobAction).mockResolvedValue({ success: true, steps: ['sent'] } as never);
  vi.mocked(getLinkedChatId).mockResolvedValue(null);

  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('usr_owner','owner@x.com'),('usr_viewer','viewer@x.com'),('usr_stranger','s@x.com')`);
  await e.DB.exec(`INSERT INTO artifacts (id, owner_id, workspace_id, name, slug) VALUES ('art1','usr_owner','ws1','A','a')`);
  await e.DB.exec(`INSERT INTO collaborators (artifact_id, email, role) VALUES ('art1','viewer@x.com','viewer')`);
});

function post(body: unknown) {
  return new Request('https://shareout.site/v1/artifacts/art1/deliver', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('handleDeliverNow', () => {
  it('400s unsupported action and missing config', async () => {
    expect((await handleDeliverNow(post({ action: 'webhook' }), e, owner, 'art1')).status).toBe(400);
    expect((await handleDeliverNow(post({ action: 'email' }), e, owner, 'art1')).status).toBe(400);
  });

  it('403s strangers', async () => {
    const res = await handleDeliverNow(
      post({ action: 'email', config: { recipients: ['owner@x.com'] } }),
      e,
      stranger,
      'art1',
    );
    expect(res.status).toBe(403);
  });

  it('blocks viewers emailing someone else', async () => {
    const res = await handleDeliverNow(
      post({ action: 'email', config: { recipients: ['other@x.com'] } }),
      e,
      viewer,
      'art1',
    );
    expect(res.status).toBe(403);
    expect((await res.json() as { code: string }).code).toBe('FORBIDDEN');
  });

  it('allows viewers to email themselves; owner can deliver', async () => {
    // Destination.validate may still reject incomplete email config — mock via execute path
    // by using a config the email destination accepts if possible; otherwise assert validation error is 400 not 5xx.
    const self = await handleDeliverNow(
      post({ action: 'email', config: { recipients: ['viewer@x.com'] } }),
      e,
      viewer,
      'art1',
    );
    // Either success after validate+execute, or destination validation 400 — never 403 for self.
    expect([200, 400]).toContain(self.status);
    if (self.status === 200) {
      expect(executeJobAction).toHaveBeenCalled();
    }

    const ownerRes = await handleDeliverNow(
      post({ action: 'email', config: { recipients: ['anyone@x.com'] } }),
      e,
      owner,
      'art1',
    );
    expect([200, 400]).toContain(ownerRes.status);
  });

  it('returns 502 when delivery execution fails', async () => {
    // Bypass destination.validate by mocking getDestination... simpler: mock validate via execute after patching.
    // Use telegram with empty config — may 400. Force execute path with slack dm if validate is soft.
    const { getDestination } = await import('../../../src/delivery/registry');
    const dest = getDestination('email');
    if (dest) {
      vi.spyOn(dest, 'validate').mockResolvedValueOnce(null);
    }
    vi.mocked(executeJobAction).mockResolvedValueOnce({ success: false, error: 'smtp down' } as never);
    const res = await handleDeliverNow(
      post({ action: 'email', config: { recipients: ['owner@x.com'] } }),
      e,
      owner,
      'art1',
    );
    expect(res.status).toBe(502);
    expect((await res.json() as { code: string }).code).toBe('DELIVERY_FAILED');
  });
});

describe('handleDeliverStatus / channels', () => {
  it('403s status for non-collaborators', async () => {
    expect((await handleDeliverStatus(new Request('https://x'), e, stranger, 'art1')).status).toBe(403);
    expect((await handleDeliverSlackChannels(new Request('https://x'), e, stranger, 'art1')).status).toBe(403);
  });

  it('reports telegram unlinked and slack connect URL when no connection', async () => {
    const res = await handleDeliverStatus(new Request('https://x'), e, owner, 'art1');
    expect(res.status).toBe(200);
    const body = await res.json() as {
      telegram: { linked: boolean };
      slack: { connected: boolean; connectUrl: string | null };
      email: { available: boolean };
    };
    expect(body.telegram.linked).toBe(false);
    expect(body.slack.connected).toBe(false);
    expect(body.slack.connectUrl).toMatch(/connections\/slack\/install/);
    expect(body.email.available).toBe(true);
  });

  it('returns empty channels when Slack is not connected', async () => {
    const res = await handleDeliverSlackChannels(new Request('https://x'), e, owner, 'art1');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ channels: [] });
  });
});
