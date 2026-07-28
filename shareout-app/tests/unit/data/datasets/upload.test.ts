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

describe('generateUploadUrl', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:00:00.000Z'));
  });

  it('returns 201 with upload URL on success', async () => {
    const env = makeDatasetEnv();
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      jsonRequest('POST', 'upload-url', { name: 'sales_data', format: 'csv' }),
      ctx,
      'upload-url',
    );

    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: { uploadId: string; uploadUrl: string; maxSize: number; expiresAt: string };
    };
    expect(body.data.uploadId).toBe('upl_test123');
    expect(body.data.uploadUrl).toBe(
      `${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/_upload/upl_test123`,
    );
    expect(body.data.maxSize).toBe(500_000_000);
    expect(body.data.expiresAt).toBe('2026-05-30T14:15:00.000Z');
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO upload_tokens'));
  });

  it('returns 400 for invalid JSON, missing name, invalid name, and invalid format', async () => {
    const env = makeDatasetEnv();
    const ctx = makeCtx(env);

    const invalidJson = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      ctx,
      'upload-url',
    );
    expect(invalidJson.status).toBe(400);
    await expect(invalidJson.json()).resolves.toMatchObject({ code: 'INVALID_JSON' });

    const missingName = await handleDatasets(jsonRequest('POST', 'upload-url', { format: 'json' }), ctx, 'upload-url');
    expect(missingName.status).toBe(400);
    await expect(missingName.json()).resolves.toMatchObject({ code: 'MISSING_PARAM', param: 'name' });

    const badName = await handleDatasets(
      jsonRequest('POST', 'upload-url', { name: 'bad name!', format: 'json' }),
      ctx,
      'upload-url',
    );
    expect(badName.status).toBe(400);
    await expect(badName.json()).resolves.toMatchObject({ code: 'INVALID_DATASET_NAME' });

    const missingFormat = await handleDatasets(jsonRequest('POST', 'upload-url', { name: 'sales_data' }), ctx, 'upload-url');
    expect(missingFormat.status).toBe(400);
    await expect(missingFormat.json()).resolves.toMatchObject({ code: 'INVALID_FORMAT' });

    const badFormat = await handleDatasets(
      jsonRequest('POST', 'upload-url', { name: 'sales_data', format: 'xml' }),
      ctx,
      'upload-url',
    );
    expect(badFormat.status).toBe(400);
    await expect(badFormat.json()).resolves.toMatchObject({ code: 'INVALID_FORMAT' });
  });
});

