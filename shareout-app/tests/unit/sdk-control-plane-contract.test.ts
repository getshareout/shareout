// The SDK's control-plane parser against the real handlers' Responses: these routes answer
// with a bare object, and sdk.lib() / sdk.crew.usage() must get that object, not undefined.
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/types';
import type { AuthUser } from '../../src/api-auth';

vi.mock('../../src/workspaces/roles', () => ({ getInternalWorkspaceRole: vi.fn(async () => 'member') }));

import { handleResolveLibrary } from '../../src/workspace-library';
import { handleGetWorkspaceCrewUsage } from '../../src/router/api/workspace-crew-usage';
import { parseApiResponse } from '../../sdk/src/internal/parse-api-response';

function db(first: (sql: string) => unknown): Env['DB'] {
  return {
    prepare: (sql: string) => ({
      bind: () => ({
        first: async () => first(sql) ?? null,
        all: async () => ({ results: [] }),
      }),
    }),
  } as unknown as Env['DB'];
}

describe('SDK control-plane parser × real handlers', () => {
  it('GET /v1/artifacts/{id}/lib/{name} → { url, version, … }', async () => {
    const env = {
      DB: db((sql) => {
        if (sql.includes('FROM artifacts WHERE id')) return { workspace_id: 'wsp_1', owner_id: 'usr_1' };
        if (sql.includes("scope = 'workspace'")) {
          return { artifact_id: 'art_mod', scope: 'workspace', namespace: 'acme', module_name: 'charts', latest_version: '1.2.0', blocked: 0 };
        }
        return null;
      }),
    } as unknown as Env;
    const res = await handleResolveLibrary(env, 'art_consumer', 'charts');
    const out = await parseApiResponse<{ url: string; version: string }>(res, { bareBody: true });
    expect(out).toMatchObject({ url: '/lib/acme/charts@1.2.0.js', version: '1.2.0' });
  });

  it('GET /v1/workspaces/{id}/crew-usage → { summary, runs, … }', async () => {
    const env = { DB: db((sql) => (sql.includes('COUNT(*) AS runs') ? { runs: 3, cost_micro_usd: 20_000, errors: 1 } : null)) } as unknown as Env;
    const res = await handleGetWorkspaceCrewUsage(
      new Request('https://x.test/v1/workspaces/wsp_1/crew-usage'), env, { id: 'usr_1' } as AuthUser, 'wsp_1',
    );
    const out = await parseApiResponse<{ summary: { runs: number; costUsd: number }; runs: unknown[] }>(res, { bareBody: true });
    expect(out.summary).toMatchObject({ runs: 3, costUsd: 0.02 });
    expect(out.runs).toEqual([]);
  });
});
