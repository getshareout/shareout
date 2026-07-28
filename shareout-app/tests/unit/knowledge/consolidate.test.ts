import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect } from 'vitest';
import type { Env } from '../../../src/types';
import {
  runKnowledgeConsolidate,
  loadKnowledge,
  listKnowledgeFiles,
  getKnowledgeFile,
  isTombstoned,
  type ConsolidateComplete,
} from '../../../src/knowledge';
import { normalizeEntitySlug } from '../../../src/knowledge/consolidate';

const e = env as unknown as Env;
const WS = 'wsp_cons';

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS knowledge_settings (workspace_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 0, last_consolidated_at TEXT, updated_at TEXT NOT NULL DEFAULT (datetime('now')))`,
    `CREATE TABLE IF NOT EXISTS workspace_files (workspace_id TEXT NOT NULL, namespace TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', path TEXT NOT NULL, content TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'manual', updated_by TEXT, updated_by_kind TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), PRIMARY KEY (workspace_id, namespace, scope_id, path))`,
    `CREATE TABLE IF NOT EXISTS knowledge_ingest (workspace_id TEXT NOT NULL, artifact_id TEXT NOT NULL, content_hash TEXT, reason TEXT NOT NULL, queued_at TEXT NOT NULL DEFAULT (datetime('now')), processed_at TEXT, PRIMARY KEY (workspace_id, artifact_id, reason))`,
    `CREATE TABLE IF NOT EXISTS knowledge_tombstones (workspace_id TEXT NOT NULL, path TEXT NOT NULL, forgotten_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (workspace_id, path))`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, description TEXT, workspace_id TEXT, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_moderation (artifact_id TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT 'approved', reason TEXT, checked_at TEXT, content_hash TEXT, held_visibility TEXT)`,
    `CREATE TABLE IF NOT EXISTS ai_usage_events (id TEXT PRIMARY KEY, workspace_id TEXT, user_id TEXT, kind TEXT, model TEXT, units INTEGER, unit_kind TEXT, base_cost_micro_usd INTEGER, source TEXT, created_at TEXT)`,
  ]) {
    await e.DB.exec(sql);
  }
});

beforeEach(async () => {
  for (const t of ['knowledge_settings', 'workspace_files', 'knowledge_ingest', 'knowledge_tombstones', 'artifacts', 'ai_usage_events']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.DB.prepare('INSERT INTO knowledge_settings (workspace_id, enabled) VALUES (?, 1)').bind(WS).run();
});

// ---- fixtures ----

function digestContent(o: {
  id: string;
  title: string;
  topics?: string[];
  entities?: string[];
  body?: string;
  pinned?: boolean;
  staleAfter?: string;
  learnedAt?: string;
}): string {
  const fm = [
    '---',
    'kind: artifact-digest',
    `id: art.${o.id}`,
    `title: ${JSON.stringify(o.title)}`,
    `topics: [${(o.topics ?? []).map(s => JSON.stringify(s)).join(', ')}]`,
    `entities: [${(o.entities ?? []).map(s => JSON.stringify(s)).join(', ')}]`,
    `sources: [${JSON.stringify(o.id)}]`,
    ...(o.learnedAt ? [`learned_at: ${o.learnedAt}`] : []),
    ...(o.staleAfter ? [`stale_after: ${o.staleAfter}`] : []),
    `pinned: ${o.pinned ? 'true' : 'false'}`,
    '---',
  ].join('\n');
  return `${fm}\n${o.body ?? 'body'}\n`;
}

async function insertFile(
  ws: string,
  path: string,
  content: string,
  source = 'learned',
  updatedAtSql = "datetime('now')"
) {
  await e.DB.prepare(
    `INSERT OR REPLACE INTO workspace_files (workspace_id, namespace, path, content, source, updated_at) VALUES (?, 'knowledge', ?, ?, ?, ${updatedAtSql})`
  )
    .bind(ws, path, content, source)
    .run();
}

async function seedArtifact(id: string, ws: string, deleted = false) {
  await e.DB.prepare(
    'INSERT INTO artifacts (id, name, workspace_id, deleted_at) VALUES (?, ?, ?, ?)'
  )
    .bind(id, `Page ${id}`, ws, deleted ? '2026-01-01' : null)
    .run();
}

async function seedDigest(ws: string, o: Parameters<typeof digestContent>[0] & { source?: string; withArtifact?: boolean }) {
  if (o.withArtifact !== false) await seedArtifact(o.id, ws, false);
  await insertFile(ws, `artifacts/${o.id}.md`, digestContent(o), o.source ?? 'learned');
}

// A fake LLM branching on the system prompt prefix. Records calls for spying.
function makeFake(overrides: {
  topic?: (user: string) => string;
  entity?: (user: string) => string;
  alias?: (user: string) => string;
  overview?: (user: string) => string;
} = {}) {
  const calls = { topic: 0, entity: 0, alias: 0, overview: 0, lastTopicUser: '', lastEntityUser: '', lastAliasUser: '' };
  const complete: ConsolidateComplete = async (system, user) => {
    if (system.startsWith('You maintain one evolving topic')) {
      calls.topic++;
      calls.lastTopicUser = user;
      return overrides.topic?.(user) ?? '{"title":"Retention"}\n\n- merged fact one\n- merged fact two';
    }
    if (system.startsWith('You maintain one evolving entity')) {
      calls.entity++;
      calls.lastEntityUser = user;
      return overrides.entity?.(user) ?? '{"title":"Acme","aliases":[]}\n\n- entity fact';
    }
    if (system.startsWith('You canonicalize')) {
      calls.alias++;
      calls.lastAliasUser = user;
      return overrides.alias?.(user) ?? '{}';
    }
    if (system.startsWith('You write the trunk')) {
      calls.overview++;
      return overrides.overview?.(user) ?? 'This workspace tracks Acme retention metrics.';
    }
    return '';
  };
  return { complete, calls };
}

describe('runKnowledgeConsolidate — skeleton + budget', () => {
  it('no dirty candidates → zeros, no LLM', async () => {
    // fresh watermark + no dirty digests → not a candidate (weekly arm only fires >7d idle)
    await e.DB.prepare(
      "UPDATE knowledge_settings SET last_consolidated_at = datetime('now') WHERE workspace_id = ?"
    )
      .bind(WS)
      .run();
    const { complete, calls } = makeFake();
    const res = await runKnowledgeConsolidate(e, { complete });
    expect(res).toMatchObject({ workspaces: 0, topicPages: 0, entityPages: 0, pruned: 0, llmCalls: 0 });
    expect(calls.topic + calls.entity + calls.alias + calls.overview).toBe(0);
  });

  it('second run after watermark advance makes zero LLM calls', async () => {
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['retention'] });
    const first = makeFake();
    await runKnowledgeConsolidate(e, { complete: first.complete });
    expect(first.calls.topic).toBeGreaterThan(0);

    const second = makeFake();
    const res2 = await runKnowledgeConsolidate(e, { complete: second.complete });
    expect(res2.llmCalls).toBe(0);
    expect(res2.workspaces).toBe(0);
  });
});

describe('prune dead digests', () => {
  it('deletes a digest whose artifact is hard-deleted; no tombstone', async () => {
    await insertFile(WS, 'artifacts/gone.md', digestContent({ id: 'gone', title: 'Gone', topics: ['retention'] }));
    // no artifacts row → dead
    const { complete } = makeFake();
    const res = await runKnowledgeConsolidate(e, { complete });
    expect(res.pruned).toBe(1);
    expect((await listKnowledgeFiles(e, WS)).find(f => f.path === 'artifacts/gone.md')).toBeUndefined();
    expect(await isTombstoned(e, WS, 'artifacts/gone.md')).toBe(false);
  });

  it('deleted_at set on artifact → pruned', async () => {
    await seedArtifact('del', WS, true);
    await insertFile(WS, 'artifacts/del.md', digestContent({ id: 'del', title: 'Del', topics: ['x'] }));
    const res = await runKnowledgeConsolidate(e, makeFake());
    expect(res.pruned).toBe(1);
  });

  it('pinned and manual digests survive pruning', async () => {
    await insertFile(WS, 'artifacts/pin.md', digestContent({ id: 'pin', title: 'Pinned', pinned: true }));
    await insertFile(WS, 'artifacts/man.md', digestContent({ id: 'man', title: 'Manual' }), 'manual');
    const res = await runKnowledgeConsolidate(e, makeFake());
    expect(res.pruned).toBe(0);
    const files = await listKnowledgeFiles(e, WS);
    expect(files.find(f => f.path === 'artifacts/pin.md')).toBeDefined();
    expect(files.find(f => f.path === 'artifacts/man.md')).toBeDefined();
  });

  it("pruned digest's topic lands in the dirty set with its title in REMOVED SOURCES", async () => {
    // existing topic page so evolve fires; dead digest contributes a removed title
    await insertFile(
      WS,
      'topics/retention.md',
      '---\nkind: topic\nid: topic.retention\ntitle: Retention\ntopics: [retention]\nsources: [old]\n---\nold body'
    );
    await insertFile(
      WS,
      'artifacts/dead.md',
      digestContent({ id: 'dead', title: 'Dead Retention Note', topics: ['retention'] })
    );
    const fake = makeFake();
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    expect(fake.calls.lastTopicUser).toContain('REMOVED SOURCES');
    expect(fake.calls.lastTopicUser).toContain('Dead Retention Note');
  });

  it('stale_after in the past → knowledge_ingest row reason=stale, NULL hash', async () => {
    await seedDigest(WS, { id: 'stale1', title: 'Stale', topics: ['x'], staleAfter: '2000-01-01' });
    await runKnowledgeConsolidate(e, makeFake());
    const row = await e.DB.prepare(
      "SELECT content_hash, reason FROM knowledge_ingest WHERE workspace_id = ? AND artifact_id = 'stale1' AND reason = 'stale'"
    )
      .bind(WS)
      .first<{ content_hash: string | null; reason: string }>();
    expect(row?.reason).toBe('stale');
    expect(row?.content_hash).toBeNull();
  });
});

describe('topic evolve', () => {
  it('creates a fresh topic page from 2 new digests with correct frontmatter', async () => {
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['retention'], learnedAt: '2026-07-01T00:00:00Z' });
    await seedDigest(WS, { id: 'a2', title: 'D2', topics: ['retention'], learnedAt: '2026-07-02T00:00:00Z' });
    await runKnowledgeConsolidate(e, makeFake());
    const { nodes } = await loadKnowledge(e, WS);
    const topic = nodes.find(n => n.path === 'topics/retention.md');
    expect(topic).toMatchObject({ kind: 'topic', id: 'topic.retention', topics: ['retention'] });
    expect(topic?.sources.sort()).toEqual(['a1', 'a2']);
    expect(topic?.body).toContain('merged fact one');
  });

  it('never calls the LLM for a manual topic page', async () => {
    await insertFile(
      WS,
      'topics/retention.md',
      '---\nkind: topic\nid: topic.retention\ntitle: Mine\n---\nhand tuned',
      'manual'
    );
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['retention'] });
    const fake = makeFake();
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    expect(fake.calls.topic).toBe(0);
    const file = (await listKnowledgeFiles(e, WS)).find(f => f.path === 'topics/retention.md');
    expect(file?.content).toContain('hand tuned');
  });

  it('never re-creates a tombstoned topic path', async () => {
    await e.DB.prepare(
      "INSERT INTO knowledge_tombstones (workspace_id, path, forgotten_at) VALUES (?, 'topics/retention.md', datetime('now'))"
    )
      .bind(WS)
      .run();
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['retention'] });
    const fake = makeFake();
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    expect(fake.calls.topic).toBe(0);
    expect((await listKnowledgeFiles(e, WS)).find(f => f.path === 'topics/retention.md')).toBeUndefined();
  });

  it('empty LLM body leaves the old page intact', async () => {
    await insertFile(
      WS,
      'topics/retention.md',
      '---\nkind: topic\nid: topic.retention\ntitle: Retention\nsources: [old]\n---\noriginal body'
    );
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['retention'] });
    const fake = makeFake({ topic: () => '{"title":"Retention"}\n\n' }); // empty body
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    const file = (await listKnowledgeFiles(e, WS)).find(f => f.path === 'topics/retention.md');
    expect(file?.content).toContain('original body');
  });

  it('feeds only the newest 12 when >12 digests hit one topic', async () => {
    for (let i = 0; i < 15; i++) {
      await seedDigest(WS, {
        id: `d${i}`,
        title: `Digest ${i}`,
        topics: ['burst'],
        learnedAt: `2026-07-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      });
    }
    const fake = makeFake();
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    // newest 12 = Digest 14..3 ; oldest 3 (Digest 0,1,2) dropped
    expect(fake.calls.lastTopicUser).toContain('Digest 14');
    expect(fake.calls.lastTopicUser).toContain('Digest 3');
    expect(fake.calls.lastTopicUser).not.toContain('Digest 0 (');
    expect(fake.calls.lastTopicUser).not.toContain('Digest 2 (');
  });
});

