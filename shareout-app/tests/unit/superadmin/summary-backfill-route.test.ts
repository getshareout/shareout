// POST /v1/admin/summaries/backfill — super-admin only, one workspace per call.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: string; email: string } | null,
  backfill: vi.fn(async () => ({ processed: 3 })),
}));
vi.mock('../../../src/auth/session', async (orig) => ({
  ...(await orig<object>()),
  getSessionUser: async () => h.session,
}));
vi.mock('../../../src/publish/summary-backfill', () => ({ runSummaryBackfill: h.backfill }));

import { e } from '../helpers/migrated-db';
import { createFetchContext } from '../../../src/router/context';
import { routeAdminApi } from '../../../src/router/api/admin';
import type { Env } from '../../../src/types';

const OPS = { id: 'usr_ops', email: 'ops@example.com' };
const env = { ...e, INSTANCE_ADMIN_EMAILS: OPS.email } as Env;

async function call(query: string, as: { id: string; email: string } | null = OPS) {
  h.session = as;
  const req = new Request(`https://shareout.test/v1/admin/summaries/backfill${query}`, { method: 'POST' });
  return routeAdminApi(createFetchContext(req, env));
}

beforeEach(() => h.backfill.mockClear());

describe('POST /v1/admin/summaries/backfill', () => {
  it('is refused for anyone who is not a platform admin', async () => {
    const res = await call('?workspace_id=wsp_x', { id: 'usr_x', email: 'x@example.com' });
    expect(res!.status).toBe(403);
    expect(h.backfill).not.toHaveBeenCalled();
  });

  it('requires a workspace_id', async () => {
    expect((await call(''))!.status).toBe(400);
    expect(h.backfill).not.toHaveBeenCalled();
  });

  it('runs one batch for that workspace, limit capped at 50', async () => {
    const res = await call('?workspace_id=wsp_incro&limit=500');
    expect(res!.status).toBe(200);
    expect(await res!.json()).toEqual({ processed: 3 });
    expect(h.backfill).toHaveBeenCalledWith(expect.anything(), { workspaceId: 'wsp_incro', limit: 50 });
  });
});
