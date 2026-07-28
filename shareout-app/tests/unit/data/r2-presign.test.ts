// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { isPresignConfigured, presignGet, presignPut } from '../../../src/data/r2-presign';
import type { Env } from '../../../src/types';

const configured = {
  R2_ACCESS_KEY_ID: 'AKIAEXAMPLE',
  R2_SECRET_ACCESS_KEY: 'secretexamplekey',
  R2_ACCOUNT_ID: 'acct123',
  R2_BUCKET: 'shareout-artifacts',
} as unknown as Env;

const unconfigured = {} as unknown as Env;

describe('r2-presign', () => {
  it('reports configuration state', () => {
    expect(isPresignConfigured(configured)).toBe(true);
    expect(isPresignConfigured(unconfigured)).toBe(false);
  });

  it('returns null when unconfigured (Worker-proxied fallback)', async () => {
    expect(await presignGet(unconfigured, 'art/blobs/x/file.png')).toBeNull();
    expect(await presignPut(unconfigured, 'art/blobs/x/file.png')).toBeNull();
  });

  it('signs a GET URL pointing directly at the R2 S3 endpoint', async () => {
    const url = await presignGet(configured, 'art_1/datasets/sales/upl.json', 120);
    expect(url).toBeTruthy();
    expect(url!).toContain('acct123.r2.cloudflarestorage.com');
    expect(url!).toContain('/shareout-artifacts/art_1/datasets/sales/upl.json');
    expect(url!).toContain('X-Amz-Signature=');
    expect(url!).toContain('X-Amz-Expires=120');
  });

  it('signs a PUT URL for direct-to-R2 upload', async () => {
    const url = await presignPut(configured, 'art_1/blobs/tok/logo.png', 900);
    expect(url).toBeTruthy();
    expect(url!).toContain('X-Amz-Signature=');
    expect(url!).toContain('X-Amz-Expires=900');
  });

  it('encodes each key segment without escaping the path separators', async () => {
    const url = await presignGet(configured, 'art_1/datasets/my data/v 1.json');
    expect(url!).toContain('/art_1/datasets/my%20data/v%201.json');
  });
});
