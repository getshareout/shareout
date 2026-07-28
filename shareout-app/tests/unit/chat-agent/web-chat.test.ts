import { describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { describeActionRich, type PendingAction } from '../../../src/chat-agent/actions';
import { D1ConversationStore } from '../../../src/chat-agent/store/d1-store';
import { WebThreadStore } from '../../../src/chat-agent/store/d1-threads';

interface Call { sql: string; args: unknown[] }

/** DB mock that records every prepared statement + its bind args, and serves
 *  per-call results by matching a substring of the SQL. */
function makeDb(results: { match: string; first?: unknown; all?: unknown; run?: unknown }[] = []) {
  const calls: Call[] = [];
  const pick = (sql: string) => results.find((r) => sql.includes(r.match));
  const db = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => {
        calls.push({ sql, args });
        const r = pick(sql);
        return {
          first: vi.fn(async () => r?.first ?? null),
          all: vi.fn(async () => r?.all ?? { results: [] }),
          run: vi.fn(async () => r?.run ?? { meta: { changes: 0 } }),
        };
      }),
    })),
  } as unknown as Env['DB'];
  return { db, calls };
}

describe('describeActionRich', () => {
  it('build → titled card with the page name as subject', () => {
    const a: PendingAction = { kind: 'build_artifact', name: 'Pricing', prompt: 'a pricing page' };
    expect(describeActionRich(a)).toMatchObject({ kind: 'build_artifact', title: 'Build a new page', subject: 'Pricing' });
  });
  it('destructive actions flag danger', () => {
    const a: PendingAction = { kind: 'alert_delete', ruleId: 'r1', label: 'High CPM' };
    const card = describeActionRich(a);
    expect(card.danger).toBe(true);
    expect(card.subject).toBe('High CPM');
  });
  it('share lists the recipient emails', () => {
    const a: PendingAction = { kind: 'share', artifactId: 'a1', artifactName: 'Deck', emails: ['x@y.com'], role: 'viewer' };
    expect(describeActionRich(a).lines).toEqual(['x@y.com']);
  });
});

describe('D1ConversationStore threading', () => {
  it('reads and writes messages under its thread, and bumps the thread updated_at', async () => {
    const { db, calls } = makeDb();
    const store = new D1ConversationStore({ DB: db } as Env, 'ws1', 'u1', 'wat_abc');
    await store.loadHistory(20);
    const load = calls[0];
    expect(load.sql).toContain('thread_id = ?');
    expect(load.args).toContain('wat_abc');

    await store.appendMessage('assistant', 'yo');
    const insert = calls.find((c) => c.sql.includes('INSERT INTO agent_messages'))!;
    expect(insert.args).toContain('wat_abc');
    expect(calls.some((c) => c.sql.includes('UPDATE agent_threads SET updated_at'))).toBe(true);
  });

  it('never writes a timestamp from the app — the column default owns created_at', async () => {
    const { db, calls } = makeDb();
    const store = new D1ConversationStore({ DB: db } as Env, 'ws1', 'u1', 'wat_abc');

    await store.appendMessage('user', 'hi');

    const insert = calls.find((c) => c.sql.includes('INSERT INTO agent_messages'))!;
    expect(insert.sql).not.toContain('created_at');
    expect(insert.args.every((a) => typeof a !== 'number')).toBe(true);
  });
});

describe('WebThreadStore', () => {
  it('create derives a title and truncates past 60 chars', async () => {
    const { db, calls } = makeDb();
    const store = new WebThreadStore({ DB: db } as Env, 'ws1', 'u1');
    const long = 'x'.repeat(80);
    const { title } = await store.create(long);
    expect(title.length).toBe(60);
    expect(title.endsWith('…')).toBe(true);
    const insert = calls.find((c) => c.sql.includes('INSERT INTO agent_threads'))!;
    expect(insert.args).toContain('ws1');
    expect(insert.args).toContain('u1');
  });

  it('rename reports success from the row count', async () => {
    const { db } = makeDb([{ match: 'UPDATE agent_threads SET title', run: { meta: { changes: 1 } } }]);
    const store = new WebThreadStore({ DB: db } as Env, 'ws1', 'u1');
    expect(await store.rename('t1', 'New')).toBe(true);
  });

  it('messages returns null when the thread is not owned', async () => {
    const { db } = makeDb([{ match: 'SELECT 1 FROM agent_threads', first: null }]);
    const store = new WebThreadStore({ DB: db } as Env, 'ws1', 'u1');
    expect(await store.messages('t1', 50)).toBeNull();
  });

  it('messages returns oldest-first turns for an owned thread', async () => {
    const { db } = makeDb([
      { match: 'SELECT 1 FROM agent_threads', first: { 1: 1 } },
      { match: 'SELECT role, content, created_at', all: { results: [
        { role: 'assistant', content: 'b', created_at: 2 },
        { role: 'user', content: 'a', created_at: 1 },
      ] } },
    ]);
    const store = new WebThreadStore({ DB: db } as Env, 'ws1', 'u1');
    const msgs = await store.messages('t1', 50);
    expect(msgs?.map((m) => m.content)).toEqual(['a', 'b']); // reversed to chronological
  });
});