describe('entity resolution + evolve', () => {
  it('"Acme" and "acme" collapse to one entities/acme.md with zero alias LLM', async () => {
    await seedDigest(WS, { id: 'a1', title: 'D1', entities: ['Acme'] });
    await seedDigest(WS, { id: 'a2', title: 'D2', entities: ['acme'] });
    const fake = makeFake();
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    expect(fake.calls.alias).toBe(0); // no existing entities → no adjudication
    const entities = (await listKnowledgeFiles(e, WS)).filter(f => f.path.startsWith('entities/'));
    expect(entities).toHaveLength(1);
    expect(entities[0].path).toBe('entities/acme.md');
  });

  it('a name already in existing aliases resolves with zero alias LLM', async () => {
    await insertFile(
      WS,
      'entities/acme.md',
      '---\nkind: entity\nid: entity.acme\ntitle: Acme\naliases: [acme app]\nsources: [x]\n---\ncur'
    );
    await seedDigest(WS, { id: 'a1', title: 'D1', entities: ['Acme App'] });
    const fake = makeFake();
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    expect(fake.calls.alias).toBe(0);
    // still evolves the acme page (dirty digest resolved to acme)
    expect(fake.calls.entity).toBeGreaterThan(0);
  });

  it('adjudicates an unknown name, persists the alias, and does not re-adjudicate next run', async () => {
    await insertFile(
      WS,
      'entities/acme.md',
      '---\nkind: entity\nid: entity.acme\ntitle: Acme\naliases: []\nsources: [x]\n---\ncur'
    );
    await seedDigest(WS, { id: 'a1', title: 'D1', entities: ['The Acme Team'] });
    const fake = makeFake({
      alias: () => '{"The Acme Team":"acme"}',
      entity: () => '{"title":"Acme","aliases":[]}\n\n- fact',
    });
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    expect(fake.calls.alias).toBe(1);
    const acme = (await loadKnowledge(e, WS)).nodes.find(n => n.path === 'entities/acme.md');
    expect((acme?.extra.aliases as string[]).map(s => s.toLowerCase())).toContain('the acme team');

    // re-run: alias now in frontmatter → no adjudication. Touch the digest to re-dirty it.
    await insertFile(WS, 'artifacts/a1.md', digestContent({ id: 'a1', title: 'D1', entities: ['The Acme Team'] }));
    const fake2 = makeFake({ entity: () => '{"title":"Acme","aliases":[]}\n\n- fact' });
    await runKnowledgeConsolidate(e, { complete: fake2.complete });
    expect(fake2.calls.alias).toBe(0);
  });

  it('F2: merges two duplicate entity nodes: loser plain-deleted (NOT tombstoned), winner keeps both sources + loser alias', async () => {
    // acme-app is an alias of acme AND its own node → they are the same thing.
    await insertFile(
      WS,
      'entities/acme.md',
      '---\nkind: entity\nid: entity.acme\ntitle: Acme\naliases: [acme-app]\nsources: [s1, s2]\n---\nbody text'
    );
    await insertFile(
      WS,
      'entities/acme-app.md',
      '---\nkind: entity\nid: entity.acme-app\ntitle: Acme App\naliases: []\nsources: [s3]\n---\napp body'
    );
    // make one workspace dirty so it becomes a candidate
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['x'] });
    const fake = makeFake({ entity: () => '{"title":"Acme","aliases":[]}\n\n- merged entity fact' });
    await runKnowledgeConsolidate(e, { complete: fake.complete });

    // winner = acme (2 sources > 1); loser acme-app plain-deleted so a future distill can re-learn.
    // A tombstone here would irreversibly block re-learning if the alias was hallucinated (F2).
    expect(await isTombstoned(e, WS, 'entities/acme-app.md')).toBe(false);
    expect((await listKnowledgeFiles(e, WS)).find(f => f.path === 'entities/acme-app.md')).toBeUndefined();
    const acme = (await loadKnowledge(e, WS)).nodes.find(n => n.path === 'entities/acme.md');
    expect(acme?.sources).toEqual(expect.arrayContaining(['s1', 's2', 's3']));
    // loser slug carried as a winner alias so its old name resolves to the winner, not a rebuild.
    expect(acme?.extra.aliases as string[]).toContain('acme-app');
  });

  it('skips a merge when the loser is pinned', async () => {
    await insertFile(
      WS,
      'entities/acme.md',
      '---\nkind: entity\nid: entity.acme\ntitle: Acme\naliases: [acme-app]\nsources: [s1, s2]\n---\nbody text'
    );
    await insertFile(
      WS,
      'entities/acme-app.md',
      '---\nkind: entity\nid: entity.acme-app\ntitle: Acme App\naliases: []\nsources: [s3]\npinned: true\n---\napp body'
    );
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['x'] });
    await runKnowledgeConsolidate(e, makeFake());
    expect(await isTombstoned(e, WS, 'entities/acme-app.md')).toBe(false);
    expect((await listKnowledgeFiles(e, WS)).find(f => f.path === 'entities/acme-app.md')).toBeDefined();
  });

  it('malformed alias JSON → all names treated as new (no crash)', async () => {
    await insertFile(
      WS,
      'entities/acme.md',
      '---\nkind: entity\nid: entity.acme\ntitle: Acme\nsources: [x]\n---\ncur'
    );
    await seedDigest(WS, { id: 'a1', title: 'D1', entities: ['Snowflake Warehouse'] });
    const fake = makeFake({ alias: () => 'not json at all' });
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    const entities = (await listKnowledgeFiles(e, WS)).filter(f => f.path.startsWith('entities/'));
    expect(entities.map(f => f.path).sort()).toContain('entities/snowflake-warehouse.md');
  });
});

