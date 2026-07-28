// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createMiniDb, getMiniDbStub } from '../../../src/data/minidb-client';
import type { Env } from '../../../src/types';

function envWithMiniDb() {
  const calls: Array<{ name: string; body: unknown; workspace: string | null }> = [];
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    calls.push({
      name: lastName,
      body: JSON.parse(init.body as string),
      workspace: new Headers(init.headers).get('X-Workspace-Id'),
    });
    return Response.json({ results: [] });
  });
  let lastName = '';
  const env = {
    MINIDB: {
      idFromName: (name: string) => { lastName = name; return `id:${name}`; },
      get: () => ({ fetch: fetchMock }),
    },
  } as unknown as Env;
  return { env, calls };
}

describe('mini-store partition contract (ADR 28)', () => {
  it('routes the DO by artifactId and carries workspace_id on every call', async () => {
    const { env, calls } = envWithMiniDb();
    const db = createMiniDb(env, 'art_1', 'ws_1');

    await db.prepare('SELECT * FROM artifact_json WHERE artifact_id = ?').bind('art_1').all();

    expect(calls).toHaveLength(1);
    expect(calls[0].name).toBe('art_1');
    expect(calls[0].workspace).toBe('ws_1');
  });

  it('resolves a distinct DO id per artifact', () => {
    const idFromName = vi.fn((name: string) => `id:${name}`);
    const env = { MINIDB: { idFromName, get: vi.fn(() => ({})) } } as unknown as Env;

    getMiniDbStub(env, 'art_a', 'ws_1');
    getMiniDbStub(env, 'art_b', 'ws_1');

    expect(idFromName).toHaveBeenCalledWith('art_a');
    expect(idFromName).toHaveBeenCalledWith('art_b');
  });
});
