import { describe, expect, it } from 'vitest';
import { getViewerConfig } from '../../../src/data/viewer-config';

describe('viewer config', () => {
  it('defaults to the header shown', async () => {
    const env = {
      SLUGS: {
        get: async () => null,
        put: async () => {},
      },
      DB: {},
    } as never;

    const config = await getViewerConfig(env, 'art_1');
    expect(config).toEqual({ hide_toolbar: false });
  });

  it('reads hide_toolbar from KV cache', async () => {
    const env = {
      SLUGS: {
        get: async () => JSON.stringify({ hide_toolbar: true }),
        put: async () => {},
      },
      DB: {},
    } as never;

    const config = await getViewerConfig(env, 'art_1');
    expect(config.hide_toolbar).toBe(true);
  });
});