describe('timeline', () => {
  it('writes one line per digest, deduped by artifact id across runs', async () => {
    await seedDigest(WS, { id: 'a1', title: 'Acme Note', topics: ['retention', 'acme'], learnedAt: '2026-07-05T00:00:00Z' });
    await runKnowledgeConsolidate(e, makeFake());
    let tl = await getKnowledgeFile(e, WS, 'timeline/2026-07.md');
    expect(tl?.content).toContain('[a1]');
    expect(tl?.content).toContain('Acme Note');

    // re-dirty same digest → no duplicate line
    await insertFile(WS, 'artifacts/a1.md', digestContent({ id: 'a1', title: 'Acme Note', topics: ['retention'], learnedAt: '2026-07-05T00:00:00Z' }));
    await runKnowledgeConsolidate(e, makeFake());
    tl = await getKnowledgeFile(e, WS, 'timeline/2026-07.md');
    expect((tl?.content.match(/\[a1\]/g) ?? []).length).toBe(1);
  });

  it('routes a digest to the month of its learned_at', async () => {
    await seedDigest(WS, { id: 'a1', title: 'May Note', topics: ['x'], learnedAt: '2026-05-15T00:00:00Z' });
    await runKnowledgeConsolidate(e, makeFake());
    expect(await getKnowledgeFile(e, WS, 'timeline/2026-05.md')).not.toBeNull();
  });
});

