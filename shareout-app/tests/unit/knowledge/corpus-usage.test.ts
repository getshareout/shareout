import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from 'cloudflare:test';
import type { Env } from '../../../src/types';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionUser,
}));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));

import { corpusFor } from '../../../src/knowledge/corpus/client';
import { queueKnowledgeSource } from '../../../src/knowledge/corpus/ingest';
import { searchCorpus } from '../../../src/knowledge/corpus/search';
import { knowledgeUsage, PRICING } from '../../../src/knowledge/corpus/usage';
import { routeKnowledgeApi } from '../../../src/router/api/knowledge';
import { createFetchContext } from '../../../src/router/context';
import { setKnowledgeEnabled } from '../../../src/knowledge';

const base = env as unknown as Env;
let n = 0;
const nextWs = () => `wsp_usage_${++n}_${Date.now()}`;

// Workers AI + Vectorize stand-ins: every text embeds to the same vector, and the
// index remembers what was upserted per namespace.
function withEmbeddings(): Env {
  const index = new Map<string, { id: string; namespace?: string }[]>();
  const AI = { run: vi.fn(async (_m: string, { text }: { text: string[] }) => ({ data: text.map(() => [1, 0, 0]) })) };
  const KNOWLEDGE_VECTORS = {
    upsert: vi.fn(async (vs: { id: string; namespace?: string }[]) => {
      for (const v of vs) index.set(v.namespace ?? '', [...(index.get(v.namespace ?? '') ?? []).filter((x) => x.id !== v.id), v]);
    }),
    query: vi.fn(async (_v: number[], o: { namespace?: string }) => ({ matches: (index.get(o.namespace ?? '') ?? []).map((v) => ({ id: v.id, score: 1 })) })),
    deleteByIds: vi.fn(async () => ({})),
  };
  return { ...base, AI, KNOWLEDGE_VECTORS } as unknown as Env;
}

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL DEFAULT 'workspace', folder_id TEXT, deleted_at TEXT, type_metadata TEXT)`,
    `CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, filename TEXT NOT NULL, mime_type TEXT NOT NULL, r2_key TEXT NOT NULL, size_bytes INTEGER NOT NULL, deliverable_id TEXT, version_no INTEGER)`,
    `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT NOT NULL, model TEXT NOT NULL, units REAL NOT NULL DEFAULT 0, unit_kind TEXT NOT NULL, base_cost_micro_usd INTEGER NOT NULL DEFAULT 0, source TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  ]) {
    await base.DB.exec(sql);
  }
});

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: 'u1', email: 'me@example.com' });
  getInternalWorkspaceRole.mockReset().mockResolvedValue('admin');
});

async function putFile(e: Env, ws: string, id: string, text: string) {
  const blobId = `blob_${id}`;
  await e.ARTIFACTS.put(`test/${blobId}`, text);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO asset_deliverables (id, workspace_id, owner_id, name) VALUES (?, ?, 'u1', ?)").bind(id, ws, `${id}.md`),
    e.DB.prepare("INSERT INTO blobs (id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, 'text/markdown', ?, ?, ?, 1)")
      .bind(blobId, `${id}.md`, `test/${blobId}`, text.length, id),
  ]);
  await queueKnowledgeSource(e, undefined, { workspaceId: ws, kind: 'asset', refId: id }, blobId);
}

const ledger = async (ws: string) =>
  (await base.DB.prepare('SELECT kind, model, units, unit_kind, base_cost_micro_usd AS cost, user_id FROM ai_usage_events WHERE workspace_id = ? ORDER BY created_at')
    .bind(ws).all<{ kind: string; model: string; units: number; unit_kind: string; cost: number; user_id: string | null }>()).results;

describe('knowledge metering', () => {
  it('records ingest runs, keyword searches and the store’s own SQLite work', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(base, ws, true);
    await putFile(base, ws, 'dlv_k1', 'Budget for the spring campaign is 20k.');
    await searchCorpus(base, ws, 'u1', 'budget');

    expect(await ledger(ws)).toEqual([
      expect.objectContaining({ kind: 'knowledge_ingest', model: 'inline', unit_kind: 'runs' }),
      expect.objectContaining({ kind: 'knowledge_search', model: 'fts5', units: 1, cost: 0, user_id: 'u1' }),
    ]);
    const s = await corpusFor(base, ws)!.usage(30);
    expect(s).toMatchObject({ sources: 1, chunks: 1 });
    expect(s.rowsWritten).toBeGreaterThan(0);
    expect(s.bytes).toBeGreaterThan(0);
  });

  it('prices embeddings and semantic searches', async () => {
    const e = withEmbeddings();
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(e, ws, 'dlv_k2', 'x'.repeat(400));

    const embedding = (await ledger(ws)).find((r) => r.kind === 'knowledge_embedding')!;
    expect(embedding).toMatchObject({ model: '@cf/baai/bge-base-en-v1.5', unit_kind: 'tokens' });
    expect(embedding.units).toBeGreaterThanOrEqual(100);
    expect(embedding.cost).toBe(Math.round(embedding.units * PRICING.embedTokenMicroUsd));

    const r = await searchCorpus(e, ws, 'u1', 'something unrelated');
    expect(r.mode).toBe('hybrid');
    expect(r.hits[0].source.id).toBe('dlv_k2'); // found by meaning, not keywords
    const search = (await ledger(ws)).find((x) => x.kind === 'knowledge_search')!;
    expect(search.model).toBe('@cf/baai/bge-base-en-v1.5');
    expect(search.cost).toBeGreaterThan(0);
  });

  it('sums ledger, storage and vectors into one total', async () => {
    const e = withEmbeddings();
    const ws = nextWs();
    await setKnowledgeEnabled(e, ws, true);
    await putFile(e, ws, 'dlv_k3', 'Quarterly plan.');
    const u = await knowledgeUsage(e, ws, corpusFor(e, ws)!, 30);
    const ai = u.ai.reduce((t, r) => t + r.costMicroUsd, 0);
    expect(u.vectors).toMatchObject({ stored: 1 });
    expect(u.totalCostMicroUsd).toBe(Math.round(ai + u.storage.costMicroUsd + u.vectors!.monthlyCostMicroUsd));
    expect(u.pricing.asOf).toBe('2026-10-09');
  });
});

describe('GET /knowledge/usage', () => {
  const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
  const call = (ws: string) => routeKnowledgeApi(createFetchContext(
    new Request(`https://shareout.site/v1/workspaces/${ws}/knowledge/usage?days=7`, { headers: { Cookie: 'shareout_session=x' } }),
    base, execCtx,
  ));

  it('is owner/admin only', async () => {
    const ws = nextWs();
    await setKnowledgeEnabled(base, ws, true);
    getInternalWorkspaceRole.mockResolvedValue('member');
    expect((await call(ws))!.status).toBe(403);
    getInternalWorkspaceRole.mockResolvedValue('admin');
    const body = await (await call(ws))!.json() as { days: number; storage: object; totalCostMicroUsd: number };
    expect(body).toMatchObject({ days: 7, storage: { sources: 0 } });
    expect(typeof body.totalCostMicroUsd).toBe('number');
  });
});
