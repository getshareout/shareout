// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { loadConversationHistory, storeConversationTurn } from '../../../src/editor/chat/index';
import { MAX_TURN_CHARS } from '../../../src/editor/chat/history';
import type { Env } from '../../../src/types';

type Row = { role: string; content: string };

function makeEnv(
  rows: Row[],
  captured?: { sql: string[]; binds: unknown[][] },
  opts: { existingThread?: string | null } = {},
): Env {
  const stmt = (sql: string) => ({
    bind: vi.fn((...args: unknown[]) => {
      captured?.sql.push(sql);
      captured?.binds.push(args);
      return {
        all: vi.fn(async () => ({ results: rows })),
        run: vi.fn(async () => ({ success: true })),
        first: vi.fn(async () =>
          sql.includes('SELECT id FROM agent_threads') && opts.existingThread
            ? { id: opts.existingThread }
            : null,
        ),
      };
    }),
  });
  return {
    DB: {
      prepare: vi.fn(stmt),
      batch: vi.fn(async () => []),
    } as unknown as Env['DB'],
  } as Env;
}

describe('conversation memory', () => {
  it('loads messages chronologically from the editor thread', async () => {
    // Returned newest-first (query is ORDER BY created_at DESC).
    const rows: Row[] = [
      { role: 'assistant', content: 'r2' },
      { role: 'user', content: 'p2' },
      { role: 'assistant', content: 'r1' },
      { role: 'user', content: 'p1' },
    ];
    const msgs = await loadConversationHistory(makeEnv(rows), 'art', 'user');
    expect(msgs).toEqual([
      { role: 'user', content: 'p1' },
      { role: 'assistant', content: 'r1' },
      { role: 'user', content: 'p2' },
      { role: 'assistant', content: 'r2' },
    ]);
  });

  it('reads only this artifact+author editor thread, never another surface', async () => {
    const captured = { sql: [] as string[], binds: [] as unknown[][] };
    await loadConversationHistory(makeEnv([], captured), 'art', 'user');

    expect(captured.sql[0]).toContain("t.scope_type = 'editor'");
    expect(captured.binds[0].slice(0, 2)).toEqual(['art', 'user']);
  });

  it('treats any non-assistant role as user, so alternation stays valid', async () => {
    const rows: Row[] = [{ role: 'system', content: 'sys' }];
    expect(await loadConversationHistory(makeEnv(rows), 'art', 'user')).toEqual([
      { role: 'user', content: 'sys' },
    ]);
  });

  it('returns [] on a database error', async () => {
    const env = { DB: { prepare: vi.fn(() => { throw new Error('db down'); }) } } as unknown as Env;
    expect(await loadConversationHistory(env, 'a', 'u')).toEqual([]);
  });

  it('storeConversationTurn creates the thread, writes both messages, and prunes', async () => {
    const captured = { sql: [] as string[], binds: [] as unknown[][] };
    await storeConversationTurn(makeEnv([], captured), 'art', 'user', 'hello', 'hi there');

    expect(captured.sql.some((s) => s.includes('INSERT INTO agent_threads'))).toBe(true);
    const inserts = captured.sql.filter((s) => s.includes('INSERT INTO agent_messages'));
    expect(inserts.length).toBe(2);
    expect(inserts[0]).toContain("'user'");
    expect(inserts[1]).toContain("'assistant'");
    expect(captured.sql.filter((s) => s.includes('DELETE FROM agent_messages')).length).toBe(1);

    const bodies = captured.binds.flat();
    expect(bodies).toContain('hello');
    expect(bodies).toContain('hi there');
  });

  it('reuses an existing thread instead of creating a second one', async () => {
    const captured = { sql: [] as string[], binds: [] as unknown[][] };
    await storeConversationTurn(makeEnv([], captured, { existingThread: 'ectx_1' }), 'art', 'user', 'hello', 'hi');

    expect(captured.sql.some((s) => s.includes('INSERT INTO agent_threads'))).toBe(false);
    expect(captured.binds.flat()).toContain('ectx_1');
  });

  it('caps each stored message body', async () => {
    const captured = { sql: [] as string[], binds: [] as unknown[][] };
    const long = 'x'.repeat(MAX_TURN_CHARS + 500);
    await storeConversationTurn(makeEnv([], captured), 'art', 'user', long, long);

    const stored = captured.binds.flat().filter((b) => typeof b === 'string' && b.startsWith('xxx'));
    expect(stored.length).toBe(2);
    for (const body of stored) expect((body as string).length).toBe(MAX_TURN_CHARS);
  });
});