describe('overview + ledger', () => {
  it('writes the trunk with a ## Top topics section and records ai_usage_events', async () => {
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['retention'] });
    const fake = makeFake({ overview: () => 'Acme retention intelligence workspace.' });
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    const idx = await getKnowledgeFile(e, WS, 'index.md');
    expect(idx?.source).toBe('consolidated');
    expect(idx?.content).toContain('Acme retention intelligence workspace.');
    expect(idx?.content).toContain('## Top topics');
    expect(idx?.content).toContain('[[topic.retention]]');

    const usage = await e.DB.prepare(
      "SELECT COUNT(*) AS n FROM ai_usage_events WHERE workspace_id = ? AND kind = 'knowledge_consolidate'"
    )
      .bind(WS)
      .first<{ n: number }>();
    expect((usage?.n ?? 0)).toBeGreaterThan(0);
  });

  it('never overwrites a manual index and does not call the overview LLM', async () => {
    await insertFile(WS, 'index.md', '---\nkind: overview\nid: index\ntitle: Mine\n---\nhand trunk', 'manual');
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['retention'] });
    const fake = makeFake();
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    expect(fake.calls.overview).toBe(0);
    const idx = await getKnowledgeFile(e, WS, 'index.md');
    expect(idx?.content).toContain('hand trunk');
  });
});

