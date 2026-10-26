// Semantic artifact search checks access for the artifacts Vectorize returns, instead of
// looking them up among the caller's most recent ones. Runs against the real migrated schema.
import { beforeAll, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import type { Env } from '../../../src/types';
import { semanticSearchArtifacts } from '../../../src/search/semantic';

const user = { id: 'usr_sem', email: 'sem@example.com' };
const other = { id: 'usr_sem_other', email: 'sem-other@example.com' };
const WS = 'wsp_sem';

const artifact = (id: string, owner: string, visibility: string, age: string) =>
  e.DB.prepare(`INSERT INTO artifacts (id, name, slug, owner_id, workspace_id, visibility, created_at)
                VALUES (?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))`).bind(id, id, id.replaceAll('_', '-'), owner, WS, visibility, age);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?), (?, ?, ?)').bind(user.id, user.email, 'Sem', other.id, other.email, 'Other'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Sem WS', 'sem-ws', user.id),
    e.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'owner'), (?, ?, 'member')").bind(WS, user.id, WS, other.id),
    artifact('art_old', other.id, 'workspace', '-30 days'),
    artifact('art_secret', other.id, 'private', '-1 days'),
  ]);
  // 500 pages the caller can open, all newer than art_old.
  const recent = Array.from({ length: 500 }, (_, i) => artifact(`art_recent_${i}`, user.id, 'workspace', `-${i + 1} minutes`));
  for (let i = 0; i < recent.length; i += 100) await e.DB.batch(recent.slice(i, i + 100));
});

it('returns an artifact older than the caller’s 500 most recent, and never one they can’t open', async () => {
  let topK = 0;
  const env = {
    ...e,
    AI: { run: async () => ({ data: [[0.1, 0.2, 0.3]] }) },
    VECTORIZE: {
      query: async (_v: unknown, o: { topK: number }) => {
        topK = o.topK;
        return { matches: [{ id: 'art_secret' }, { id: 'art_old' }, { id: 'art_elsewhere' }, { id: 'art_recent_3' }] };
      },
    },
  } as unknown as Env;
  const found = await semanticSearchArtifacts(env, user.id, 'retention report', { workspaceId: WS });
  expect(found!.map((a) => a.id)).toEqual(['art_old', 'art_recent_3']);
  // The index holds every workspace's artifacts: it is asked for as many as it returns.
  expect(topK).toBe(100);
});
