// @vitest-environment node
import './setup';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleDatasetUpload } from '../../../../src/data/datasets/handler';
import {
  ARTIFACT_ID,
  BASE_URL,
  makeCtx,
  makeDatasetEnv,
  sampleToken,
} from './fixtures';

describe('handleDatasetUpload', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:00:00.000Z'));
  });

  it('returns 405 when method is not PUT', async () => {
    const env = makeDatasetEnv();
    const ctx = makeCtx(env);
    const response = await handleDatasetUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/_upload/upl_token`, { method: 'POST' }),
      ctx,
      'upl_token',
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });

  it('returns 400 for invalid or expired upload tokens', async () => {
    const invalid = await handleDatasetUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/_upload/upl_missing`, {
        method: 'PUT',
        headers: { 'Content-Length': '4' },
        body: 'data',
      }),
      makeCtx(makeDatasetEnv({ uploadToken: null })),
      'upl_missing',
    );
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({ code: 'UPLOAD_TOKEN_INVALID' });

    vi.setSystemTime(new Date('2026-05-30T15:00:00.000Z'));
    const expired = await handleDatasetUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/_upload/upl_token`, {
        method: 'PUT',
        headers: { 'Content-Length': '4' },
        body: 'data',
      }),
      makeCtx(makeDatasetEnv({ uploadToken: sampleToken })),
      'upl_token',
    );
    expect(expired.status).toBe(400);
    await expect(expired.json()).resolves.toMatchObject({ code: 'UPLOAD_TOKEN_EXPIRED' });
  });

  it('returns 413 when content exceeds max dataset size', async () => {
    const env = makeDatasetEnv({ uploadToken: sampleToken });
    const ctx = makeCtx(env);
    const response = await handleDatasetUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/_upload/upl_token`, {
        method: 'PUT',
        headers: { 'Content-Length': String(500_000_001) },
        body: 'x',
      }),
      ctx,
      'upl_token',
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('stores uploaded JSON content in R2', async () => {
    const env = makeDatasetEnv({ uploadToken: sampleToken });
    const ctx = makeCtx(env);
    const fileBody = '[{"id":1}]';
    const response = await handleDatasetUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/_upload/upl_token`, {
        method: 'PUT',
        headers: { 'Content-Length': String(fileBody.length) },
        body: fileBody,
      }),
      ctx,
      'upl_token',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: { uploaded: true, r2Key: sampleToken.r2_key },
    });
    expect(env.ARTIFACTS.put).toHaveBeenCalledWith(
      sampleToken.r2_key,
      expect.any(ReadableStream),
      { httpMetadata: { contentType: 'application/json' } },
    );
  });

  it('uses text/csv content type for CSV uploads', async () => {
    const csvToken = { ...sampleToken, format: 'csv' };
    const env = makeDatasetEnv({ uploadToken: csvToken });
    const ctx = makeCtx(env);
    const fileBody = 'a,b\n1,2';
    await handleDatasetUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/_upload/upl_token`, {
        method: 'PUT',
        headers: { 'Content-Length': String(fileBody.length) },
        body: fileBody,
      }),
      ctx,
      'upl_token',
    );

    expect(env.ARTIFACTS.put).toHaveBeenCalledWith(
      csvToken.r2_key,
      expect.any(ReadableStream),
      { httpMetadata: { contentType: 'text/csv' } },
    );
  });
});
