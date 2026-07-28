/**
 * Index router test suite: enterprise routes.
 * Registered from `index.test.ts` so Vitest hoists `vi.mock` in the entry file.
 */
import { describe, expect, it, vi } from 'vitest';
import type { HandlerMocks } from '../handlers';
import {
  APEX,
  SUB,
  authed,
  createEnv,
  fetchPath,
  handlerTag,
  githubState,
  sheetsState,
} from '../fixtures';

export function registerEnterpriseRoutesTests(handlers: HandlerMocks): void {
describe('index router — enterprise routes', () => {
  // There are no plans in this build, so there is nothing to report or upgrade to.
  it('no longer routes account tier or upgrade', async () => {
    expect((await fetchPath('/v1/account/tier', authed())).status).toBe(404);
    expect((await fetchPath('/v1/account/upgrade', authed({ method: 'POST', body: '{}' }))).status).toBe(404);
  });

  it('dispatches workspace subdomain management by method', async () => {
    const base = '/v1/workspaces/ws_1/subdomain';
    expect(await handlerTag(await fetchPath(base, authed()))).toBe('handleGetSubdomain');
    expect(await handlerTag(await fetchPath(base, authed({ method: 'POST', body: '{}' })))).toBe('handleEnableSubdomain');
    expect(await handlerTag(await fetchPath(base, authed({ method: 'DELETE' })))).toBe('handleDisableSubdomain');
  });
});
}
