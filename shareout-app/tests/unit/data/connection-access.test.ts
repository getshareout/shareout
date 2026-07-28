// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { verifyWorkspaceConnectionAccess } from '../../../src/data/middleware';
import type { DataContext } from '../../../src/data/middleware';

function ctx(firstResult: unknown, workspaceId = 'wsp_1'): DataContext {
  return {
    artifactId: 'art_1',
    workspaceId,
    env: {
      DB: {
        prepare: () => ({ bind: () => ({ first: async () => firstResult }) }),
      },
    },
  } as unknown as DataContext;
}

const req = () => new Request('https://shareout.site/v1/data/art_1/platform/x');

describe('verifyWorkspaceConnectionAccess', () => {
  it('denies when the artifact has no workspace', async () => {
    const spy = vi.fn();
    const c = ctx({ is_private: 0 }, '');
    (c.env.DB as unknown as { prepare: () => unknown }).prepare = spy;
    expect(await verifyWorkspaceConnectionAccess(req(), c, 'conn_1')).toBe(false);
    expect(spy).not.toHaveBeenCalled(); // short-circuits before any DB read
  });

  it('denies when the connection is not a workspace platform connection', async () => {
    expect(await verifyWorkspaceConnectionAccess(req(), ctx(null), 'conn_1')).toBe(false);
  });

  it('denies a private (owner-reserved) workspace connection', async () => {
    expect(await verifyWorkspaceConnectionAccess(req(), ctx({ is_private: 1 }), 'conn_1')).toBe(false);
  });

  it('denies an anonymous requester even on a shared connection', async () => {
    // is_private 0 → proceeds to resolve the requester; no auth header/cookie → null → false.
    expect(await verifyWorkspaceConnectionAccess(req(), ctx({ is_private: 0 }), 'conn_1')).toBe(false);
  });
});
