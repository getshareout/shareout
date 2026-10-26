// GET /v1/workspaces/{id}/knowledge/vectors and POST …/knowledge/vectors/backfill: owner/admin
// only, a clear 501 until the v2 index is bound, a Workflow start where Workflows exist and a
// bounded inline pass where they don't.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
const getInternalWorkspaceRole = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', () => ({ validateToken }));
vi.mock('../../../src/auth/session', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  getSessionUser,
}));
vi.mock('../../../src/workspaces/roles', () => ({ getInternalWorkspaceRole }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { routeKnowledgeApi } from '../../../src/router/api/knowledge';
import { createFetchContext } from '../../../src/router/context';
import { BGE_M3 } from '../../../src/knowledge/vectors/models';
import { fakeAi, FakeVectorize } from '../helpers/fake-vectors';

const WS = 'wsp_vec_routes';
const execCtx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const call = (env: Env, sub: string, method = 'GET', body?: unknown) => routeKnowledgeApi(createFetchContext(
  new Request(`https://shareout.site/v1/workspaces/${WS}/knowledge/${sub}`, {
    method,
    headers: { Cookie: 'shareout_session=x', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  }),
  env, execCtx,
));

beforeAll(async () => {
  await applyMigrations();
});

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: 'usr_vec_admin', email: 'admin@vec.example' });
  getInternalWorkspaceRole.mockReset().mockResolvedValue('admin');
});

describe('knowledge vectors routes', () => {
  it('are for owners and admins', async () => {
    getInternalWorkspaceRole.mockResolvedValue('member');
    expect((await call(e, 'vectors'))!.status).toBe(403);
    expect((await call(e, 'vectors/backfill', 'POST', {}))!.status).toBe(403);
  });

  it('report the configuration and answer 501 to a backfill until v2 is bound', async () => {
    const status = await (await call(e, 'vectors'))!.json() as Record<string, unknown>;
    expect(status).toMatchObject({ read: 'v1', v2: { bound: false, active: false, model: null } });
    const r = (await call(e, 'vectors/backfill', 'POST', {}))!;
    expect(r.status).toBe(501);
    expect(await r.json()).toMatchObject({ code: 'NOT_CONFIGURED' });
  });

  it('start a Workflow where Workflows exist, else run a bounded pass inline', async () => {
    const create = vi.fn(async () => ({}));
    const env = { ...e, AI: fakeAi(), KNOWLEDGE_VECTORS: new FakeVectorize(), KNOWLEDGE_VECTORS_V2: new FakeVectorize(), KNOWLEDGE_INGEST: { create } } as unknown as Env;
    const started = (await call(env, 'vectors/backfill', 'POST', { reset: true }))!;
    expect(started.status).toBe(202);
    expect(await started.json()).toMatchObject({ started: true, instance: expect.stringMatching(new RegExp(`^vectors-${WS}-bge-m3-\\d+-reset$`)) });
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ params: { kind: 'vectors', workspaceId: WS, model: BGE_M3, reset: true } }));

    const inline = (await call({ ...env, KNOWLEDGE_INGEST: undefined } as unknown as Env, 'vectors/backfill', 'POST'))!;
    expect(inline.status).toBe(200);
    expect(await inline.json()).toEqual({ started: false, inline: true, done: true, embedded: 0 });
    expect(await (await call(env, 'vectors'))!.json()).toMatchObject({ v2: { bound: true, active: true, model: BGE_M3 }, read: 'v1' });
  });
});
