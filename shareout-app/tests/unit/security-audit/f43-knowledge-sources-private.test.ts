import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../../src/types';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth/session', async (importOriginal) => ({ ...(await importOriginal<object>()), getSessionUser }));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));

import { queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { routeKnowledgeApi } from '../../../src/router/api/knowledge';
import { createFetchContext } from '../../../src/router/context';
import { setKnowledgeEnabled } from '../../../src/knowledge';

const e = env as unknown as Env;
const WS = `wsp_f43_${Date.now()}`;
const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, owner_id TEXT, visibility TEXT, workspace_id TEXT, deleted_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT)`,
    `CREATE TABLE IF NOT EXISTS knowledge_ingest (workspace_id TEXT NOT NULL, artifact_id TEXT NOT NULL, content_hash TEXT, reason TEXT NOT NULL, queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT, PRIMARY KEY (workspace_id, artifact_id, reason))`,
  ]) await e.DB.exec(sql);
  await setKnowledgeEnabled(e, WS, true);
  for (const [id, visibility] of [['dlv_f43_secret', 'private'], ['dlv_f43_shared', 'workspace']]) {
    const key = `f43/${id}`;
    await e.ARTIFACTS.put(key, `# ${id}\n\nbody text for ${id}`);
    await e.DB.prepare('INSERT INTO asset_deliverables (id, workspace_id, owner_id, name, visibility) VALUES (?, ?, ?, ?, ?)').bind(id, WS, 'owner_other', `${id}.md`, visibility).run();
    await e.DB.prepare('INSERT INTO blobs (id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, ?, ?, ?, ?, 1)').bind(`blob_${id}`, `${id}.md`, 'text/markdown', key, 20, id).run();
    await queueKnowledgeSource(e, undefined, { workspaceId: WS, kind: 'asset', refId: id }, `blob_${id}`);
  }
});

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: 'u_member', email: 'm@example.test' });
  getInternalWorkspaceRole.mockReset().mockResolvedValue('member');
});

describe('f43 GET /knowledge/sources', () => {
  it('blocks: a non-owner member does not see another member\'s private file', async () => {
    const res = await routeKnowledgeApi(createFetchContext(
      new Request(`https://shareout.site/v1/workspaces/${WS}/knowledge/sources`, { headers: { Cookie: 'shareout_session=x' } }), e, execCtx,
    ));
    expect(res!.status).toBe(200);
    const body = await res!.json() as { sources: { refId: string }[] };
    const ids = body.sources.map((s) => s.refId);
    expect(ids).toContain('dlv_f43_shared');
    expect(ids).not.toContain('dlv_f43_secret');
  });
});
