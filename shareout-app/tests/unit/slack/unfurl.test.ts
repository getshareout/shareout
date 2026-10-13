// Slack link previews must never leak a closed artifact to a Slack team that is not
// connected to the artifact's ShareOut workspace.
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { encryptCredentials } from '../../../src/data/connections/credentials';
import {
  handleLinkShared,
  parseArtifactLink,
  unfurlLevel,
  type PreviewRow,
} from '../../../src/chat-platforms/slack/unfurl';

const getUserRole = vi.hoisted(() => vi.fn(async () => null as string | null));
const getLinkedUserId = vi.hoisted(() => vi.fn(async () => null as string | null));
vi.mock('../../../src/artifacts/roles', () => ({ getUserRole }));
vi.mock('../../../src/chat-platforms/slack/linking', () => ({ getLinkedUserId }));

const KEY = 'test-credentials-key-32bytes!!';
const e = { ...(env as unknown as Env), CREDENTIALS_KEY: KEY, SHAREOUT_BASE_URL: 'https://shareout.test' } as Env;

const TABLES = [
  `CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT, name TEXT, locale TEXT)`,
  `CREATE TABLE workspaces (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, subdomain_enabled INTEGER DEFAULT 0, locale TEXT)`,
  `CREATE TABLE artifacts (id TEXT PRIMARY KEY, name TEXT, display_slug TEXT, description TEXT, owner_id TEXT, workspace_id TEXT, paused INTEGER DEFAULT 0, visibility TEXT, deleted_at TEXT)`,
  `CREATE TABLE deployments (id TEXT PRIMARY KEY, artifact_id TEXT, version_id TEXT, channel TEXT, slug TEXT, updated_at TEXT)`,
  `CREATE TABLE artifact_presentation (artifact_id TEXT PRIMARY KEY, social_title TEXT, social_description TEXT, social_image_url TEXT, thumbnail_ext TEXT)`,
  `CREATE TABLE artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'approved')`,
  `CREATE TABLE connections (id TEXT PRIMARY KEY, scope_type TEXT, scope_id TEXT, name TEXT, provider TEXT, encrypted_credentials TEXT, iv TEXT)`,
];

beforeAll(async () => {
  for (const t of ['users', 'workspaces', 'artifacts', 'deployments', 'artifact_presentation', 'artifact_moderation', 'connections']) {
    await e.DB.exec(`DROP TABLE IF EXISTS ${t}`);
  }
  for (const sql of TABLES) await e.DB.exec(sql);
});

async function addSlackConnection(id: string, workspaceId: string, teamId: string) {
  const { encrypted, iv } = await encryptCredentials({ access_token: `xoxb-${teamId}`, extra: { team_id: teamId } }, KEY);
  await e.DB.prepare(
    `INSERT INTO connections (id, scope_type, scope_id, name, provider, encrypted_credentials, iv)
     VALUES (?, 'workspace', ?, 'slack', 'slack', ?, ?)`
  ).bind(id, workspaceId, encrypted, iv).run();
}

async function addArtifact(id: string, slug: string, visibility: string, opts: { social?: string } = {}) {
  await e.DB.prepare(
    `INSERT INTO artifacts (id, name, display_slug, description, owner_id, workspace_id, visibility)
     VALUES (?, ?, ?, 'Secret Q3 revenue summary', 'usr_owner', 'ws_acme', ?)`
  ).bind(id, `Board report ${id}`, slug, visibility).run();
  await e.DB.prepare(
    `INSERT INTO deployments (id, artifact_id, version_id, channel, slug, updated_at)
     VALUES (?, ?, 'v1', 'production', ?, '2026-10-01T12:00:00Z')`
  ).bind(`dep_${id}`, id, `dep-${slug}`).run();
  if (opts.social) {
    await e.DB.prepare(`INSERT INTO artifact_presentation (artifact_id, social_title) VALUES (?, ?)`).bind(id, opts.social).run();
  }
}

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(async () => {
  for (const t of ['users', 'workspaces', 'artifacts', 'deployments', 'artifact_presentation', 'artifact_moderation', 'connections']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.DB.exec(`INSERT INTO users (id, email, name) VALUES ('usr_owner', 'owner@example.com', 'Dana Owner')`);
  await e.DB.exec(`INSERT INTO workspaces (id, name, slug, owner_id) VALUES ('ws_acme', 'Acme', 'acme', 'usr_owner'), ('ws_other', 'Other', 'other', 'usr_owner')`);
  await addSlackConnection('conn_1', 'ws_acme', 'T_CONNECTED');
  await addSlackConnection('conn_2', 'ws_other', 'T_STRANGER');
  getUserRole.mockReset().mockResolvedValue(null);
  getLinkedUserId.mockReset().mockResolvedValue(null);
  fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json({ ok: true }));
});

afterEach(() => vi.restoreAllMocks());

function linkShared(teamId: string, url: string, extra: Record<string, unknown> = {}) {
  return {
    type: 'event_callback',
    team_id: teamId,
    ...extra,
    event: { type: 'link_shared', channel: 'C1', user: 'U1', message_ts: '123.456', links: [{ domain: 'shareout.test', url }] },
  };
}

