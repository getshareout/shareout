import { describe, expect, it } from 'vitest';
import { getViewerConfig } from '../../../src/data/viewer-config';

describe('viewer config', () => {
  it('defaults to toolbar hidden on mobile, visible on desktop', async () => {
    const env = {
      SLUGS: {
        get: async () => null,
        put: async () => {},
      },
      DB: {},
    } as never;

    const config = await getViewerConfig(env, 'art_1');
    expect(config).toEqual({ hide_toolbar: false, show_on_mobile: false });
  });

  it('reads hide_toolbar from KV cache', async () => {
    const env = {
      SLUGS: {
        get: async () => JSON.stringify({ hide_toolbar: true, show_on_mobile: false }),
        put: async () => {},
      },
      DB: {},
    } as never;

    const config = await getViewerConfig(env, 'art_1');
    expect(config.hide_toolbar).toBe(true);
  });
});
