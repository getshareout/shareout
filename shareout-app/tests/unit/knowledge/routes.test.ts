import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../../src/types';

// Auth collaborators behind requireTokenOrSession + the workspace role gate.
const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
const getAIProvider = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth', () => ({ getSessionUser }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));
vi.mock('../../../src/data/agent/anthropic', () => ({ getAIProvider, chatComplete: vi.fn() }));

import { routeKnowledgeApi } from '../../../src/router/api/knowledge';
import { createFetchContext } from '../../../src/router/context';
import { setKnowledgeEnabled, upsertKnowledgeFile, listKnowledgeFiles, isTombstoned } from '../../../src/knowledge';

const e = env as unknown as Env;
const WS = 'wsp_kn_routes';
const BASE = `https://shareout.site/v1/workspaces/${WS}/knowledge`;

function req(method: string, sub = '', body?: string) {
  return new Request(BASE + sub, {
    method,
    headers: { Cookie: 'shareout_session=x', 'Content-Type': 'text/markdown' },
    body,
  });
}
const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const call = (method: string, sub = '', body?: string) =>
  routeKnowledgeApi(createFetchContext(req(method, sub, body), e, execCtx));

const NODE = `---
kind: topic
id: topic.retention
title: Retention
topics: [retention]
pinned: false
---
Retention overview.`;

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`,
    `CREATE TABLE IF NOT EXISTS knowledge_ingest (workspace_id TEXT NOT NULL, artifact_id TEXT NOT NULL, content_hash TEXT, reason TEXT NOT NULL, queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT, PRIMARY KEY (workspace_id, artifact_id, reason))`,
    `CREATE TABLE IF NOT EXISTS knowledge_tombstones (workspace_id TEXT NOT NULL, path TEXT NOT NULL, forgotten_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (workspace_id, path))`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, workspace_id TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT NOT NULL, version_id TEXT, channel TEXT NOT NULL)`,
  ]) {
    await e.DB.exec(sql);
  }
});

beforeEach(async () => {
  validateToken.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: 'u1', email: 'me@example.com' });
  getInternalWorkspaceRole.mockReset().mockResolvedValue('admin');
  getAIProvider.mockReset().mockReturnValue({ model: 'test' });
  for (const t of ['knowledge_settings', 'workspace_files', 'knowledge_ingest', 'knowledge_tombstones', 'artifacts', 'deployments']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
});

afterEach(() => vi.restoreAllMocks());

