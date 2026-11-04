import { describe, expect, it, vi } from 'vitest';
import { handleGetWorkspaceSpend } from '../../src/router/api/workspace-spend';
import type { AuthUser } from '../../src/api-auth';
import type { Env, WorkspaceRole } from '../../src/types';

const user: AuthUser = { id: 'usr_1', email: 'a@acme.co', username: null };
// The nightly ledger's AI rows are stale (and used to double-count the in-page assistant): the
// endpoint must ignore them and read AI live from ai_usage_events.
const ledger = [
  { day: '2026-09-01', workspaceId: 'wsp_1', name: 'Acme', metric: 'ai_llm_tokens', quantity: 900, costMicroUsd: 9_999_999 },
  { day: '2026-09-02', workspaceId: 'wsp_1', name: 'Acme', metric: 'email_sent', quantity: 2, costMicroUsd: 700 },
];
const meter = [
  { day: '2026-09-01', name: 'Acme', llm: 0, n: 3, units: 3, micro: 1_000_000 },
  { day: '2026-09-01', name: 'Acme', llm: 1, n: 2, units: 1200, micro: 500_000 },
];

function env(role: WorkspaceRole | null, workspaceBps: number | null = null) {
  const binds: unknown[][] = [];
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => {
          if (sql.includes('SELECT role FROM workspace_members')) return role ? { role } : null;
          if (sql.includes('instance_bps')) return { instance_bps: null, workspace_bps: workspaceBps };
          return null;
        }),
        all: vi.fn(async () => {
          if (sql.includes('workspace_usage_daily')) {
            binds.push(args);
            return { results: args[0] === '2026-09-01' ? ledger : [] };
          }
          if (sql.includes('FROM ai_usage_events e JOIN workspaces')) {
            binds.push(args);
            return { results: args[1] === '2026-09-01' ? meter : [] };
          }
          return { results: [] };
        }),
      })),
    })),
  };
  return { env: { DB } as unknown as Env, binds };
}

const get = (qs: string) => new Request(`https://shareout.site/v1/workspaces/wsp_1/spend${qs}`);

describe('handleGetWorkspaceSpend', () => {
  it('is admin-only', async () => {
    expect((await handleGetWorkspaceSpend(get('?month=2026-09'), env('member').env, user, 'wsp_1')).status).toBe(403);
    expect((await handleGetWorkspaceSpend(get('?month=2026-09'), env(null).env, user, 'wsp_1')).status).toBe(403);
  });

  it('rejects a malformed month', async () => {
    expect((await handleGetWorkspaceSpend(get('?month=2026-13'), env('admin').env, user, 'wsp_1')).status).toBe(400);
  });

  it('summarizes only this workspace, with the previous month total', async () => {
    const { env: e, binds } = env('owner');
    const res = await handleGetWorkspaceSpend(get('?month=2026-09'), e, user, 'wsp_1');
    expect(res.status).toBe(200);
    const body = await res.json() as { totalMicroUsd: number; days: unknown[]; previous: { month: string; totalMicroUsd: number } };
    expect(body.totalMicroUsd).toBe(1_500_700);
    expect(body.days).toHaveLength(2);
    expect(body.previous).toEqual({ month: '2026-08', totalMicroUsd: 0 });
    expect(binds.every((b) => b.includes('wsp_1'))).toBe(true);
  });

  it('prices AI at the workspace markup from the live meter, infra at list price', async () => {
    const res = await handleGetWorkspaceSpend(get('?month=2026-09'), env('admin', 15_000).env, user, 'wsp_1');
    const body = await res.json() as { totalMicroUsd: number; byMetric: Record<string, { quantity: number; costMicroUsd: number }> };
    expect(body.byMetric.ai_other_events).toEqual({ quantity: 3, costMicroUsd: 1_500_000 });
    expect(body.byMetric.ai_llm_tokens).toEqual({ quantity: 1200, costMicroUsd: 750_000 });
    expect(body.byMetric.email_sent).toEqual({ quantity: 2, costMicroUsd: 700 });
    expect(body.totalMicroUsd).toBe(2_250_700);
  });

  it('downloads the daily CSV', async () => {
    const res = await handleGetWorkspaceSpend(get('?month=2026-09&format=csv'), env('admin').env, user, 'wsp_1');
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect((await res.text()).split('\n').slice(1, 3)).toEqual([
      '2026-09-01,wsp_1,Acme,ai_other_events,3,1.000000',
      '2026-09-01,wsp_1,Acme,ai_llm_tokens,1200,0.500000',
    ]);
  });
});
