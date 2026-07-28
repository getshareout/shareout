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

describe('streamDataset', () => {
  it('streams JSON with application/json content type', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('[{"id":1}]'));
        controller.close();
      },
    });
    const env = makeDatasetEnv(
      { dataset: sampleDataset },
      { getResult: { body: stream, size: 10 } as unknown as R2ObjectBody },
    );
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/stream`, { method: 'GET' }),
      ctx,
      'sales_data/stream',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(response.headers.get('Content-Length')).toBe('10');
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });

  it('streams CSV with text/csv content type', async () => {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('a,b\n1,2'));
        controller.close();
      },
    });
    const csvDataset = { ...sampleDataset, format: 'csv' };
    const env = makeDatasetEnv(
      { dataset: csvDataset },
      { getResult: { body: stream, size: 7 } as unknown as R2ObjectBody },
    );
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/stream`, { method: 'GET' }),
      ctx,
      'sales_data/stream',
    );

    expect(response.headers.get('Content-Type')).toBe('text/csv');
  });

  it('returns 404 when dataset or file is missing', async () => {
    const missingDataset = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/missing/stream`, { method: 'GET' }),
      makeCtx(makeDatasetEnv({ dataset: null })),
      'missing/stream',
    );
    expect(missingDataset.status).toBe(404);

    const missingFile = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/stream`, { method: 'GET' }),
      makeCtx(makeDatasetEnv({ dataset: sampleDataset }, { getResult: null })),
      'sales_data/stream',
    );
    expect(missingFile.status).toBe(404);
    await expect(missingFile.json()).resolves.toMatchObject({ code: 'DATASET_FILE_MISSING' });
  });
});

describe('streamDataset edge caching (008 Stage A)', () => {
  let cacheStore: Map<string, Response>;
  let putSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    cacheStore = new Map();
    putSpy = vi.fn(async (key: Request, response: Response) => {
      cacheStore.set(key.url, response.clone());
    });
    vi.stubGlobal('caches', {
      default: {
        match: vi.fn(async (key: Request) => cacheStore.get(key.url) ?? null),
        put: putSpy,
      },
    });
  });

  function streamReq() {
    return new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/stream`, { method: 'GET' });
  }
  function r2() {
    const body = new ReadableStream({
      start(c) { c.enqueue(new TextEncoder().encode('[{"id":1}]')); c.close(); },
    });
    return { body, size: 10 } as unknown as R2ObjectBody;
  }

  it('public artifact: reads R2 once, repeat view is an edge-cache hit', async () => {
    const env = makeDatasetEnv({ dataset: sampleDataset }, { getResult: r2() });
    const ctx = makeCtx(env); // public

    const first = await handleDatasets(streamReq(), ctx, 'sales_data/stream');
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toContain('s-maxage=300');
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(1);

    await handleDatasets(streamReq(), ctx, 'sales_data/stream');
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(1);
  });

  it('private artifact: never edge-cached', async () => {
    const env = makeDatasetEnv({ dataset: sampleDataset }, { getResult: r2() });
    const ctx = makeCtx(env);
    ctx.artifact.visibility = 'private';

    const res = await handleDatasets(streamReq(), ctx, 'sales_data/stream');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBeNull();
    await handleDatasets(streamReq(), ctx, 'sales_data/stream');
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(2);
    expect(putSpy).not.toHaveBeenCalled();
  });
});
