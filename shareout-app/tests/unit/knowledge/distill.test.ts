import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import { runKnowledgeDistill, loadKnowledge, listKnowledgeFiles } from '../../../src/knowledge';

const HTML = '<html><body><h1>Acme retention</h1><p>Day-0 retention is 42 percent.</p></body></html>';
const RESPONSE =
  '{"title":"Acme Retention","topics":["retention","acme"],"entities":["Acme"],"summary":"s"}\n\nDay-0 retention is 42%. Acme users churn fast.';

const mockR2 = { get: async () => ({ text: async () => HTML }) } as unknown as Env['ARTIFACTS'];
const denv = { ...(env as unknown as Env), ARTIFACTS: mockR2 } as unknown as Env;
const e = env as unknown as Env;

const complete = async () => RESPONSE;

const WS = 'wsp_kn_d';
const WS_OFF = 'wsp_kn_off';

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`,
    `CREATE TABLE IF NOT EXISTS knowledge_ingest (workspace_id TEXT NOT NULL, artifact_id TEXT NOT NULL, content_hash TEXT, reason TEXT NOT NULL, queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT, PRIMARY KEY (workspace_id, artifact_id, reason))`,
    `CREATE TABLE IF NOT EXISTS knowledge_tombstones (workspace_id TEXT NOT NULL, path TEXT NOT NULL, forgotten_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (workspace_id, path))`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, description TEXT, workspace_id TEXT, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'approved', reason TEXT, checked_at TEXT, content_hash TEXT, held_visibility TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_tags (artifact_id TEXT NOT NULL, label TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT NOT NULL, version_id TEXT NOT NULL, channel TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS versions (id TEXT PRIMARY KEY, entrypoint TEXT)`,
    `CREATE TABLE IF NOT EXISTS assets (version_id TEXT NOT NULL, path TEXT NOT NULL, r2_key TEXT NOT NULL, mime TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT, model TEXT, units INTEGER, unit_kind TEXT, base_cost_micro_usd INTEGER, source TEXT, created_at TEXT)`,
  ]) {
    await e.DB.exec(sql);
  }
});

async function seedArtifact(id: string, ws: string, moderation = 'approved') {
  await e.DB.prepare(
    "INSERT INTO artifacts (id, name, description, workspace_id) VALUES (?, ?, ?, ?)"
  )
    .bind(id, `Page ${id}`, 'desc', ws)
    .run();
  await e.DB.prepare(
    'INSERT INTO artifact_moderation (artifact_id, status) VALUES (?, ?)'
  ).bind(id, moderation).run();
  await e.DB.prepare('INSERT INTO artifact_tags (artifact_id, label) VALUES (?, ?)').bind(id, 'acme').run();
  await e.DB.prepare(
    "INSERT INTO deployments (artifact_id, version_id, channel) VALUES (?, ?, 'production')"
  )
    .bind(id, `ver_${id}`)
    .run();
  await e.DB.prepare('INSERT INTO versions (id, entrypoint) VALUES (?, ?)').bind(`ver_${id}`, 'index.html').run();
  await e.DB.prepare('INSERT INTO assets (version_id, path, r2_key, mime) VALUES (?, ?, ?, ?)')
    .bind(`ver_${id}`, 'index.html', `r2/${id}`, 'text/html')
    .run();
}

async function enqueue(ws: string, id: string) {
  await e.DB.prepare(
    "INSERT INTO knowledge_ingest (workspace_id, artifact_id, content_hash, reason) VALUES (?, ?, 'v1', 'publish')"
  )
    .bind(ws, id)
    .run();
}

// queuedAtSql is a raw SQLite datetime expression (e.g. "datetime('now','-1 minute')") —
// inlined, not bound, so the function evaluates instead of storing its literal text.
async function enqueueAt(ws: string, id: string, reason: string, queuedAtSql: string) {
  await e.DB.prepare(
    `INSERT INTO knowledge_ingest (workspace_id, artifact_id, content_hash, reason, queued_at) VALUES (?, ?, 'v1', ?, ${queuedAtSql})`
  )
    .bind(ws, id, reason)
    .run();
}

