// AI enrichment of files (work/042 P4). Real Miniflare D1 + R2; the LLM call is mocked so
// the guards, JSON parsing, and the stale-version write guard are exercised without network.
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';

const chatComplete = vi.fn(async () => '{"summary":"A quarterly budget spreadsheet.","tags":["Budget","Q3","Finance"]}');
vi.mock('../../../src/data/agent/anthropic', () => ({
  chatComplete: (...a: unknown[]) => chatComplete(...a),
  getAIProvider: () => ({ provider: 'openai', apiKey: 'sk-test', baseUrl: '', model: 'gpt-4o' }),
}));

const { enrichDeliverable } = await import('../../../src/assets/enrich');
const { listDeliverables } = await import('../../../src/assets/deliverables');

const e = env as unknown as Env;
const BK = 'bk';

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS asset_deliverables (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT, folder_id TEXT, visibility TEXT NOT NULL DEFAULT 'workspace', deleted_at TEXT, type_metadata TEXT, updated_at TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS blobs (id TEXT PRIMARY KEY, artifact_id TEXT, deliverable_id TEXT, version_no INTEGER, filename TEXT, mime_type TEXT, size_bytes INTEGER, r2_key TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT, model TEXT, units INTEGER, unit_kind TEXT, base_cost_micro_usd INTEGER, source TEXT, created_at TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS file_artifact_usage (deliverable_id TEXT, artifact_id TEXT, created_at TEXT, PRIMARY KEY (deliverable_id, artifact_id))`);
});

async function seedFile(dlv: string, blob: string, opts: { mime?: string; size?: number; text?: string; version?: number; typeMeta?: string; filename?: string } = {}) {
  const mime = opts.mime ?? 'text/csv';
  const size = opts.size ?? 20;
  await e.DB.prepare(`INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, visibility, type_metadata) VALUES (?, ?, 'wsp', 'usr', 'F', 'workspace', ?)`).bind(dlv, BK, opts.typeMeta ?? null).run();
  await e.DB.prepare(`INSERT INTO blobs (id, artifact_id, deliverable_id, version_no, filename, mime_type, size_bytes, r2_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(blob, BK, dlv, opts.version ?? 1, opts.filename ?? 'f.csv', mime, size, 'k/' + blob).run();
  await e.ARTIFACTS.put('k/' + blob, new TextEncoder().encode(opts.text ?? 'a,b\n1,2'));
}
const enrichmentOf = async (dlv: string) => {
  const r = await e.DB.prepare('SELECT type_metadata FROM asset_deliverables WHERE id = ?').bind(dlv).first<{ type_metadata: string | null }>();
  return r?.type_metadata ? JSON.parse(r.type_metadata).enrichment : null;
};

beforeEach(async () => {
  chatComplete.mockClear();
  await e.DB.exec(`DELETE FROM asset_deliverables`);
  await e.DB.exec(`DELETE FROM blobs`);
  await e.DB.exec(`DELETE FROM ai_usage_events`);
});

describe('enrichDeliverable (work/042 P4)', () => {
  it('enriches a text file: summary + tags + blobId, and records usage', async () => {
    await seedFile('d1', 'b1');
    await enrichDeliverable(e, BK, 'd1');
    const enr = await enrichmentOf('d1');
    expect(enr.status).toBe('ok');
    expect(enr.summary).toContain('budget');
    expect(enr.tags).toEqual(['budget', 'q3', 'finance']); // lowercased
    expect(enr.blobId).toBe('b1');
    const usage = await e.DB.prepare(`SELECT COUNT(*) AS n FROM ai_usage_events WHERE kind='file_enrichment'`).first<{ n: number }>();
    expect(usage!.n).toBe(1);
  });

  it('marks a binary/unreadable file unsupported without calling the LLM', async () => {
    await seedFile('d2', 'b2', { mime: 'image/png', filename: 'logo.png', text: '\x89PNG' });
    await enrichDeliverable(e, BK, 'd2');
    expect((await enrichmentOf('d2')).status).toBe('unsupported');
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('marks an oversized file unsupported without fetching bytes or calling the LLM', async () => {
    await seedFile('d3', 'b3', { size: 30_000_000 });
    await enrichDeliverable(e, BK, 'd3');
    expect((await enrichmentOf('d3')).status).toBe('unsupported');
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('skip-guard: re-enriching the same version is a no-op (no LLM call)', async () => {
    await seedFile('d4', 'b4', { typeMeta: JSON.stringify({ enrichment: { status: 'ok', blobId: 'b4', at: 'x' } }) });
    await enrichDeliverable(e, BK, 'd4');
    expect(chatComplete).not.toHaveBeenCalled();
  });

  it('a new version re-enriches; the old summary is hidden as stale until then', async () => {
    await seedFile('d5', 'b5');
    await enrichDeliverable(e, BK, 'd5'); // enriches b5
    // add v2 (b6 now latest); enrichment on record still points at b5
    await e.DB.prepare(`INSERT INTO blobs (id, artifact_id, deliverable_id, version_no, filename, mime_type, size_bytes, r2_key) VALUES ('b6', ?, 'd5', 2, 'f.csv', 'text/csv', 20, 'k/b6')`).bind(BK).run();
    await e.ARTIFACTS.put('k/b6', new TextEncoder().encode('c,d\n3,4'));
    const rows = await listDeliverables(e, BK);
    expect(rows.find(r => r.id === 'd5')!.enrichment).toBeNull(); // stale (b5) hidden vs latest b6
    await enrichDeliverable(e, BK, 'd5'); // re-enriches b6
    const rows2 = await listDeliverables(e, BK);
    expect(rows2.find(r => r.id === 'd5')!.enrichment!.blobId).toBe('b6');
  });
});
