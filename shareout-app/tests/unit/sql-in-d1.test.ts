// JSON_IN binds an id list as ONE parameter, so lists past D1's 100-bound-param cap
// still run. Exercised on real D1 (Miniflare) through the callers that take unbounded lists.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import { suppressedSet } from '../../src/email/suppressions';
import { filterToSql } from '../../src/data/tables/filter-sql';
import { buildScopeClause } from '../../src/data/tables/scope';
import { attachReactions } from '../../src/data/comments/reactions';
import type { Comment } from '../../src/data/comments/types';
import type { DataContext } from '../../src/data/middleware';
import type { Env } from '../../src/types';

const e = env as unknown as Env;
const n = (k: number) => Array.from({ length: k }, (_, i) => i);

beforeAll(async () => {
  await e.DB.exec("CREATE TABLE IF NOT EXISTS email_suppressions (email TEXT PRIMARY KEY, user_id TEXT, reason TEXT NOT NULL, kind TEXT, created_at TEXT NOT NULL DEFAULT 'x')");
  await e.DB.exec('CREATE TABLE IF NOT EXISTS comment_reactions (id TEXT PRIMARY KEY, artifact_id TEXT NOT NULL, comment_id TEXT NOT NULL, user_id TEXT NOT NULL, emoji TEXT NOT NULL, created_at TEXT NOT NULL)');
  await e.DB.exec('CREATE TABLE IF NOT EXISTS sqlin_rows (id TEXT PRIMARY KEY, data TEXT NOT NULL)');
  await e.DB.batch(n(200).map((i) => e.DB.prepare('INSERT OR REPLACE INTO sqlin_rows (id, data) VALUES (?, ?)')
    .bind(`r${i}`, JSON.stringify({ k: i, tag: `t${i}`, done: i % 2 === 0 }))));
});

describe('JSON_IN on D1', () => {
  it('suppressedSet checks 150 addresses in one query', async () => {
    await e.DB.prepare("INSERT OR IGNORE INTO email_suppressions (email, reason) VALUES ('u7@example.com', 'bounce'), ('u140@example.com', 'bounce')").run();
    const got = await suppressedSet(e, n(150).map((i) => `U${i}@example.com`));
    expect([...got].sort()).toEqual(['u140@example.com', 'u7@example.com']);
  });

  it('table filter $in / $nin and viewer scope accept 150 values, keeping type semantics', async () => {
    const count = async (clause: { sql: string; params: unknown[] }) =>
      (await e.DB.prepare(`SELECT COUNT(*) AS c FROM sqlin_rows WHERE ${clause.sql}`).bind(...clause.params).first<{ c: number }>())!.c;
    expect(await count(filterToSql({ k: { $in: n(150) } }))).toBe(150);
    expect(await count(filterToSql({ k: { $nin: n(150) } }))).toBe(50);
    expect(await count(filterToSql({ tag: { $in: n(150).map((i) => `t${i}`) } }))).toBe(150);
    expect(await count(filterToSql({ done: { $in: [true] } }))).toBe(100);
    expect(await count(filterToSql({ k: { $in: ['1'] } }))).toBe(0);
    expect(await count(buildScopeClause({ field: 'tag', values: n(150).map((i) => `t${i}`) }))).toBe(150);
  });

  it('attachReactions summarises a 150-comment page (the default 100-comment page already overflowed)', async () => {
    await e.DB.prepare("INSERT OR IGNORE INTO comment_reactions VALUES ('rx1', 'art_1', 'c120', 'usr_a', '+1', 'x')").run();
    const comments = n(150).map((i) => ({ id: `c${i}` })) as unknown as Comment[];
    const ctx = { env: e, db: e.DB, artifactId: 'art_1' } as unknown as DataContext;
    await attachReactions(new Request('https://x.test/'), ctx, comments);
    expect(comments[120].reactions).toEqual({ '+1': { count: 1, mine: false } });
    expect(comments[0].reactions).toEqual({});
  });
});
