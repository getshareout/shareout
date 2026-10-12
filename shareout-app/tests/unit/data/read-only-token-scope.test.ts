// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDataRequest, isReadOnlyPost, shouldBlockAnonWrite } from '../../../src/data/router';
import type { Env } from '../../../src/types';
import { miniDbBinding } from '../helpers/minidb-mock';

const ARTIFACT_ID = 'art_scope_test';
const BASE_URL = 'https://shareout.example.com';

function tokenEnv(scopes: string, visibility = 'workspace'): Env {
  const prepare = vi.fn((sql: string) => ({
    bind: vi.fn(() => ({
      first: vi.fn(async () => {
        if (sql.includes('FROM artifacts WHERE id')) {
          return { id: ARTIFACT_ID, name: 'A', visibility, auth_method: null, workspace_id: 'wsp', owner_id: 'usr_owner' };
        }
        if (sql.includes("principal_type = 'workspace'")) {
          return { token_id: 't1', principal_user_id: 'usr_bot', workspace_id: 'wsp', scopes, subject_external_user_id: null, email: null, username: null };
        }
        return null;
      }),
      all: vi.fn(async () => ({ results: [] })),
      run: vi.fn(async () => ({ success: true, meta: { changes: 0 } })),
    })),
  }));
  const env = {
    SESSION_SECRET: 'session-secret',
    SHAREOUT_BASE_URL: BASE_URL,
    SLUGS: { get: vi.fn(async () => null), put: vi.fn(async () => {}) },
    DB: { prepare },
  } as unknown as Env;
  (env as { MINIDB: unknown }).MINIDB = miniDbBinding((() => env.DB) as () => never);
  return env;
}

function req(path: string, method: string, body?: unknown, auth = true) {
  return new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth ? { Authorization: 'Bearer sot_test' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

afterEach(() => vi.restoreAllMocks());

describe('read-only POST actions are reads', () => {
  it('classifies table query/count/distinct as read-only', () => {
    for (const action of ['query', 'count', 'distinct']) {
      expect(isReadOnlyPost('tables', 'POST', `/orders/${action}`)).toBe(true);
      expect(shouldBlockAnonWrite('tables', 'POST', false, `/orders/${action}`)).toBe(false);
    }
    expect(isReadOnlyPost('tables', 'POST', '/orders')).toBe(false);
    expect(isReadOnlyPost('tables', 'DELETE', '/orders/query')).toBe(false);
    expect(isReadOnlyPost('json', 'POST', '/orders/query')).toBe(false);
    expect(shouldBlockAnonWrite('tables', 'POST', false, '/orders')).toBe(true);
  });

  it('lets a data:read agent token query a table', async () => {
    const res = await handleDataRequest(req('/tables/rows/query', 'POST', {}), tokenEnv('data:read'), `${ARTIFACT_ID}/tables/rows/query`);
    const body = await res.json() as { error?: string };
    expect(res.status).not.toBe(403);
    expect(JSON.stringify(body)).not.toContain('read-only for anonymous');
  });

  it('still refuses table row inserts for a data:read agent token', async () => {
    const res = await handleDataRequest(req('/tables/rows', 'POST', { a: 1 }), tokenEnv('data:read'), `${ARTIFACT_ID}/tables/rows`);
    expect(res.status).toBe(403);
  });
});

describe('comment writes need data:write on agent tokens', () => {
  it('refuses a comment from a data:read token', async () => {
    const res = await handleDataRequest(req('/comments', 'POST', { content: 'hi' }), tokenEnv('data:read'), `${ARTIFACT_ID}/comments`);
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('does not apply the read-only gate to a data:write token', async () => {
    const res = await handleDataRequest(req('/comments', 'POST', { content: 'hi' }), tokenEnv('data:read,data:write'), `${ARTIFACT_ID}/comments`);
    const body = await res.json() as { error?: string };
    expect(JSON.stringify(body)).not.toContain('data:read');
  });
});