function unfurlCalls() {
  return fetchSpy.mock.calls
    .filter(([url]) => String(url).endsWith('/chat.unfurl'))
    .map(([, init]) => ({ auth: (init as RequestInit).headers, body: JSON.parse(String((init as RequestInit).body)) }));
}

describe('parseArtifactLink', () => {
  it('recognizes apex, namespaced and subdomain artifact URLs only', () => {
    expect(parseArtifactLink(e, 'https://shareout.test/a/dep-abc/')).toEqual({ deploySlug: 'dep-abc' });
    expect(parseArtifactLink(e, 'https://shareout.test/@acme/finance/board/')).toEqual({ workspaceSlug: 'acme', displaySlug: 'board' });
    expect(parseArtifactLink(e, 'https://acme.shareout.test/board/')).toEqual({ workspaceSlug: 'acme', displaySlug: 'board' });
    expect(parseArtifactLink(e, 'https://acme.shareout.test/a/dep-abc/')).toEqual({ deploySlug: 'dep-abc' });
    expect(parseArtifactLink(e, 'https://evil.example/a/dep-abc/')).toBeNull();
    expect(parseArtifactLink(e, 'https://shareout.test/home')).toBeNull();
  });
});

describe('unfurlLevel', () => {
  const row = (visibility: string) => ({ visibility, paused: 0, moderation_status: 'approved' }) as PreviewRow;
  it('gives full content only to a connected, non-externally-shared team', () => {
    expect(unfurlLevel(row('workspace'), { teamConnected: true, extShared: false, sharerCanView: false })).toBe('full');
    expect(unfurlLevel(row('workspace'), { teamConnected: false, extShared: false, sharerCanView: true })).toBe('none');
    expect(unfurlLevel(row('workspace'), { teamConnected: true, extShared: true, sharerCanView: true })).toBe('none');
    expect(unfurlLevel(row('private'), { teamConnected: true, extShared: false, sharerCanView: false })).toBe('none');
    expect(unfurlLevel(row('private'), { teamConnected: true, extShared: false, sharerCanView: true })).toBe('full');
    expect(unfurlLevel(row('public'), { teamConnected: false, extShared: false, sharerCanView: false })).toBe('public');
    expect(unfurlLevel({ ...row('public'), moderation_status: 'pending' }, { teamConnected: false, extShared: false, sharerCanView: false })).toBe('none');
  });
});

describe('handleLinkShared', () => {
  it('unfurls a workspace artifact with title, TL;DR and owner for the connected Slack team', async () => {
    await addArtifact('art_ws', 'board', 'workspace');
    await handleLinkShared(e, linkShared('T_CONNECTED', 'https://acme.shareout.test/board/'));

    const calls = unfurlCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toMatchObject({ Authorization: 'Bearer xoxb-T_CONNECTED' });
    const text = JSON.stringify(calls[0].body);
    expect(calls[0].body).toMatchObject({ channel: 'C1', ts: '123.456' });
    expect(text).toContain('Board report art_ws');
    expect(text).toContain('Secret Q3 revenue summary');
    expect(text).toContain('Dana Owner');
  });

  it('does not unfurl a workspace artifact for a Slack team connected to a different workspace', async () => {
    await addArtifact('art_ws', 'board', 'workspace');
    await handleLinkShared(e, linkShared('T_STRANGER', 'https://shareout.test/@acme/board/'));
    await handleLinkShared(e, linkShared('T_UNKNOWN', 'https://shareout.test/a/dep-board/'));

    expect(unfurlCalls()).toHaveLength(0);
    const sent = fetchSpy.mock.calls.map(([, init]) => String((init as RequestInit | undefined)?.body ?? '')).join('');
    expect(sent).not.toContain('Secret Q3');
    expect(sent).not.toContain('Board report');
  });

  it('does not unfurl a closed artifact into a Slack Connect channel', async () => {
    await addArtifact('art_ws', 'board', 'workspace');
    await handleLinkShared(e, linkShared('T_CONNECTED', 'https://acme.shareout.test/board/', { is_ext_shared_channel: true }));
    expect(unfurlCalls()).toHaveLength(0);
  });

  it('unfurls a private artifact only when the sharer can open it', async () => {
    await addArtifact('art_priv', 'secret', 'private');
    await handleLinkShared(e, linkShared('T_CONNECTED', 'https://acme.shareout.test/secret/'));
    expect(unfurlCalls()).toHaveLength(0);

    getLinkedUserId.mockResolvedValue('usr_owner');
    getUserRole.mockResolvedValue('owner');
    await handleLinkShared(e, linkShared('T_CONNECTED', 'https://acme.shareout.test/secret/'));
    expect(unfurlCalls()).toHaveLength(1);
  });

  it('gives an unconnected team only the public OG fields of a public artifact', async () => {
    await addArtifact('art_pub', 'launch', 'public', { social: 'Launch notes' });
    await handleLinkShared(e, linkShared('T_STRANGER', 'https://acme.shareout.test/launch/'));

    const calls = unfurlCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0].auth).toMatchObject({ Authorization: 'Bearer xoxb-T_STRANGER' });
    const text = JSON.stringify(calls[0].body);
    expect(text).toContain('Launch notes');
    expect(text).not.toContain('Dana Owner');
  });
});
