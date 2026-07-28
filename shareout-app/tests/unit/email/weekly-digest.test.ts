import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';

// Gateway + LLM + usage ledger are the collaborators; the DB gathering + email_log
// idempotency run for real against Miniflare D1.
const { dispatchLifecycleEmail } = vi.hoisted(() => ({ dispatchLifecycleEmail: vi.fn() }));
const { chatComplete, getAIProvider } = vi.hoisted(() => ({ chatComplete: vi.fn(), getAIProvider: vi.fn() }));
vi.mock('../../../src/email/gateway', () => ({ dispatchLifecycleEmail }));
vi.mock('../../../src/data/agent/anthropic', () => ({ chatComplete, getAIProvider }));
vi.mock('../../../src/data/ai-usage', () => ({ recordAiUsage: vi.fn(async () => {}) }));

import { gatherWorkspaceDigest, runWeeklyWorkspaceDigest } from '../../../src/email/weekly-digest';
import { EMAILS } from '../../../src/email/catalog';
import type { WorkspaceDigestData } from '../../../src/email/catalog';

const e = env as unknown as Env;
const WS = 'wsp_wd';
const WEEK = '2026-07-06';

beforeAll(async () => {
  const ddl = [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, disabled INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT, owner_id TEXT, slug TEXT)`,
    `CREATE TABLE IF NOT EXISTS workspace_members (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, role TEXT, member_class TEXT NOT NULL DEFAULT 'internal')`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, workspace_id TEXT, name TEXT, description TEXT, slug TEXT, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS deployments (id TEXT PRIMARY KEY, artifact_id TEXT, channel TEXT, slug TEXT, updated_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_comments (id TEXT PRIMARY KEY, artifact_id TEXT, resolved INTEGER DEFAULT 0, created_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS analytics_daily (artifact_id TEXT, date TEXT, views INTEGER)`,
    `CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, recipient_type TEXT NOT NULL, recipient_id TEXT NOT NULL, kind TEXT NOT NULL, subject_type TEXT, subject_id TEXT, message TEXT, payload TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
    `CREATE TABLE IF NOT EXISTS email_log (type TEXT NOT NULL, key TEXT NOT NULL, sent_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (type, key))`,
  ];
  for (const sql of ddl) await e.DB.exec(sql);
});

async function reset() {
  for (const t of ['users', 'workspaces', 'workspace_members', 'artifacts', 'deployments', 'artifact_comments', 'analytics_daily', 'notifications', 'email_log']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
}

// One active workspace: member u1 + a page published this week with an auto-description.
async function seedActive() {
  await e.DB.exec(`INSERT INTO users (id, email) VALUES ('u1', 'u1@example.com'), ('u2', 'u2@example.com')`);
  await e.DB.exec(`INSERT INTO workspaces (id, name) VALUES ('${WS}', 'Ops')`);
  await e.DB.exec(`INSERT INTO workspace_members (id, workspace_id, user_id, role) VALUES ('m1', '${WS}', 'u1', 'owner'), ('m2', '${WS}', 'u2', 'member')`);
  await e.DB.exec(`INSERT INTO artifacts (id, workspace_id, name, description, slug) VALUES ('art1', '${WS}', 'Sales recap', 'Weekly numbers', 'sales-recap')`);
  await e.DB.exec(`INSERT INTO deployments (id, artifact_id, channel, slug, updated_at) VALUES ('d1', 'art1', 'production', 'sales-recap', datetime('now'))`);
}

beforeEach(async () => {
  vi.clearAllMocks();
  dispatchLifecycleEmail.mockResolvedValue({ sent: true });
  getAIProvider.mockReturnValue({ provider: 'openai', model: 'gpt', apiKey: 'k', baseUrl: 'x' });
  chatComplete.mockResolvedValue('A steady week in Ops.');
  await reset();
});

describe('gatherWorkspaceDigest', () => {
  it('returns null for a dead workspace (no activity)', async () => {
    await e.DB.exec(`INSERT INTO workspaces (id, name) VALUES ('${WS}', 'Ops')`);
    expect(await gatherWorkspaceDigest(e, WS, 'Ops')).toBeNull();
  });

  it('collects published pages with links', async () => {
    await seedActive();
    const d = await gatherWorkspaceDigest(e, WS, 'Ops');
    expect(d).not.toBeNull();
    expect(d!.updated).toHaveLength(1);
    expect(d!.updated[0]).toMatchObject({ name: 'Sales recap', description: 'Weekly numbers' });
    const base = (e.SHAREOUT_BASE_URL || 'https://shareout.site').replace(/\/$/, '');
    expect(d!.updated[0].url).toBe(`${base}/a/sales-recap/`);
  });
});

describe('workspace_weekly_digest catalog build', () => {
  it('renders sections as lists with artifact links', () => {
    const data: WorkspaceDigestData = {
      workspaceName: 'Ops',
      homeUrl: 'https://shareout.site/home',
      narrative: 'A steady week.',
      updated: [{ name: 'Sales recap', description: 'Weekly numbers', url: 'https://shareout.site/a/sales-recap/' }],
      topViewed: [{ name: 'Sales recap', url: 'https://shareout.site/a/sales-recap/', views: 12 }],
      openComments: 2,
      staleData: [{ name: 'Inventory', url: 'https://shareout.site/a/inv/' }],
    };
    const built = EMAILS.workspace_weekly_digest.build!(data, { env: e, baseUrl: 'https://shareout.site' });
    expect(built.subject).toBe('Your week in Ops');
    expect(built.bodyHtml).toContain('A steady week.');
    expect(built.bodyHtml).toContain('href="https://shareout.site/a/sales-recap/"');
    expect(built.bodyHtml).toContain('12 views');
    expect(built.bodyHtml).toContain('<strong>2</strong> open comments');
    expect(built.bodyHtml).toContain('href="https://shareout.site/a/inv/"');
    expect(built.cta).toEqual({ label: 'Open your workspace', href: 'https://shareout.site/home' });
  });
});

describe('runWeeklyWorkspaceDigest', () => {
  it('sends nothing for an empty week', async () => {
    await runWeeklyWorkspaceDigest(e, WEEK);
    expect(dispatchLifecycleEmail).not.toHaveBeenCalled();
  });

  it('dispatches through the gateway to every internal member', async () => {
    await seedActive();
    await runWeeklyWorkspaceDigest(e, WEEK);
    expect(dispatchLifecycleEmail).toHaveBeenCalledTimes(2);
    const types = dispatchLifecycleEmail.mock.calls.map((c) => c[1].type);
    expect(types).toEqual(['workspace_weekly_digest', 'workspace_weekly_digest']);
    const data = dispatchLifecycleEmail.mock.calls[0][1].data as WorkspaceDigestData;
    expect(data.narrative).toBe('A steady week in Ops.');
  });

  it('never double-sends on a re-run for the same week', async () => {
    await seedActive();
    await runWeeklyWorkspaceDigest(e, WEEK);
    dispatchLifecycleEmail.mockClear();
    await runWeeklyWorkspaceDigest(e, WEEK);
    expect(dispatchLifecycleEmail).not.toHaveBeenCalled();
  });

  it('still sends (without a narrative) when the LLM fails', async () => {
    await seedActive();
    chatComplete.mockRejectedValue(new Error('llm down'));
    await runWeeklyWorkspaceDigest(e, WEEK);
    expect(dispatchLifecycleEmail).toHaveBeenCalledTimes(2);
    const data = dispatchLifecycleEmail.mock.calls[0][1].data as WorkspaceDigestData;
    expect(data.narrative).toBeUndefined();
  });
});