describe('knowledge routes', () => {
  it('enable requires owner/admin', async () => {
    getInternalWorkspaceRole.mockResolvedValue('member');
    const denied = await call('POST', '/enable', JSON.stringify({ enabled: true }));
    expect(denied?.status).toBe(403);

    getInternalWorkspaceRole.mockResolvedValue('admin');
    const ok = await call('POST', '/enable', JSON.stringify({ enabled: true }));
    expect(ok?.status).toBe(200);
    expect(await ok!.json()).toEqual({ enabled: true });
  });

  // Knowledge used to require a paid tier. Every account on a self-hosted instance
  // reads as free, so the feature was unreachable there — role is the only gate now.
  it('enable and disable are role-gated only', async () => {
    const on = await call('POST', '/enable', JSON.stringify({ enabled: true }));
    expect(on?.status).toBe(200);
    expect(await on!.json()).toEqual({ enabled: true });

    const off = await call('POST', '/enable', JSON.stringify({ enabled: false }));
    expect(off?.status).toBe(200);
    expect(await off!.json()).toEqual({ enabled: false });
  });

  it('tree lists node summaries grouped by kind (member)', async () => {
    getInternalWorkspaceRole.mockResolvedValue('member');
    await setKnowledgeEnabled(e, WS, true);
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: NODE });
    const res = await call('GET', '/tree');
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as {
      groups: Record<string, { id: string; sourcesCount: number }[]>;
      count: number;
    };
    expect(body.count).toBe(1);
    expect(body.groups.topic[0].id).toBe('topic.retention');
    expect(body.groups.topic[0].sourcesCount).toBe(0);
  });

  it('files GET 404s when knowledge is disabled', async () => {
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: NODE });
    const res = await call('GET', '/files/topics/retention.md');
    expect(res?.status).toBe(404);
  });

  it('backfill queues ingest rows for recent live artifacts (admin)', async () => {
    for (const id of ['art_a', 'art_b']) {
      await e.DB.prepare('INSERT INTO artifacts (id, name, slug, workspace_id) VALUES (?, ?, ?, ?)')
        .bind(id, id, id, WS)
        .run();
      await e.DB.prepare("INSERT INTO deployments (artifact_id, version_id, channel) VALUES (?, ?, 'production')")
        .bind(id, `ver_${id}`)
        .run();
    }
    const res = await call('POST', '/backfill');
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ queued: 2, kicked: true });
    const rows = await e.DB.prepare("SELECT COUNT(*) AS n FROM knowledge_ingest WHERE reason = 'backfill'").first<{ n: number }>();
    expect(rows?.n).toBe(2);
  });

  it('backfill reports kicked=false when no AI provider is configured', async () => {
    getAIProvider.mockReturnValue(null);
    const res = await call('POST', '/backfill');
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ queued: 0, kicked: false });
  });

  it('status reports counts over a 24h window (older rows excluded)', async () => {
    await setKnowledgeEnabled(e, WS, true);
    const ins = async (id: string, reason: string, processed: boolean, queuedAtSql: string) =>
      e.DB.prepare(
        `INSERT INTO knowledge_ingest (workspace_id, artifact_id, reason, processed_at, queued_at)
         VALUES (?, ?, ?, ${processed ? "datetime('now')" : 'NULL'}, ${queuedAtSql})`
      ).bind(WS, id, reason).run();
    await ins('a1', 'publish', false, "datetime('now')");
    await ins('a2', 'backfill', false, "datetime('now')");
    await ins('a3', 'publish', true, "datetime('now')");
    // Queued 2 days ago — outside the window, must not inflate the bar.
    await ins('a_old', 'publish', true, "datetime('now','-2 day')");

    const res = await call('GET', '/status');
    expect(res?.status).toBe(200);
    const body = (await res!.json()) as {
      enabled: boolean; queued: number; processed: number; total: number; running: boolean; lastProcessedAt: string | null;
    };
    expect(body.enabled).toBe(true);
    expect(body.queued).toBe(2);
    expect(body.processed).toBe(1);
    expect(body.total).toBe(3);
    expect(body.running).toBe(true);
    expect(body.lastProcessedAt).toBeTruthy();
  });

  it('status returns the disabled shape when knowledge is off', async () => {
    const res = await call('GET', '/status');
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({
      enabled: false, queued: 0, processed: 0, total: 0, running: false, lastProcessedAt: null,
    });
  });

  it('PUT writes a manual node (member, human edit wins)', async () => {
    getInternalWorkspaceRole.mockResolvedValue('member');
    await setKnowledgeEnabled(e, WS, true);
    const res = await call('PUT', '/files/topics/retention.md', NODE);
    expect(res?.status).toBe(200);
    const files = await listKnowledgeFiles(e, WS);
    expect(files.find(f => f.path === 'topics/retention.md')?.source).toBe('manual');
  });

  it('DELETE with ?forget=1 tombstones the node (admin)', async () => {
    await setKnowledgeEnabled(e, WS, true);
    await upsertKnowledgeFile(e, WS, { path: 'topics/retention.md', content: NODE });
    const res = await call('DELETE', '/files/topics/retention.md?forget=1');
    expect(res?.status).toBe(200);
    expect(await res!.json()).toEqual({ ok: true, forgotten: true });
    expect(await isTombstoned(e, WS, 'topics/retention.md')).toBe(true);
  });
});
