// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { handlePlatformRequest } from '../../../../src/data/platform';
import type { DataContext } from '../../../../src/data/middleware';
import {
  ARTIFACT_ID,
  BASE_URL,
  publicArtifactEnv,
  makeDataContext,
  encryptTestCredentials,
  parseJson,
} from './helpers';

async function snowflakeEnv() {
  const { encrypted, iv } = await encryptTestCredentials({
    access_token: '',
    extra: { private_key: 'pk', user: 'U', public_key_fingerprint: 'fp' },
  });
  const row = {
    id: 'conn_sf',
    scope_type: 'artifact',
    scope_id: ARTIFACT_ID,
    name: 'SF',
    provider: 'snowflake',
    config: JSON.stringify({ account: 'acct', warehouse: 'WH', database: 'DB', schema: 'PUBLIC' }),
    encrypted_credentials: encrypted,
    iv,
    preferred_mode: 'proxy',
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };
  return publicArtifactEnv({}, {
    all: () => ({ results: [row] }),
    first: (sql) => (sql.includes("scope_type = 'artifact'") ? row : null),
    run: () => ({ meta: { changes: 1 } }),
  });
}

function scoped(env: Awaited<ReturnType<typeof snowflakeEnv>>, scope: DataContext['viewerScope']): DataContext {
  return { ...makeDataContext(env), workspaceId: 'ws_1', viewerScope: scope };
}

function execReq(statement: string) {
  return new Request(`${BASE_URL}/snowflake/statements.execute/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ connectionId: 'conn_sf', params: { body: { statement } } }),
  });
}

const path = ['snowflake', 'statements.execute', 'execute'];

describe('platform viewer-scope enforcement', () => {
  it('fails closed (403 SCOPE_REQUIRED) when a scoped viewer omits :viewer_scope', async () => {
    const env = await snowflakeEnv();
    const ctx = scoped(env, { field: 'company_id', values: [1, 2] });
    const res = await handlePlatformRequest(execReq('SELECT * FROM sales'), ctx, path);
    expect(res.status).toBe(403);
    const body = await parseJson<{ data: { success: boolean; error?: { code: string } } }>(res);
    expect(body.data.success).toBe(false);
    expect(body.data.error?.code).toBe('SCOPE_REQUIRED');
  });

  it('blocks direct-mode prepare for a scoped viewer', async () => {
    const env = await snowflakeEnv();
    const ctx = scoped(env, { field: 'company_id', values: [1] });
    const res = await handlePlatformRequest(
      new Request(`${BASE_URL}/snowflake/prepare`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ connectionId: 'conn_sf', endpoint: 'statements.execute' }),
      }),
      ctx,
      ['snowflake', 'prepare']
    );
    expect(res.status).toBe(403);
    const body = await parseJson<{ code?: string }>(res);
    expect(body.code).toBe('FORBIDDEN');
  });

  it('blocks unscoped anonymous direct execution', async () => {
    const env = await snowflakeEnv();
    const ctx = { ...makeDataContext(env), workspaceId: 'ws_1' } as DataContext;
    const res = await handlePlatformRequest(execReq('SELECT * FROM sales'), ctx, path);
    expect(res.status).toBe(403);
    const body = await parseJson<{ code?: string }>(res);
    expect(body.code).toBe('FORBIDDEN');
  });

  it('passes the scope gate when :viewer_scope IS present', async () => {
    const env = await snowflakeEnv();
    const ctx = scoped(env, { field: 'company_id', values: [1, 2] });
    const res = await handlePlatformRequest(execReq('SELECT * FROM sales WHERE company_id IN (:viewer_scope)'), ctx, path);
    const body = await parseJson<{ data: { error?: { code: string } } }>(res);
    expect(body.data.error?.code).not.toBe('SCOPE_REQUIRED');
  });
});
