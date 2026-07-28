// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import * as middleware from '../../../../src/data/middleware';
import { handleDatasets } from '../../../../src/data/datasets/handler';
import {
  ARTIFACT_ID,
  BASE_URL,
  jsonRequest,
  makeCtx,
  makeDatasetEnv,
  sampleDataset,
} from './fixtures';

describe('handleDatasets routing', () => {
  it('returns 404 for unknown routes', async () => {
    const env = makeDatasetEnv();
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/unknown/action`, { method: 'PATCH' }),
      ctx,
      'unknown/action',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('download-url falls back to the Worker stream URL when R2 presign is unconfigured', async () => {
    const env = makeDatasetEnv({ dataset: sampleDataset });
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/download-url`),
      ctx,
      'sales_data/download-url',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { direct: false, url: `/v1/data/${ARTIFACT_ID}/datasets/sales_data/stream` },
    });
  });

  it('returns 403 when owner verification fails for protected routes', async () => {
    vi.spyOn(middleware, 'verifyOwner').mockResolvedValue(false);
    const env = makeDatasetEnv();
    const ctx = makeCtx(env);

    const uploadUrl = await handleDatasets(jsonRequest('POST', 'upload-url', { name: 'x', format: 'json' }), ctx, 'upload-url');
    expect(uploadUrl.status).toBe(403);

    const confirm = await handleDatasets(jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_x' }), ctx, 'sales_data/confirm');
    expect(confirm.status).toBe(403);

    const del = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data`, { method: 'DELETE' }),
      ctx,
      'sales_data',
    );
    expect(del.status).toBe(403);
  });
});
