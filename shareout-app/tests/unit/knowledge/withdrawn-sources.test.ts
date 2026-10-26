// A page that stops being open to every member (made private, or moved to the trash) stops
// contributing to the notes and the overview other members and their assistants read: they are
// withheld at once, and the next consolidation rebuilds them from the pages still open to all.
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { AuthUser } from '../../../src/api-auth';
import {
  getKnowledgeFile,
  loadKnowledge,
  runKnowledgeConsolidate,
  upsertKnowledgeFile,
  type ConsolidateComplete,
} from '../../../src/knowledge';
import { readableNodes } from '../../../src/knowledge/source-links';
import { knowledgeTrunkForContext } from '../../../src/knowledge-context';
import { handleUpdateArtifact, softDeleteArtifact } from '../../../src/artifacts/crud';

const WS = 'wsp_withdrawn';
const OWNER = 'usr_withdrawn_owner';
const MEMBER = 'usr_withdrawn_member';
const owner: AuthUser = { id: OWNER, email: 'owner@example.test', username: null };

const note = (kind: string, id: string, sources: string[], body: string) =>
  `---\nkind: ${kind}\nid: ${id}\ntitle: ${JSON.stringify(id)}\ntopics: [roadmap]\nsources: [${sources.join(', ')}]\nprovenance: full\n---\n${body}\n`;
const digest = (id: string, title: string, body: string) =>
  `---\nkind: artifact-digest\nid: art.${id}\ntitle: ${JSON.stringify(title)}\ntopics: [roadmap]\nentities: []\nsources: [${id}]\nlearned_at: 2026-07-01T00:00:00.000Z\npinned: false\n---\n${body}\n`;

// The consolidator's model, reduced to: write back the digests it was given.
const complete: ConsolidateComplete = async (system, user) => {
  if (system.startsWith('You maintain one evolving topic')) {
    const fed = [...user.matchAll(/^### (.+?) \(learned/gm)].map((m) => m[1]);
    return `{"title":"Roadmap"}\n\n${fed.map((t) => `- from ${t}`).join('\n')}`;
  }
  if (system.startsWith('You write the trunk')) return `Roadmap work. ${user.includes('LAUNCH-DATE') ? 'LAUNCH-DATE' : ''}`.trim();
  return '';
};

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'owner@example.test', 'Owner'), (?, 'member@example.test', 'Member')").bind(OWNER, MEMBER),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'withdrawn-w', ?)").bind(WS, OWNER),
    e.DB.prepare('INSERT INTO knowledge_settings (workspace_id, enabled) VALUES (?, 1)').bind(WS),
  ]);
});

beforeEach(async () => {
  await e.DB.prepare("DELETE FROM workspace_files WHERE workspace_id = ? AND namespace = 'knowledge'").bind(WS).run();
  await e.DB.prepare('DELETE FROM artifacts WHERE workspace_id = ?').bind(WS).run();
  for (const [id, slug] of [['art_open', 'open-page'], ['art_plan', 'plan-page']]) {
    await e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility) VALUES (?, ?, ?, ?, ?, 'workspace')")
      .bind(id, slug, slug, OWNER, WS).run();
  }
  await upsertKnowledgeFile(e, WS, { path: 'artifacts/art_open.md', content: digest('art_open', 'Open roadmap', 'Q2 target is 40%.'), source: 'learned' });
  await upsertKnowledgeFile(e, WS, { path: 'artifacts/art_plan.md', content: digest('art_plan', 'Launch plan', 'LAUNCH-DATE is May 3.'), source: 'learned' });
  await upsertKnowledgeFile(e, WS, { path: 'topics/roadmap.md', content: note('topic', 'topic.roadmap', ['art_plan', 'art_open'], '- LAUNCH-DATE is May 3.\n- Q2 target is 40%.'), source: 'consolidated' });
  await upsertKnowledgeFile(e, WS, { path: 'index.md', content: note('overview', 'index', ['art_plan', 'art_open'], 'Roadmap work. LAUNCH-DATE.'), source: 'consolidated' });
  // Steady state: consolidated just now, nothing pending.
  await e.DB.prepare("UPDATE knowledge_settings SET last_consolidated_at = '2999-01-01 00:00:00', rebuild_requested_at = NULL WHERE workspace_id = ?").bind(WS).run();
});

const memberSeesRoadmap = async () =>
  (await readableNodes(e, WS, MEMBER, (await loadKnowledge(e, WS)).nodes)).some((n) => n.path === 'topics/roadmap.md');
const requested = async () =>
  (await e.DB.prepare('SELECT rebuild_requested_at AS at FROM knowledge_settings WHERE workspace_id = ?').bind(WS).first<{ at: string | null }>())?.at ?? null;

async function expectRebuiltWithoutPlan() {
  await runKnowledgeConsolidate(e, { complete });
  const topic = await getKnowledgeFile(e, WS, 'topics/roadmap.md');
  expect(topic?.content).toContain('from Open roadmap');
  expect(topic?.content).not.toContain('LAUNCH-DATE');
  expect(topic?.content).not.toContain('art_plan');
  expect(await memberSeesRoadmap()).toBe(true);

  const trunk = await knowledgeTrunkForContext(e, WS);
  expect(trunk).toContain('Roadmap work.');
  expect(trunk).not.toContain('LAUNCH-DATE');
  expect((await getKnowledgeFile(e, WS, 'index.md'))?.content).not.toContain('art_plan');
  expect(await requested()).toBeNull();
}

describe('a page that stops being open to every member', () => {
  it('made private: its notes and the overview are withheld at once, then rebuilt without it', async () => {
    expect(await memberSeesRoadmap()).toBe(true);
    expect(await knowledgeTrunkForContext(e, WS)).toContain('LAUNCH-DATE');

    const res = await handleUpdateArtifact(
      new Request('https://shareout.example.com/v1/artifacts/art_plan', { method: 'PATCH', body: JSON.stringify({ visibility: 'private' }) }),
      e, owner, 'art_plan',
    );
    expect(res.status).toBe(200);

    expect(await memberSeesRoadmap()).toBe(false);
    expect(await knowledgeTrunkForContext(e, WS)).toBe('');
    expect(await requested()).not.toBeNull();

    await expectRebuiltWithoutPlan();
  });

  it('moved to the trash: the same', async () => {
    await softDeleteArtifact(e, 'art_plan', 'plan-page');
    expect(await requested()).not.toBeNull();
    expect(await memberSeesRoadmap()).toBe(false);
    expect(await knowledgeTrunkForContext(e, WS)).toBe('');

    await expectRebuiltWithoutPlan();
  });
});