async function countProcessed(ws: string): Promise<number> {
  const r = await e.DB.prepare(
    'SELECT COUNT(*) AS n FROM knowledge_ingest WHERE workspace_id = ? AND processed_at IS NOT NULL'
  )
    .bind(ws)
    .first<{ n: number }>();
  return r?.n ?? 0;
}

beforeEach(async () => {
  for (const t of ['knowledge_settings', 'workspace_files', 'knowledge_ingest', 'knowledge_tombstones', 'artifacts', 'artifact_tags', 'deployments', 'versions', 'assets', 'ai_usage_events']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.DB.prepare('INSERT INTO knowledge_settings (workspace_id, enabled) VALUES (?, 1)').bind(WS).run();
  await e.DB.prepare('INSERT INTO knowledge_settings (workspace_id, enabled) VALUES (?, 0)').bind(WS_OFF).run();
});

async function ingestProcessed(ws: string, id: string) {
  const r = await e.DB.prepare(
    'SELECT processed_at FROM knowledge_ingest WHERE workspace_id = ? AND artifact_id = ?'
  )
    .bind(ws, id)
    .first<{ processed_at: string | null }>();
  return r?.processed_at != null;
}

describe('runKnowledgeDistill', () => {
  it('distills a queued artifact into a valid digest and regenerates index.md', async () => {
    await seedArtifact('art_ok', WS);
    await enqueue(WS, 'art_ok');

    const res = await runKnowledgeDistill(denv, { complete });
    expect(res.processed).toBe(1);

    const { nodes, issues } = await loadKnowledge(e, WS);
    expect(issues).toHaveLength(0);
    const digest = nodes.find(n => n.path === 'artifacts/art_ok.md');
    expect(digest).toMatchObject({
      kind: 'artifact-digest',
      id: 'art.art_ok',
      title: 'Acme Retention',
      topics: ['retention', 'acme'],
      sources: ['art_ok'],
    });

    expect(await ingestProcessed(WS, 'art_ok')).toBe(true);

    const index = nodes.find(n => n.path === 'index.md');
    expect(index?.kind).toBe('overview');
    expect(index?.body).toContain('retention (1)');
    expect(index?.body).toContain('1 pages learned');
  });

  it('bootstraps index.md only when absent — leaves an existing (consolidated) trunk untouched', async () => {
    // A consolidation run wrote a Sonnet trunk; the hourly distill must not clobber it.
    await e.DB.prepare(
      "INSERT INTO workspace_files (workspace_id, namespace, path, content, source) VALUES (?, 'knowledge', 'index.md', ?, 'consolidated')"
    )
      .bind(WS, '---\nkind: overview\nid: index\ntitle: "Workspace knowledge"\n---\nHand-written trunk overview.')
      .run();

    await seedArtifact('art_trunk', WS);
    await enqueue(WS, 'art_trunk');
    const res = await runKnowledgeDistill(denv, { complete });
    expect(res.processed).toBe(1);

    const { nodes } = await loadKnowledge(e, WS);
    const index = nodes.find(n => n.path === 'index.md');
    expect(index?.body).toContain('Hand-written trunk overview.');
    expect(index?.body).not.toContain('pages learned');
  });

  it('ignores disabled workspaces', async () => {
    await seedArtifact('art_off', WS_OFF);
    await enqueue(WS_OFF, 'art_off');

    const res = await runKnowledgeDistill(denv, { complete });
    expect(res.processed).toBe(0);
    expect(await ingestProcessed(WS_OFF, 'art_off')).toBe(false);
    expect(await listKnowledgeFiles(e, WS_OFF)).toHaveLength(0);
  });

  it('skips moderation-flagged artifacts but marks them processed', async () => {
    await seedArtifact('art_bad', WS, 'blocked');
    await enqueue(WS, 'art_bad');

    const res = await runKnowledgeDistill(denv, { complete });
    expect(res.processed).toBe(0);
    expect(res.skipped).toBe(1);
    expect(await ingestProcessed(WS, 'art_bad')).toBe(true);
    expect(await listKnowledgeFiles(e, WS)).toHaveLength(0);
  });

  it('never overwrites a manual digest', async () => {
    await seedArtifact('art_man', WS);
    await enqueue(WS, 'art_man');
    await e.DB.prepare(
      "INSERT INTO workspace_files (workspace_id, namespace, path, content, source) VALUES (?, 'knowledge', 'artifacts/art_man.md', ?, 'manual')"
    )
      .bind(WS, '---\nkind: artifact-digest\nid: art.art_man\ntitle: Hand Tuned\n---\nmine')
      .run();

    await runKnowledgeDistill(denv, { complete });

    const file = (await listKnowledgeFiles(e, WS)).find(f => f.path === 'artifacts/art_man.md');
    expect(file?.source).toBe('manual');
    expect(file?.content).toContain('Hand Tuned');
  });

  it('caps each workspace so a big backfill cannot starve another workspace', async () => {
    const WS_B = 'wsp_kn_b';
    await e.DB.prepare('INSERT INTO knowledge_settings (workspace_id, enabled) VALUES (?, 1)').bind(WS_B).run();
    // WS floods the queue (queued earlier) with more than MAX_PER_RUN rows; WS_B has one, queued later.
    for (let i = 0; i < 22; i++) {
      const id = `art_flood_${i}`;
      await seedArtifact(id, WS);
      await enqueueAt(WS, id, 'backfill', "datetime('now','-1 minute')");
    }
    await seedArtifact('art_b_only', WS_B);
    await enqueueAt(WS_B, 'art_b_only', 'publish', "datetime('now')");

    const res = await runKnowledgeDistill(denv, { complete });

    // WS is capped at MAX_PER_WORKSPACE (5), leaving room in the run for WS_B.
    expect(await countProcessed(WS)).toBe(5);
    expect(await ingestProcessed(WS_B, 'art_b_only')).toBe(true);
    expect(res.processed).toBe(6);
  });

  it('one digest satisfies duplicate (publish + backfill) ingest rows', async () => {
    await seedArtifact('art_dup', WS);
    await enqueueAt(WS, 'art_dup', 'publish', "datetime('now')");
    await enqueueAt(WS, 'art_dup', 'backfill', "datetime('now')");

    let calls = 0;
    const counting = async () => {
      calls++;
      return RESPONSE;
    };
    const res = await runKnowledgeDistill(denv, { complete: counting });

    expect(calls).toBe(1);
    expect(res.processed).toBe(1);
    const rows = await e.DB.prepare(
      "SELECT COUNT(*) AS n FROM knowledge_ingest WHERE workspace_id = ? AND artifact_id = 'art_dup' AND processed_at IS NULL"
    )
      .bind(WS)
      .first<{ n: number }>();
    expect(rows?.n).toBe(0);
  });

  it('scoped run processes only the given workspace and stops at maxItems', async () => {
    const WS_C = 'wsp_kn_c';
    await e.DB.prepare('INSERT INTO knowledge_settings (workspace_id, enabled) VALUES (?, 1)').bind(WS_C).run();
    for (let i = 0; i < 3; i++) {
      const id = `art_scoped_${i}`;
      await seedArtifact(id, WS);
      await enqueue(WS, id);
    }
    await seedArtifact('art_other', WS_C);
    await enqueue(WS_C, 'art_other');

    const res = await runKnowledgeDistill(denv, { complete, workspaceId: WS, maxItems: 2 });

    // Only WS drained, capped at maxItems; the sibling workspace is untouched.
    expect(res.processed).toBe(2);
    expect(await countProcessed(WS)).toBe(2);
    expect(await ingestProcessed(WS_C, 'art_other')).toBe(false);
    expect(await countProcessed(WS_C)).toBe(0);
  });

  it('does not re-learn a tombstoned path', async () => {
    await seedArtifact('art_forget', WS);
    await enqueue(WS, 'art_forget');
    await e.DB.prepare(
      "INSERT INTO knowledge_tombstones (workspace_id, path, forgotten_at) VALUES (?, 'artifacts/art_forget.md', datetime('now'))"
    )
      .bind(WS)
      .run();

    const res = await runKnowledgeDistill(denv, { complete });
    expect(res.processed).toBe(0);
    expect(await ingestProcessed(WS, 'art_forget')).toBe(true);
    expect((await listKnowledgeFiles(e, WS)).find(f => f.path === 'artifacts/art_forget.md')).toBeUndefined();
  });
});
