/**
 * queryNeedsYou mention classification against a real D1 — the CASE uses
 * json_valid/json_each, which a mocked DB cannot tell you parses, let alone that it
 * survives the NULL `mentions` every non-mentioning comment has.
 */
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Env } from '../../../src/types';
import { queryNeedsYou } from '../../../src/pages/home/queries/activity-needs-you';
import { defaultAudiences } from '../../../src/pages/home/events';

const e = env as unknown as Env;
const user = { id: 'usr_me', email: 'me@example.com' };
const vis = { userIds: ['usr_me'], emails: ['me@example.com'] };

beforeAll(async () => {
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, picture TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, slug TEXT, visibility TEXT, owner_id TEXT, workspace_id TEXT, deleted_at TEXT)`,
    `CREATE TABLE IF NOT EXISTS collaborators (artifact_id TEXT, email TEXT)`,
    `CREATE TABLE IF NOT EXISTS asset_buckets (artifact_id TEXT)`,
    `CREATE TABLE IF NOT EXISTS artifact_comments (id TEXT PRIMARY KEY, artifact_id TEXT, parent_id TEXT, author_id TEXT, author_name TEXT, content TEXT, created_at TEXT, resolved INTEGER, mentions TEXT, assignee_user_id TEXT, assignee_email TEXT)`,
  ]) await e.DB.exec(sql);
});

beforeEach(async () => {
  for (const t of ['users', 'artifacts', 'collaborators', 'asset_buckets', 'artifact_comments']) {
    await e.DB.exec(`DELETE FROM ${t}`);
  }
  await e.DB.exec(`INSERT INTO artifacts (id, name, slug, visibility, owner_id) VALUES ('art1','Demo','demo','public','usr_me')`);
});

async function addComment(id: string, mentions: string | null, content: string) {
  await e.DB.prepare(
    `INSERT INTO artifact_comments (id, artifact_id, parent_id, author_id, author_name, content, created_at, resolved, mentions)
     VALUES (?, 'art1', NULL, 'usr_other', 'Other', ?, '2026-07-20T00:00:00.000Z', 0, ?)`
  ).bind(id, content, mentions).run();
}

/** Only the kinds this file cares about; everything else off so no other source runs. */
function audiences(overrides: Record<string, string> = {}) {
  const off = Object.fromEntries(Object.keys(defaultAudiences()).map((k) => [k, 'off']));
  return { ...off, comment: 'members', reply: 'members', mention: 'self', ...overrides } as never;
}

describe('queryNeedsYou mentions', () => {
  it('classifies a comment naming me as a mention, and a plain one as a comment', async () => {
    await addComment('cmt_1', JSON.stringify(['me@example.com']), 'hey @me look');
    await addComment('cmt_2', null, 'unrelated chatter');

    const rows = await queryNeedsYou(e, user, {}, vis as never, audiences());
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId['cmt_1'].kind).toBe('mention');
    expect(byId['cmt_1'].summary).toContain('mentioned you');
    expect(byId['cmt_2'].kind).toBe('comment');
  });

  it('matches case-insensitively and ignores a mention of someone else', async () => {
    await addComment('cmt_1', JSON.stringify(['ME@Example.COM']), 'shouty');
    await addComment('cmt_2', JSON.stringify(['someone@else.com']), 'not for me');

    const rows = await queryNeedsYou(e, user, {}, vis as never, audiences());
    const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

    expect(byId['cmt_1'].kind).toBe('mention');
    expect(byId['cmt_2'].kind).toBe('comment');
  });

  it('surfaces the mention even when comment and reply are turned off', async () => {
    await addComment('cmt_1', JSON.stringify(['me@example.com']), 'still needs you');
    await addComment('cmt_2', null, 'suppressed');

    const rows = await queryNeedsYou(e, user, {}, vis as never, audiences({ comment: 'off', reply: 'off' }));

    expect(rows.map((r) => r.id)).toEqual(['cmt_1']);
  });

  it('tolerates malformed mentions JSON instead of failing the whole feed', async () => {
    await addComment('cmt_1', 'not json at all', 'legacy row');

    const rows = await queryNeedsYou(e, user, {}, vis as never, audiences());

    expect(rows.map((r) => r.kind)).toEqual(['comment']);
  });
});