describe('normalizeEntitySlug', () => {
  it('normalizes case, whitespace, diacritics and leading "the"', () => {
    expect(normalizeEntitySlug('  Acme ')).toBe('acme');
    expect(normalizeEntitySlug('The Acme Team')).toBe('acme-team');
    expect(normalizeEntitySlug('Café Ltd')).toBe('cafe-ltd');
  });
});

describe('F1: watermark stored in D1 datetime format (not ISO)', () => {
  it('a same-day-but-later digest is seen as dirty after the watermark advances', async () => {
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['retention'] });
    await runKnowledgeConsolidate(e, {
      complete: makeFake().complete,
      now: new Date('2026-07-09T03:00:00.000Z'),
    });

    // Watermark MUST be D1 datetime format ('YYYY-MM-DD HH:MM:SS'): a space separator, no
    // ms/Z. An ISO watermark ('2026-07-09T03:00:00.000Z') sorts ABOVE same-date digests
    // ('2026-07-09 05:00:00') because ' ' < 'T', hiding them from the dirty query forever.
    const ks = await e.DB.prepare(
      'SELECT last_consolidated_at FROM knowledge_settings WHERE workspace_id = ?'
    )
      .bind(WS)
      .first<{ last_consolidated_at: string }>();
    expect(ks?.last_consolidated_at).toBe('2026-07-09 03:00:00');

    // A NEW digest written 2h after the watermark, same calendar day (D1 format).
    await seedArtifact('a2', WS, false);
    await insertFile(
      WS,
      'artifacts/a2.md',
      digestContent({ id: 'a2', title: 'Later Note', topics: ['retention'] }),
      'learned',
      "datetime('2026-07-09 03:00:00','+2 hours')"
    );

    const fake2 = makeFake();
    await runKnowledgeConsolidate(e, {
      complete: fake2.complete,
      now: new Date('2026-07-10T03:00:00.000Z'),
    });
    // a2 must be folded into the retention topic — proves it was seen as dirty.
    expect(fake2.calls.topic).toBeGreaterThan(0);
    expect(fake2.calls.lastTopicUser).toContain('Later Note');
  });
});

