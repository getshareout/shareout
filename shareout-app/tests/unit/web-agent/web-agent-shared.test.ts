// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

const runAgentTurn = vi.fn();
vi.mock('../../../src/chat-agent/agent-loop', () => ({ runAgentTurn: (...a: unknown[]) => runAgentTurn(...a) }));
vi.mock('../../../src/chat-agent/actions', async (orig) => ({
  ...(await orig<typeof import('../../../src/chat-agent/actions')>()),
  executeAction: vi.fn(async () => 'Shared with x@y.com.'),
}));

import { streamAgentChat, confirmAgentAction } from '../../../src/router/api/web-agent-shared';

const log: string[] = [];
const inserts: unknown[][] = [];

function makeEnv(rows: Array<{ role: string; content: string }> = []): Env {
  const kv = new Map<string, string>();
  const DB = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async () => null,
        all: async () => ({ results: sql.includes('FROM agent_messages') ? [...rows].reverse() : [] }),
        run: async () => {
          if (sql.includes('INSERT INTO agent_messages')) { inserts.push(args); log.push(`insert:${args[2]}`); }
          return { meta: { changes: 1 } };
        },
      }),
    }),
  };
  const RATE_LIMIT_KV = {
    get: async (k: string) => kv.get(k) ?? null,
    put: async (k: string, v: string) => { kv.set(k, v); },
    delete: async (k: string) => { kv.delete(k); },
  };
  return { DB, RATE_LIMIT_KV } as unknown as Env;
}

const user = { id: 'u1' } as AuthUser;

async function events(res: Response): Promise<Array<Record<string, unknown>>> {
  const text = await res.text();
  return text.split('\n\n').filter(Boolean).map((l) => JSON.parse(l.replace(/^data: /, '')));
}

beforeEach(() => { log.length = 0; inserts.length = 0; runAgentTurn.mockReset(); });

describe('streamAgentChat', () => {
  it('saves the user message before the turn runs, so a failed turn keeps it', async () => {
    runAgentTurn.mockImplementation(async () => { log.push('turn'); throw new Error('boom'); });
    const env = makeEnv();

    await events(streamAgentChat(env, { scopeKey: 'ws1', user, selectedWorkspaceId: 'ws1', text: 'hola', threadId: 'wat_1', buildSnapshot: async () => '' }));

    expect(log).toEqual(['insert:user', 'turn']);
  });

  it('does not save a retried message twice or replay it to the model as history', async () => {
    runAgentTurn.mockResolvedValue({ reply: 'ok' });
    const env = makeEnv([{ role: 'user', content: 'hola' }]);

    await events(streamAgentChat(env, { scopeKey: 'ws1', user, selectedWorkspaceId: 'ws1', text: 'hola', threadId: 'wat_1', buildSnapshot: async () => '' }));

    expect(inserts.filter((a) => a[2] === 'user')).toHaveLength(0);
    expect(runAgentTurn.mock.calls[0][1].history).toEqual([]);
  });

  it('remembers a proposal and its confirmed result in the thread', async () => {
    runAgentTurn.mockResolvedValue({
      reply: '',
      proposal: { kind: 'share', artifactId: 'a1', artifactName: 'Deck', emails: ['x@y.com'], role: 'viewer' },
    });
    const env = makeEnv();

    const evs = await events(streamAgentChat(env, { scopeKey: 'ws1', user, selectedWorkspaceId: 'ws1', text: 'share it', threadId: 'wat_1', buildSnapshot: async () => '' }));
    const confirm = evs.find((e) => e.type === 'confirm')!;
    const assistant = inserts.find((a) => a[2] === 'assistant')!;
    expect(assistant[1]).toBe('wat_1');
    expect(assistant[3]).toBe(confirm.prompt);

    const res = await confirmAgentAction(env, 'ws1', user, confirm.token as string);

    expect(await res.json()).toMatchObject({ ok: true, text: 'Shared with x@y.com.' });
    expect(inserts.at(-1)).toEqual([expect.any(String), 'wat_1', 'assistant', 'Shared with x@y.com.']);
  });
});
