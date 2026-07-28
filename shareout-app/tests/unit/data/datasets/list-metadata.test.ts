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

describe('listDatasets', () => {
  it('returns dataset list with count', async () => {
    const env = makeDatasetEnv({
      datasetList: [
        {
          name: 'sales_data',
          format: 'json',
          size_bytes: 100,
          version: 1,
          updated_at: '2026-05-30T14:00:00.000Z',
        },
        {
          name: 'users',
          format: 'csv',
          size_bytes: 200,
          version: 2,
          updated_at: '2026-05-30T15:00:00.000Z',
        },
      ],
    });
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets`, { method: 'GET' }),
      ctx,
      '',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: {
        datasets: Array<{ name: string; format: string; sizeBytes: number }>;
        count: number;
      };
    };
    expect(body.data.count).toBe(2);
    expect(body.data.datasets[0]).toMatchObject({
      name: 'sales_data',
      format: 'json',
      sizeBytes: 100,
      version: 1,
    });
  });
});

describe('getDatasetMetadata', () => {
  it('returns 400 for invalid dataset names', async () => {
    const env = makeDatasetEnv();
    const ctx = makeCtx(env);

    const tooLong = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/${'a'.repeat(65)}`, { method: 'GET' }),
      ctx,
      'a'.repeat(65),
    );
    expect(tooLong.status).toBe(400);
    await expect(tooLong.json()).resolves.toMatchObject({ code: 'INVALID_DATASET_NAME' });

    const badChars = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/bad name`, { method: 'GET' }),
      ctx,
      'bad name',
    );
    expect(badChars.status).toBe(400);
  });

  it('returns 404 when dataset is missing', async () => {
    const env = makeDatasetEnv({ dataset: null });
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/missing`, { method: 'GET' }),
      ctx,
      'missing',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'DATASET_NOT_FOUND' });
  });

  it('returns metadata including parsed JSON metadata', async () => {
    const env = makeDatasetEnv({ dataset: sampleDataset });
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data`, { method: 'GET' }),
      ctx,
      'sales_data',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { metadata: { rowCount: number }; name: string } };
    expect(body.data.name).toBe('sales_data');
    expect(body.data.metadata).toEqual({ rowCount: 2, columns: ['id', 'amount'] });
  });

  it('returns null metadata when none is stored', async () => {
    const env = makeDatasetEnv({
      dataset: { ...sampleDataset, metadata: null },
    });
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data`, { method: 'GET' }),
      ctx,
      'sales_data',
    );

    const body = await response.json() as { data: { metadata: null } };
    expect(body.data.metadata).toBeNull();
  });
});
