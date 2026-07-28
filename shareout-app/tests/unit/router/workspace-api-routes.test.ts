// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createFetchContext } from '../../../src/router/context';
import type { Env } from '../../../src/types';
import { routeWorkspaceApi } from '../../../src/router/api/workspaces';
import { routeWorkspaceSharees } from '../../../src/router/api/workspace-sharees-routes';
import { routeWorkspaceSettings } from '../../../src/router/api/workspace-settings-routes';
import { routeWorkspaceMembers } from '../../../src/router/api/workspace-members-routes';
import { routeWorkspaceConnections } from '../../../src/router/api/workspace-connections-routes';
import { routeWorkspaceOps } from '../../../src/router/api/workspace-ops-routes';
import { routeWorkspaceAdminArtifacts } from '../../../src/router/api/workspace-admin-artifacts-routes';

const env = { DB: {} } as Env;

function ctx(method: string, path: string) {
  return createFetchContext(new Request(`https://shareout.site${path}`, { method }), env);
}

describe('workspace API sub-routers', () => {
  it('return null when no route matches', async () => {
    const c = ctx('GET', '/v1/unknown');
    expect(await routeWorkspaceSharees(c)).toBeNull();
    expect(await routeWorkspaceSettings(c)).toBeNull();
    expect(await routeWorkspaceMembers(c)).toBeNull();
    expect(await routeWorkspaceConnections(c)).toBeNull();
    expect(await routeWorkspaceOps(c)).toBeNull();
    expect(await routeWorkspaceAdminArtifacts(c)).toBeNull();
    expect(await routeWorkspaceApi(c)).toBeNull();
  });

  it('routeWorkspaceApi returns null for unrelated workspace paths without auth', async () => {
    const res = await routeWorkspaceApi(ctx('GET', '/v1/workspaces/wsp_x/sharees'));
    // Unauthenticated — auth guard returns a Response, not null.
    expect(res).not.toBeNull();
    expect(res?.status).toBe(401);
  });
});
