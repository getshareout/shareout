// @vitest-environment node
// The identity-group lookups run as one query (self OR same non-NULL identity_id).
// Real D1 here so the SQL itself is exercised, not a string match.
import { env } from 'cloudflare:workers';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Env } from '../../src/types';
import { getLinkedAccounts, getLinkedUserIds, getVisibilityScope } from '../../src/account-links';
import { getBotVisibilityScope } from '../../src/chat-agent/access';

const e = env as unknown as Env;

beforeAll(async () => {
  await e.DB.exec('CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, picture TEXT, identity_id TEXT, created_at TEXT, disabled INTEGER NOT NULL DEFAULT 0)');
  await e.DB.batch([
    // alice: two linked accounts (work one created first)
    e.DB.prepare('INSERT OR REPLACE INTO users (id, email, name, picture, identity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('usr_alice', 'alice@example.com', 'Alice', null, 'idn_a', '2026-02-01T00:00:00.000Z'),
    e.DB.prepare('INSERT OR REPLACE INTO users (id, email, name, picture, identity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('usr_alice_work', 'alice@acme.example.com', 'Alice W', null, 'idn_a', '2026-01-01T00:00:00.000Z'),
    // dave: linked to a disabled account, which must lend no access
    e.DB.prepare('INSERT OR REPLACE INTO users (id, email, name, picture, identity_id, created_at, disabled) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('usr_dave', 'dave@example.com', 'Dave', null, 'idn_d', '2026-01-04T00:00:00.000Z', 0),
    e.DB.prepare('INSERT OR REPLACE INTO users (id, email, name, picture, identity_id, created_at, disabled) VALUES (?, ?, ?, ?, ?, ?, ?)').bind('usr_dave_off', 'dave@off.example.com', 'Dave Off', null, 'idn_d', '2026-01-05T00:00:00.000Z', 1),
    // bob: no identity group; carol: unrelated NULL-identity user that must never join bob
    e.DB.prepare('INSERT OR REPLACE INTO users (id, email, name, picture, identity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('usr_bob', 'bob@example.com', 'Bob', null, null, '2026-01-02T00:00:00.000Z'),
    e.DB.prepare('INSERT OR REPLACE INTO users (id, email, name, picture, identity_id, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind('usr_carol', 'carol@example.com', 'Carol', null, null, '2026-01-03T00:00:00.000Z'),
  ]);
});

describe('linked-account group lookups', () => {
  it('returns the whole identity group, oldest first, marking the current account', async () => {
    const accounts = await getLinkedAccounts(e, 'usr_alice');
    expect(accounts.map((a) => [a.id, a.is_current])).toEqual([['usr_alice_work', false], ['usr_alice', true]]);
    expect((await getLinkedUserIds(e, 'usr_alice')).sort()).toEqual(['usr_alice', 'usr_alice_work']);
  });

  it('a user without an identity group is a group of one (NULL identity never matches NULL)', async () => {
    expect((await getLinkedAccounts(e, 'usr_bob')).map((a) => a.id)).toEqual(['usr_bob']);
    expect(await getLinkedUserIds(e, 'usr_bob')).toEqual(['usr_bob']);
    expect(await getBotVisibilityScope(e, 'usr_bob')).toEqual({ userIds: ['usr_bob'], emails: ['bob@example.com'] });
  });

  it('leaves a disabled linked account out of the group, but never the caller itself', async () => {
    expect((await getLinkedAccounts(e, 'usr_dave')).map((a) => a.id)).toEqual(['usr_dave']);
    expect(await getLinkedUserIds(e, 'usr_dave')).toEqual(['usr_dave']);
    expect(await getBotVisibilityScope(e, 'usr_dave')).toEqual({ userIds: ['usr_dave'], emails: ['dave@example.com'] });
    expect((await getLinkedUserIds(e, 'usr_dave_off')).sort()).toEqual(['usr_dave', 'usr_dave_off']);
  });

  it('an unknown user still resolves to itself', async () => {
    expect(await getLinkedAccounts(e, 'usr_ghost')).toEqual([]);
    expect(await getLinkedUserIds(e, 'usr_ghost')).toEqual(['usr_ghost']);
    expect(await getBotVisibilityScope(e, 'usr_ghost')).toEqual({ userIds: ['usr_ghost'], emails: [] });
    expect(await getVisibilityScope(e, { id: 'usr_ghost', email: 'ghost@example.com' }))
      .toEqual({ userIds: ['usr_ghost'], emails: ['ghost@example.com'] });
  });

  it('visibility scopes span every linked account', async () => {
    const scope = await getVisibilityScope(e, { id: 'usr_alice', email: 'alice@example.com' });
    expect(scope.userIds.sort()).toEqual(['usr_alice', 'usr_alice_work']);
    expect(scope.emails.sort()).toEqual(['alice@acme.example.com', 'alice@example.com']);
    const bot = await getBotVisibilityScope(e, 'usr_alice');
    expect(bot.userIds.sort()).toEqual(['usr_alice', 'usr_alice_work']);
    expect(bot.emails.sort()).toEqual(['alice@acme.example.com', 'alice@example.com']);
  });
});
