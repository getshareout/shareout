import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import {
  isKnowledgeEnabled,
  setKnowledgeEnabled,
  upsertKnowledgeFile,
  upsertLearnedFile,
  deleteKnowledgeFile,
  isTombstoned,
  listKnowledgeFiles,
  loadKnowledge,
  listConsolidationCandidates,
  setLastConsolidatedAt,
} from '../../../src/knowledge';

const e = env as unknown as Env;
const WS = 'wsp_kn';

beforeAll(async () => {
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`
  );
  await e.DB.exec(
    `CREATE TABLE IF NOT EXISTS knowledge_tombstones (workspace_id TEXT NOT NULL, path TEXT NOT NULL, forgotten_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (workspace_id, path))`
  );
});

beforeEach(async () => {
  await e.DB.exec('DELETE FROM knowledge_settings');
  await e.DB.exec('DELETE FROM workspace_files');
  await e.DB.exec('DELETE FROM knowledge_tombstones');
});

describe('knowledge settings', () => {
  it('defaults to disabled and toggles', async () => {
    expect(await isKnowledgeEnabled(e, WS)).toBe(false);
    await setKnowledgeEnabled(e, WS, true);
    expect(await isKnowledgeEnabled(e, WS)).toBe(true);
    await setKnowledgeEnabled(e, WS, false);
    expect(await isKnowledgeEnabled(e, WS)).toBe(false);
  });
});

describe('knowledge files CRUD + parse round-trip', () => {
  it('upserts, lists, parses, and deletes', async () => {
    await upsertKnowledgeFile(e, WS, {
      path: 'topics/retention.md',
      content: '---\nkind: topic\nid: topic.retention\ntitle: Retention\ntopics: [retention]\n---\nbody',
    });
    const { nodes, issues } = await loadKnowledge(e, WS);
    expect(issues).toHaveLength(0);
    expect(nodes[0]).toMatchObject({ id: 'topic.retention', kind: 'topic', topics: ['retention'] });

    await deleteKnowledgeFile(e, WS, 'topics/retention.md');
    expect(await listKnowledgeFiles(e, WS)).toHaveLength(0);
  });
});

describe('manual-source protection', () => {
  it('upsertLearnedFile never clobbers a manual row', async () => {
    await upsertKnowledgeFile(e, WS, {
      path: 'artifacts/art_1.md',
      content: '---\nkind: artifact-digest\nid: art.art_1\ntitle: Hand Tuned\n---\nmine',
      source: 'manual',
    });
    const wrote = await upsertLearnedFile(e, WS, {
      path: 'artifacts/art_1.md',
      content: '---\nkind: artifact-digest\nid: art.art_1\ntitle: Robot\n---\nlearned',
    });
    expect(wrote).toBe(false);
    const file = (await listKnowledgeFiles(e, WS)).find(f => f.path === 'artifacts/art_1.md');
    expect(file?.content).toContain('Hand Tuned');
    expect(file?.source).toBe('manual');
  });

  it('upsertLearnedFile writes when no manual row exists', async () => {
    const wrote = await upsertLearnedFile(e, WS, {
      path: 'artifacts/art_2.md',
      content: '---\nkind: artifact-digest\nid: art.art_2\ntitle: Fresh\n---\nx',
    });
    expect(wrote).toBe(true);
    expect((await listKnowledgeFiles(e, WS))[0].source).toBe('learned');
  });
});

describe('listConsolidationCandidates', () => {
  async function enable(ws: string, enabled: boolean, lastConsolidatedSql: string | null = null) {
    await e.DB.prepare(
      `INSERT INTO knowledge_settings (workspace_id, enabled, last_consolidated_at) VALUES (?, ?, ${lastConsolidatedSql ?? 'NULL'})`
    )
      .bind(ws, enabled ? 1 : 0)
      .run();
  }

  it('includes dirty + weekly-idle, excludes disabled + fresh-idle, oldest-first', async () => {
    // dirty: enabled, has a digest edited after its watermark
    await enable('ws_dirty', true, "datetime('now','-1 day')");
    await upsertKnowledgeFile(e, 'ws_dirty', {
      path: 'artifacts/x.md',
      content: '---\nkind: artifact-digest\nid: art.x\ntitle: X\n---\nb',
    });
    // disabled: never a candidate even though dirty
    await enable('ws_off', false);
    await upsertKnowledgeFile(e, 'ws_off', {
      path: 'artifacts/y.md',
      content: '---\nkind: artifact-digest\nid: art.y\ntitle: Y\n---\nb',
    });
    // idle 8 days, no dirty digest → weekly maintenance arm
    await enable('ws_idle', true, "datetime('now','-8 days')");
    // fresh idle (2 days), no dirty digest → excluded
    await enable('ws_fresh', true, "datetime('now','-2 days')");

    const cands = await listConsolidationCandidates(e, 25);
    const ids = cands.map(c => c.workspaceId);
    expect(ids).toContain('ws_dirty');
    expect(ids).toContain('ws_idle');
    expect(ids).not.toContain('ws_off');
    expect(ids).not.toContain('ws_fresh');
    // oldest watermark first: idle (-8d) before dirty (-1d)
    expect(ids.indexOf('ws_idle')).toBeLessThan(ids.indexOf('ws_dirty'));
  });

  it('setLastConsolidatedAt advances the watermark so the workspace drops out', async () => {
    await enable('ws_a', true, null);
    await upsertKnowledgeFile(e, 'ws_a', {
      path: 'artifacts/x.md',
      content: '---\nkind: artifact-digest\nid: art.x\ntitle: X\n---\nb',
    });
    expect((await listConsolidationCandidates(e, 25)).map(c => c.workspaceId)).toContain('ws_a');
    await setLastConsolidatedAt(e, 'ws_a', new Date(Date.now() + 60_000).toISOString());
    expect((await listConsolidationCandidates(e, 25)).map(c => c.workspaceId)).not.toContain('ws_a');
  });
});

describe('forget tombstones', () => {
  it('deleteKnowledgeFile with forget writes a tombstone', async () => {
    await upsertLearnedFile(e, WS, {
      path: 'artifacts/art_3.md',
      content: '---\nkind: artifact-digest\nid: art.art_3\ntitle: Gone\n---\nx',
    });
    expect(await isTombstoned(e, WS, 'artifacts/art_3.md')).toBe(false);
    await deleteKnowledgeFile(e, WS, 'artifacts/art_3.md', { forget: true });
    expect(await isTombstoned(e, WS, 'artifacts/art_3.md')).toBe(true);
    expect(await listKnowledgeFiles(e, WS)).toHaveLength(0);
  });
});
