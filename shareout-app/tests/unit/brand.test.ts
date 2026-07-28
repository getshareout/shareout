import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { BRAND, handleBrandAsset, handleRootBrandAsset } from '../../src/brand';

describe('brand assets', () => {
  it('serves required favicon and logo files from the asset store', async () => {
    for (const file of [
      'favicon.ico',
      'favicon-16.png',
      'favicon-32.png',
      'apple-touch-icon.png',
      'icon-192.png',
      'icon-512.png',
      'logo-mark.png',
      'logo-with-name.png',
    ]) {
      const res = await handleBrandAsset(`/brand/${file}`, env as never);
      expect(res?.status).toBe(200);
      expect(Number(res?.headers.get('Content-Length') ?? '1')).toBeGreaterThan(0);
    }
  });

  it('serves favicon at root and brand paths', async () => {
    const root = await handleRootBrandAsset('/favicon.ico', env as never);
    expect(root?.status).toBe(200);
    expect(root?.headers.get('Content-Type')).toBe('image/x-icon');

    const brand = await handleBrandAsset('/brand/logo-mark.png', env as never);
    expect(brand?.status).toBe(200);
    expect(brand?.headers.get('Content-Type')).toBe('image/png');
  });

  it('returns 404 for unknown brand files', async () => {
    expect((await handleBrandAsset('/brand/missing.png', env as never))?.status).toBe(404);
    expect(await handleRootBrandAsset('/missing.ico', env as never)).toBeNull();
  });

  it('exposes stable public paths', () => {
    expect(BRAND.favicon).toBe('/brand/favicon.ico');
    expect(BRAND.logoWithName).toBe('/brand/logo-with-name.png');
  });
});