describe('confirmUpload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:00:00.000Z'));
  });

  it('returns 400 for invalid JSON and missing uploadId', async () => {
    const env = makeDatasetEnv();
    const ctx = makeCtx(env);

    const invalidJson = await handleDatasets(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/sales_data/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{',
      }),
      ctx,
      'sales_data/confirm',
    );
    expect(invalidJson.status).toBe(400);

    const missingId = await handleDatasets(jsonRequest('POST', 'sales_data/confirm', {}), ctx, 'sales_data/confirm');
    expect(missingId.status).toBe(400);
    await expect(missingId.json()).resolves.toMatchObject({ code: 'MISSING_PARAM', param: 'uploadId' });
  });

  it('returns 400 when token is invalid or expired', async () => {
    const envMissing = makeDatasetEnv({ uploadToken: null });
    const missing = await handleDatasets(
      jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_missing' }),
      makeCtx(envMissing),
      'sales_data/confirm',
    );
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({ code: 'UPLOAD_TOKEN_INVALID' });

    vi.setSystemTime(new Date('2026-05-30T15:00:00.000Z'));
    const envExpired = makeDatasetEnv({ uploadToken: sampleToken });
    const expired = await handleDatasets(
      jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_token' }),
      makeCtx(envExpired),
      'sales_data/confirm',
    );
    expect(expired.status).toBe(400);
    await expect(expired.json()).resolves.toMatchObject({ code: 'UPLOAD_TOKEN_EXPIRED' });
  });

  it('returns 400 when file has not been uploaded to R2', async () => {
    const env = makeDatasetEnv({ uploadToken: sampleToken }, { headResult: null });
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_token' }),
      ctx,
      'sales_data/confirm',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'UPLOAD_INCOMPLETE' });
  });

  it('inserts a new dataset record on first confirm', async () => {
    const jsonContent = JSON.stringify([{ id: 1, amount: 10 }, { id: 2, amount: 20 }]);
    const env = makeDatasetEnv(
      { uploadToken: sampleToken, existingDataset: null },
      {
        headResult: { size: jsonContent.length, httpEtag: 'etag-abc' } as R2Object,
        getResult: r2Body(jsonContent),
      },
    );
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_token' }),
      ctx,
      'sales_data/confirm',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { version: number; rowCount: number; columns: string[] } };
    expect(body.data.version).toBe(1);
    expect(body.data.rowCount).toBe(2);
    expect(body.data.columns).toEqual(['id', 'amount']);
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('INSERT INTO datasets'));
  });

  it('updates an existing dataset on re-confirm', async () => {
    const csvContent = 'id,name\n1,Alice\n2,Bob';
    const csvToken = { ...sampleToken, format: 'csv', r2_key: `${ARTIFACT_ID}/datasets/sales_data/upl_token.csv` };
    const env = makeDatasetEnv(
      { uploadToken: csvToken, existingDataset: { id: 'dst_existing', version: 3 } },
      {
        headResult: { size: csvContent.length, httpEtag: 'etag-csv' } as R2Object,
        getResult: r2Body(csvContent),
      },
    );
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_token' }),
      ctx,
      'sales_data/confirm',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { version: number; rowCount: number } };
    expect(body.data.version).toBe(4);
    expect(body.data.rowCount).toBe(2);
    expect(env.DB.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE datasets SET'));
  });

  it('confirms a large multi-row CSV without buffering the whole file (OOM fix)', async () => {
    const ROWS = 50_000;
    const header = 'id,amount\n';
    let csv = header;
    for (let i = 0; i < ROWS; i++) csv += `${i},${i * 10}\n`;
    const csvToken = { ...sampleToken, format: 'csv', r2_key: `${ARTIFACT_ID}/datasets/sales_data/upl_token.csv` };
    const env = makeDatasetEnv(
      { uploadToken: csvToken, existingDataset: null },
      {
        headResult: { size: csv.length, httpEtag: 'etag-big' } as R2Object,
        getResult: r2Body(csv),
      },
    );
    const response = await handleDatasets(
      jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_token' }),
      makeCtx(env),
      'sales_data/confirm',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { rowCount: number; columns: string[] } };
    expect(body.data.rowCount).toBe(ROWS);
    expect(body.data.columns).toEqual(['id', 'amount']);
  });

  it('rejects (413) and deletes the orphan when the file exceeds the instance per-file cap', async () => {
    const env = makeDatasetEnv(
      { uploadToken: sampleToken, existingDataset: null },
      {
        headResult: { size: 30_000_000, httpEtag: 'etag' } as R2Object, // 30MB > the 25MB cap below
        getResult: r2Body('[{"id":1}]'),
      },
    );
    (env as { STORAGE_MAX_FILE_BYTES?: string }).STORAGE_MAX_FILE_BYTES = '25000000';
    const response = await handleDatasets(
      jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_token' }),
      makeCtx(env),
      'sales_data/confirm',
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'FILE_TOO_LARGE' });
    // Orphan R2 object reclaimed.
    expect(env.ARTIFACTS.delete).toHaveBeenCalledWith(sampleToken.r2_key);
  });

  it('defers rowCount (null) but still reports columns for files over the inline cap', async () => {
    const csv = 'id,amount\n1,10\n2,20\n';
    const csvToken = { ...sampleToken, format: 'csv', r2_key: `${ARTIFACT_ID}/datasets/sales_data/upl_token.csv` };
    const env = makeDatasetEnv(
      { uploadToken: csvToken, existingDataset: null },
      {
        // size over the 10MB inline-count cap → confirm reads only the leading window.
        headResult: { size: 20_000_000, httpEtag: 'etag-huge' } as R2Object,
        getResult: r2Body(csv),
      },
    );
    const response = await handleDatasets(
      jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_token' }),
      makeCtx(env),
      'sales_data/confirm',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { rowCount: number | null; columns: string[] } };
    expect(body.data.rowCount).toBeNull();
    expect(body.data.columns).toEqual(['id', 'amount']);
  });
});

describe('extractMetadata error handling via confirm', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:00:00.000Z'));
  });

  it('continues confirm when metadata extraction fails', async () => {
    const env = makeDatasetEnv(
      { uploadToken: sampleToken, existingDataset: null },
      {
        headResult: { size: 14, httpEtag: 'etag' } as R2Object,
        getResult: r2Body('not-valid-json'),
      },
    );
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_token' }),
      ctx,
      'sales_data/confirm',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { version: number; rowCount: number | null } };
    expect(body.data.version).toBe(1);
    expect(body.data.rowCount).toBeNull();
  });

  it('returns empty metadata for unsupported upload formats', async () => {
    const xmlToken = { ...sampleToken, format: 'xml' };
    const env = makeDatasetEnv(
      { uploadToken: xmlToken, existingDataset: null },
      {
        headResult: { size: 4, httpEtag: 'etag' } as R2Object,
        getResult: r2Body('data'),
      },
    );
    const ctx = makeCtx(env);
    const response = await handleDatasets(
      jsonRequest('POST', 'sales_data/confirm', { uploadId: 'upl_token' }),
      ctx,
      'sales_data/confirm',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { version: number; rowCount: number | null } };
    expect(body.data.version).toBe(1);
    expect(body.data.rowCount).toBeNull();
  });
});
