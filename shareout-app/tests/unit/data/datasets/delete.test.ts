// @vitest-environment node
import './setup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDatasets } from '../../../../src/data/datasets/handler';
import {
  ARTIFACT_ID,
  BASE_URL,
  jsonRequest,
  makeCtx,
  makeDatasetEnv,
  r2Body,
  sampleDataset,
  sampleToken,
} from './fixtures';

describe('deleteDataset', () => {
  it('returns 404 when dataset does not exist', async () => {
    const env = makeDatasetEnv({ dataset: null });
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/missing`, { method: 'DELETE' }),
      ctx,
      'missing',
    );

    expect(response.status).toBe(404);
    expect(env.ARTIFACTS.delete).not.toHaveBeenCalled();
  });

  it('deletes R2 object and database row on success', async () => {
    const env = makeDatasetEnv({ dataset: sampleDataset });
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data`, { method: 'DELETE' }),
      ctx,
      'sales_data',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { deleted: true } });
    expect(env.ARTIFACTS.delete).toHaveBeenCalledWith(sampleDataset.r2_key);
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('DELETE FROM datasets'));
  });
});