describe('F5: `changed` is per-workspace, not the fleet-global accumulator', () => {
  it('a workspace with zero deltas does not regenerate its trunk after another changed', async () => {
    const WS2 = 'wsp_cons2';
    await e.DB.prepare('INSERT INTO knowledge_settings (workspace_id, enabled) VALUES (?, 1)').bind(WS2).run();
    // WS: dirty → will write a topic page (a real delta). Sorts first (null watermark → 1970).
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['retention'] });
    // WS2: idle >7d (weekly-maintenance candidate) but with ZERO dirty digests → no delta.
    await e.DB.prepare(
      "UPDATE knowledge_settings SET last_consolidated_at = datetime('now','-8 days') WHERE workspace_id = ?"
    )
      .bind(WS2)
      .run();
    const stableTrunk = '---\nkind: overview\nid: index\ntitle: "Workspace knowledge"\n---\nstable trunk\n';
    await insertFile(WS2, 'index.md', stableTrunk, 'consolidated');

    const fake = makeFake();
    await runKnowledgeConsolidate(e, { complete: fake.complete });

    // Exactly ONE overview LLM call — for WS. WS2 had no delta, so with the global-accumulator
    // bug it would ALSO regenerate (count 2) and overwrite its byte-stable trunk.
    expect(fake.calls.overview).toBe(1);
    expect((await getKnowledgeFile(e, WS2, 'index.md'))?.content).toBe(stableTrunk);
  });
});

describe('F6: topic slug injection via distill output', () => {
  it('a topic slug carrying a newline is normalized — no frontmatter injection', async () => {
    await seedDigest(WS, {
      id: 'a1',
      title: 'D1',
      topics: ['retention\npinned: true'],
      learnedAt: '2026-07-01T00:00:00Z',
    });
    await runKnowledgeConsolidate(e, makeFake());

    // Normalized to a clean slug → clean path + `id: topic.…`, no injected `pinned: true` line.
    const topic = (await loadKnowledge(e, WS)).nodes.find(n => n.path === 'topics/retention-pinned-true.md');
    expect(topic).toBeDefined();
    expect(topic?.pinned).toBe(false); // stays evolvable, not frozen by an injected pin
    const paths = (await listKnowledgeFiles(e, WS)).map(f => f.path);
    expect(paths.some(p => p.includes('\n'))).toBe(false);
  });
});

describe('F7: prune is bounded per run', () => {
  it('caps prune at 200 dead digests; the rest are pruned on the next qualifying run', async () => {
    for (let i = 0; i < 250; i++) {
      // no artifacts row → dead; none pinned/manual
      await insertFile(WS, `artifacts/dead${i}.md`, digestContent({ id: `dead${i}`, title: `Dead ${i}` }));
    }
    const res1 = await runKnowledgeConsolidate(e, makeFake());
    expect(res1.pruned).toBe(200);
    expect((await listKnowledgeFiles(e, WS)).filter(f => f.path.startsWith('artifacts/')).length).toBe(50);

    // Reset the watermark so WS re-qualifies (simulates the next night it is a candidate).
    await e.DB.prepare('UPDATE knowledge_settings SET last_consolidated_at = NULL WHERE workspace_id = ?')
      .bind(WS)
      .run();
    const res2 = await runKnowledgeConsolidate(e, makeFake());
    expect(res2.pruned).toBe(50);
    expect((await listKnowledgeFiles(e, WS)).filter(f => f.path.startsWith('artifacts/')).length).toBe(0);
  });
});

