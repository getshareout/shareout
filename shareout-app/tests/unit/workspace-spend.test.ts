import { describe, expect, it, vi } from 'vitest';
import { handleGetWorkspaceSpend } from '../../src/router/api/workspace-spend';
import type { AuthUser } from '../../src/api-auth';
import type { Env, WorkspaceRole } from '../../src/types';

const user: AuthUser = { id: 'usr_1', email: 'a@acme.co', username: null };
const ledger = [
  { day: '2026-09-01', workspaceId: 'wsp_1', name: 'Acme', metric: 'ai_other_events', quantity: 3, costMicroUsd: 1_500_000 },
  { day: '2026-09-02', workspaceId: 'wsp_1', name: 'Acme', metric: 'email_sent', quantity: 2, costMicroUsd: 700 },
];

function env(role: WorkspaceRole | null) {
  const binds: unknown[][] = [];
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => (sql.includes('SELECT role FROM workspace_members') && role ? { role } : null)),
        all: vi.fn(async () => {
          if (!sql.includes('workspace_usage_daily')) return { results: [] };
          binds.push(args);
          return { results: args[0] === '2026-09-01' ? ledger : [] };
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
    expect(binds.every((b) => b[2] === 'wsp_1')).toBe(true);
  });

  it('downloads the daily CSV', async () => {
    const res = await handleGetWorkspaceSpend(get('?month=2026-09&format=csv'), env('admin').env, user, 'wsp_1');
    expect(res.headers.get('Content-Type')).toContain('text/csv');
    expect((await res.text()).split('\n')[1]).toBe('2026-09-01,wsp_1,Acme,ai_other_events,3,1.500000');
  });
});
