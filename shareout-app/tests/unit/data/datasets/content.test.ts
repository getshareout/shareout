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

describe('getDatasetContent', () => {
  it('returns paginated JSON rows with hasMore', async () => {
    const jsonContent = JSON.stringify([
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
    ]);
    const env = makeDatasetEnv(
      { dataset: sampleDataset },
      { getResult: r2Body(jsonContent) },
    );
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/content?offset=1&limit=2`, { method: 'GET' }),
      ctx,
      'sales_data/content',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: { data: unknown[]; total: number; offset: number; limit: number; hasMore: boolean };
    };
    expect(body.data.total).toBe(5);
    expect(body.data.offset).toBe(1);
    expect(body.data.limit).toBe(2);
    expect(body.data.data).toEqual([{ id: 2 }, { id: 3 }]);
    expect(body.data.hasMore).toBe(true);
  });

  it('wraps non-array JSON objects as a single row', async () => {
    const jsonContent = JSON.stringify({ id: 1, value: 'solo' });
    const env = makeDatasetEnv(
      { dataset: sampleDataset },
      { getResult: r2Body(jsonContent) },
    );
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/content`, { method: 'GET' }),
      ctx,
      'sales_data/content',
    );

    const body = await response.json() as { data: { data: unknown[]; total: number } };
    expect(body.data.total).toBe(1);
    expect(body.data.data[0]).toEqual({ id: 1, value: 'solo' });
  });

  it('parses CSV content including quoted fields', async () => {
    const csvContent = 'name,note\nAlice,"hello, world"\nBob,"say ""hi"""\n';
    const csvDataset = { ...sampleDataset, format: 'csv' };
    const env = makeDatasetEnv(
      { dataset: csvDataset },
      { getResult: r2Body(csvContent) },
    );
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/content?limit=10000`, { method: 'GET' }),
      ctx,
      'sales_data/content',
    );

    const body = await response.json() as { data: { data: Array<Record<string, string>>; total: number } };
    expect(body.data.total).toBe(2);
    expect(body.data.data[0]).toEqual({ name: 'Alice', note: 'hello, world' });
    expect(body.data.data[1]).toEqual({ name: 'Bob', note: 'say "hi"' });
  });

  it('caps limit at 10000 and returns errors for missing dataset or R2 file', async () => {
    const missingDataset = makeDatasetEnv({ dataset: null });
    const notFound = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/missing/content`, { method: 'GET' }),
      makeCtx(missingDataset),
      'missing/content',
    );
    expect(notFound.status).toBe(404);

    const missingFile = makeDatasetEnv({ dataset: sampleDataset }, { getResult: null });
    const fileMissing = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/content`, { method: 'GET' }),
      makeCtx(missingFile),
      'sales_data/content',
    );
    expect(fileMissing.status).toBe(404);
    await expect(fileMissing.json()).resolves.toMatchObject({ code: 'DATASET_FILE_MISSING' });

    const env = makeDatasetEnv(
      { dataset: sampleDataset },
      { getResult: r2Body('[]') },
    );
    const capped = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/content?limit=99999`, { method: 'GET' }),
      makeCtx(env),
      'sales_data/content',
    );
    const body = await capped.json() as { data: { limit: number } };
    expect(body.data.limit).toBe(10000);
  });

  it('streams a large dataset and returns only the requested page (008 Stage B1)', async () => {
    // 50k rows — would OOM the old buffer-the-whole-file path; streaming returns one page.
    const rows = Array.from({ length: 50_000 }, (_, i) => ({ id: i }));
    const bigDataset = { ...sampleDataset, size_bytes: 30_000_000 };
    const env = makeDatasetEnv(
      { dataset: bigDataset },
      { getResult: r2Body(JSON.stringify(rows)) },
    );
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/content?offset=49998&limit=10`, { method: 'GET' }),
      makeCtx(env),
      'sales_data/content',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { data: Array<{ id: number }>; total: number; hasMore: boolean } };
    expect(body.data.total).toBe(50_000);
    expect(body.data.data).toEqual([{ id: 49998 }, { id: 49999 }]);
    expect(body.data.hasMore).toBe(false);
  });
});

describe('unsupported formats', () => {
  it('returns empty data for unsupported dataset formats', async () => {
    const unknownFormat = { ...sampleDataset, format: 'xml' };
    const env = makeDatasetEnv(
      { dataset: unknownFormat },
      { getResult: { text: async () => 'raw' } as unknown as R2ObjectBody },
    );
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/content`, { method: 'GET' }),
      ctx,
      'sales_data/content',
    );

    const body = await response.json() as { data: { data: unknown[]; total: number } };
    expect(body.data.data).toEqual([]);
    expect(body.data.total).toBe(0);
  });
});