describe('F3/F4: merge folds new facts + full provenance into the winner', () => {
  it('F3: merge night feeds BOTH entities\' new digests to the winner', async () => {
    await insertFile(
      WS,
      'entities/acme.md',
      '---\nkind: entity\nid: entity.acme\ntitle: Acme\naliases: [acme-app]\nsources: [s1, s2]\n---\nbody text'
    );
    await insertFile(
      WS,
      'entities/acme-app.md',
      '---\nkind: entity\nid: entity.acme-app\ntitle: Acme App\naliases: []\nsources: [s3]\n---\napp body'
    );
    // new dirty digests this night for both the winner name and the loser name
    await seedDigest(WS, { id: 'd_win', title: 'Winner Digest', entities: ['Acme'], learnedAt: '2026-07-05T00:00:00Z' });
    await seedDigest(WS, { id: 'd_lose', title: 'Loser Digest', entities: ['Acme App'], learnedAt: '2026-07-06T00:00:00Z' });

    const fake = makeFake({ entity: () => '{"title":"Acme","aliases":[]}\n\n- merged' });
    await runKnowledgeConsolidate(e, { complete: fake.complete });

    // the single merge-evolve call carries both new digests + the loser page body seed
    expect(fake.calls.lastEntityUser).toContain('Winner Digest');
    expect(fake.calls.lastEntityUser).toContain('Loser Digest');
    expect(fake.calls.lastEntityUser).toContain('merged duplicate');
    const acme = (await loadKnowledge(e, WS)).nodes.find(n => n.path === 'entities/acme.md');
    expect(acme?.sources).toEqual(expect.arrayContaining(['d_win', 'd_lose']));
    expect((await listKnowledgeFiles(e, WS)).find(f => f.path === 'entities/acme-app.md')).toBeUndefined();
  });

  it('F4: merge unions ALL loser sources (not just sources[0])', async () => {
    await insertFile(
      WS,
      'entities/acme.md',
      '---\nkind: entity\nid: entity.acme\ntitle: Acme\naliases: [acme-app]\nsources: [s1, s2, s3, s4, s5, s6]\n---\nbody text'
    );
    await insertFile(
      WS,
      'entities/acme-app.md',
      '---\nkind: entity\nid: entity.acme-app\ntitle: Acme App\naliases: []\nsources: [x1, x2, x3, x4]\n---\napp body'
    );
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['z'] });
    const fake = makeFake({ entity: () => '{"title":"Acme","aliases":[]}\n\n- merged' });
    await runKnowledgeConsolidate(e, { complete: fake.complete });

    const acme = (await loadKnowledge(e, WS)).nodes.find(n => n.path === 'entities/acme.md');
    expect(acme?.sources).toEqual(expect.arrayContaining(['x1', 'x2', 'x3', 'x4']));
  });

  it('F4: a loser with no sources never injects a mis-sliced `ik-…` source', async () => {
    await insertFile(
      WS,
      'entities/acme.md',
      '---\nkind: entity\nid: entity.acme\ntitle: Acme\naliases: [acme-app]\nsources: [s1, s2]\n---\nbody text'
    );
    await insertFile(
      WS,
      'entities/acme-app.md',
      '---\nkind: entity\nid: entity.acme-app\ntitle: Acme App\nsources: []\n---\napp body'
    );
    await seedDigest(WS, { id: 'a1', title: 'D1', topics: ['z'] });
    const fake = makeFake({ entity: () => '{"title":"Acme","aliases":[]}\n\n- merged' });
    await runKnowledgeConsolidate(e, { complete: fake.complete });

    const acme = (await loadKnowledge(e, WS)).nodes.find(n => n.path === 'entities/acme.md');
    expect(acme?.sources.some(s => s.startsWith('ik-'))).toBe(false);
  });
});

