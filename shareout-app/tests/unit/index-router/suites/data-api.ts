/**
 * Index router test suite: data api.
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

export function registerDataApiTests(handlers: HandlerMocks): void {
describe('index router — data API early route', () => {
  it('delegates /v1/data/* before OPTIONS handling', async () => {
    const response = await fetchPath('/v1/data/art_1/json/foo', { method: 'OPTIONS' });
    expect(await handlerTag(response)).toBe('handleDataRequest');
    expect(handlers.handleDataRequest).toHaveBeenCalledWith(
      expect.any(Request),
      expect.any(Object),
      '/art_1/json/foo',
      undefined,
    );
  });
});
}