describe('F9: night-1 clustering of new names among themselves', () => {
  it('clusters "Acme"/"Acme App"/"The Acme team" into ONE entity page, others as aliases', async () => {
    await seedDigest(WS, { id: 'a1', title: 'D1', entities: ['Acme'], learnedAt: '2026-07-01T00:00:00Z' });
    await seedDigest(WS, { id: 'a2', title: 'D2', entities: ['Acme App'], learnedAt: '2026-07-02T00:00:00Z' });
    await seedDigest(WS, { id: 'a3', title: 'D3', entities: ['The Acme team'], learnedAt: '2026-07-03T00:00:00Z' });
    const fake = makeFake({
      // no existing entities, but ≥2 distinct-normalizing new names → clustering call fires
      alias: () => '{"Acme":"Acme","Acme App":"Acme","The Acme team":"Acme"}',
      entity: () => '{"title":"Acme","aliases":[]}\n\n- fact',
    });
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    expect(fake.calls.alias).toBe(1);
    const entities = (await listKnowledgeFiles(e, WS)).filter(f => f.path.startsWith('entities/'));
    expect(entities.map(f => f.path)).toEqual(['entities/acme.md']);
    const acme = (await loadKnowledge(e, WS)).nodes.find(n => n.path === 'entities/acme.md');
    const aliases = (acme?.extra.aliases as string[]).map(s => s.toLowerCase());
    expect(aliases).toContain('acme app');
    expect(aliases).toContain('the acme team');
  });

  it('an unrelated new name ("Snowflake") in the same clustering call keeps its own page', async () => {
    await seedDigest(WS, { id: 'a1', title: 'D1', entities: ['Acme'], learnedAt: '2026-07-01T00:00:00Z' });
    await seedDigest(WS, { id: 'a2', title: 'D2', entities: ['Acme App'], learnedAt: '2026-07-02T00:00:00Z' });
    await seedDigest(WS, { id: 'a3', title: 'D3', entities: ['Snowflake'], learnedAt: '2026-07-03T00:00:00Z' });
    const fake = makeFake({
      alias: () => '{"Acme":"Acme","Acme App":"Acme","Snowflake":"new"}',
      entity: () => '{"title":"E","aliases":[]}\n\n- fact',
    });
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    expect(fake.calls.alias).toBe(1);
    const entities = (await listKnowledgeFiles(e, WS)).filter(f => f.path.startsWith('entities/')).map(f => f.path).sort();
    expect(entities).toEqual(['entities/acme.md', 'entities/snowflake.md']);
  });

  it('idempotent: night-2 re-run resolves clustered names by lookup — no adjudication, no split', async () => {
    await seedDigest(WS, { id: 'a1', title: 'D1', entities: ['Acme'], learnedAt: '2026-07-01T00:00:00Z' });
    await seedDigest(WS, { id: 'a2', title: 'D2', entities: ['Acme App'], learnedAt: '2026-07-02T00:00:00Z' });
    const first = makeFake({
      alias: () => '{"Acme":"Acme","Acme App":"Acme"}',
      entity: () => '{"title":"Acme","aliases":[]}\n\n- fact',
    });
    await runKnowledgeConsolidate(e, { complete: first.complete });
    expect(first.calls.alias).toBe(1);

    // re-dirty both digests (same night's names) → alias now in acme frontmatter → pure lookup.
    await insertFile(WS, 'artifacts/a1.md', digestContent({ id: 'a1', title: 'D1', entities: ['Acme'] }));
    await insertFile(WS, 'artifacts/a2.md', digestContent({ id: 'a2', title: 'D2', entities: ['Acme App'] }));
    await e.DB.prepare('UPDATE knowledge_settings SET last_consolidated_at = NULL WHERE workspace_id = ?').bind(WS).run();
    const second = makeFake({ entity: () => '{"title":"Acme","aliases":[]}\n\n- fact' });
    await runKnowledgeConsolidate(e, { complete: second.complete });
    expect(second.calls.alias).toBe(0);
    const entities = (await listKnowledgeFiles(e, WS)).filter(f => f.path.startsWith('entities/'));
    expect(entities.map(f => f.path)).toEqual(['entities/acme.md']);
  });

  it('malformed cluster JSON → each new name falls back to its own page (no crash)', async () => {
    await seedDigest(WS, { id: 'a1', title: 'D1', entities: ['Acme'], learnedAt: '2026-07-01T00:00:00Z' });
    await seedDigest(WS, { id: 'a2', title: 'D2', entities: ['Acme App'], learnedAt: '2026-07-02T00:00:00Z' });
    const fake = makeFake({ alias: () => 'not json at all' });
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    const entities = (await listKnowledgeFiles(e, WS)).filter(f => f.path.startsWith('entities/')).map(f => f.path).sort();
    expect(entities).toEqual(['entities/acme-app.md', 'entities/acme.md']);
  });

  it('preserves the original path: a new name mapped to an EXISTING slug still resolves onto it', async () => {
    await insertFile(
      WS,
      'entities/acme.md',
      '---\nkind: entity\nid: entity.acme\ntitle: Acme\naliases: []\nsources: [x]\n---\ncur'
    );
    await seedDigest(WS, { id: 'a1', title: 'D1', entities: ['The Acme Team'] });
    const fake = makeFake({
      alias: () => '{"The Acme Team":"acme"}',
      entity: () => '{"title":"Acme","aliases":[]}\n\n- fact',
    });
    await runKnowledgeConsolidate(e, { complete: fake.complete });
    const entities = (await listKnowledgeFiles(e, WS)).filter(f => f.path.startsWith('entities/'));
    expect(entities.map(f => f.path)).toEqual(['entities/acme.md']);
  });
});
