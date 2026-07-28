// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleBlobs, handleBlobUpload } from '../../../src/data/blobs/handler';
import type { DataContext } from '../../../src/data/middleware';
import type { Env } from '../../../src/types';

const ARTIFACT_ID = 'art_test';
const BASE_URL = 'https://shareout.example.com';
const ORIGIN = 'https://app.example.com';

interface UploadTokenRow {
  id: string;
  artifact_id: string;
  filename: string;
  mime_type: string;
  r2_key: string;
  max_size: number;
  expires_at: string;
  used_at: string | null;
}

interface BlobRow {
  id: string;
  artifact_id: string;
  filename: string;
  mime_type: string;
  r2_key: string;
  size_bytes: number;
  created_at: string;
}

type DbScenario = {
  storage?: { artifact_id: string; used_bytes: number; blob_count: number } | null;
  uploadToken?: UploadTokenRow | null;
  blob?: BlobRow | null;
  blobList?: BlobRow[];
  blobCount?: number;
};

function makeR2Mock(options: {
  getResult?: R2ObjectBody | null;
  putImpl?: (...args: unknown[]) => Promise<void>;
  deleteImpl?: (...args: unknown[]) => Promise<void>;
} = {}): Env['ARTIFACTS'] {
  return {
    put: vi.fn(options.putImpl ?? (async () => undefined)),
    get: vi.fn(async () => options.getResult ?? null),
    delete: vi.fn(options.deleteImpl ?? (async () => undefined)),
  } as unknown as Env['ARTIFACTS'];
}

function makeBlobEnv(
  scenario: DbScenario = {},
  r2Options: Parameters<typeof makeR2Mock>[0] = {},
  options: { bindCaptures?: Array<{ sql: string; args: unknown[] }> } = {},
): Env {
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => {
        options.bindCaptures?.push({ sql, args: bindArgs });
        return {
          first: vi.fn(async () => dbFirst(sql, bindArgs, scenario)),
          all: vi.fn(async () => ({
            results: scenario.blobList ?? [],
          })),
          run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
        };
      }),
    })),
    batch: vi.fn(async () => [{ success: true }]),
  } as unknown as Env['DB'];

  return {
    DB,
    ARTIFACTS: makeR2Mock(r2Options),
  } as Env;
}

function dbFirst(sql: string, args: unknown[], scenario: DbScenario): unknown {
  if (sql.includes('FROM artifact_storage') || sql.includes('INTO artifact_storage') || sql.includes('UPDATE artifact_storage')) {
    if (scenario.storage === null) return null;
    if (scenario.storage) return scenario.storage;
    return null;
  }
  if (sql.includes('upload_tokens')) {
    return scenario.uploadToken ?? null;
  }
  if (sql.includes('FROM blobs') && sql.includes('COUNT(*)')) {
    return { count: scenario.blobCount ?? scenario.blobList?.length ?? 0 };
  }
  if (sql.includes('FROM blobs')) {
    if (scenario.blob && args.includes(scenario.blob.id)) {
      return scenario.blob;
    }
    return scenario.blob ?? null;
  }
  return null;
}

function makeCtx(env: Env, origin: string | null = ORIGIN): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    artifact: {
      id: ARTIFACT_ID,
      name: 'Test Artifact',
      visibility: 'public',
      auth_method: null,
    },
    env,
    origin,
  };
}

function uploadRequest(body: unknown, init: RequestInit = {}): Request {
  const headers = new Headers(init.headers ?? {});
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  return new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/upload`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...init,
  });
}

function validUploadBody(overrides: Record<string, unknown> = {}) {
  return {
    filename: 'photo.png',
    mimeType: 'image/png',
    size: 1024,
    ...overrides,
  };
}

const sampleBlob: BlobRow = {
  id: 'blob_abc',
  artifact_id: ARTIFACT_ID,
  filename: 'photo.png',
  mime_type: 'image/png',
  r2_key: `${ARTIFACT_ID}/blobs/upl_token/photo.png`,
  size_bytes: 1024,
  created_at: '2026-05-30T14:00:00.000Z',
};

const sampleToken: UploadTokenRow = {
  id: 'upl_token',
  artifact_id: ARTIFACT_ID,
  filename: 'photo.png',
  mime_type: 'image/png',
  r2_key: `${ARTIFACT_ID}/blobs/upl_token/photo.png`,
  max_size: 50_000_000,
  expires_at: '2026-05-30T14:15:00.000Z',
  used_at: null,
};

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('handleBlobs routing', () => {
  it('returns 404 for unknown blob routes', async () => {
    const env = makeBlobEnv();
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/unknown/action`, { method: 'PATCH' }),
      ctx,
      'unknown/action',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('403s a private deliverable blob on the raw content route (work/042 P3)', async () => {
    // The raw per-bucket route can't authenticate a viewer, so a private File must be
    // refused here and fetched through /v1/files/:id/content instead.
    const env = makeBlobEnv({ blob: { ...sampleBlob, deliverable_visibility: 'private' } as unknown as BlobRow });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/${sampleBlob.id}/content`),
      ctx,
      `${sampleBlob.id}/content`,
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({ code: 'FORBIDDEN' });
  });

  it('download-url falls back to the Worker content URL when R2 presign is unconfigured', async () => {
    const env = makeBlobEnv({ blob: sampleBlob });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/${sampleBlob.id}/download-url`),
      ctx,
      `${sampleBlob.id}/download-url`,
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { direct: false, url: `/v1/data/${ARTIFACT_ID}/blobs/${sampleBlob.id}/content` },
    });
  });
});

describe('requestUpload — upload URL generation', () => {
  it('returns 201 with upload URL and token metadata', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:00:00.000Z'));

    const env = makeBlobEnv({ storage: null });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      uploadRequest(validUploadBody()),
      ctx,
      'upload',
    );

    expect(response.status).toBe(201);
    const body = await response.json() as {
      success: boolean;
      data: {
        uploadUrl: string;
        tokenId: string;
        expiresAt: string;
        maxSize: number;
      };
    };
    expect(body.success).toBe(true);
    expect(body.data.tokenId).toMatch(/^upl_/);
    expect(body.data.uploadUrl).toBe(
      `${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/_upload/${body.data.tokenId}`,
    );
    expect(body.data.expiresAt).toBe('2026-05-30T14:15:00.000Z');
    expect(body.data.maxSize).toBe(1024);
    expect(env.DB.prepare).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO upload_tokens'),
    );
  });

  it('defaults size to MAX_FILE_SIZE when omitted', async () => {
    const env = makeBlobEnv({ storage: null });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      uploadRequest({ filename: 'notes.txt', mimeType: 'text/plain' }),
      ctx,
      'upload',
    );

    expect(response.status).toBe(201);
    const body = await response.json() as { data: { maxSize: number } };
    expect(body.data.maxSize).toBe(50_000_000);
  });
});

describe('requestUpload — validation errors', () => {
  it('returns 400 for invalid JSON', async () => {
    const env = makeBlobEnv();
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/upload`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'not-json',
      }),
      ctx,
      'upload',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'INVALID_JSON' });
  });

  it('returns 400 when filename is missing', async () => {
    const env = makeBlobEnv();
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      uploadRequest({ mimeType: 'image/png' }),
      ctx,
      'upload',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'MISSING_PARAM',
      param: 'filename',
    });
  });

  it('returns 400 for invalid filenames and blocked extensions', async () => {
    const env = makeBlobEnv();
    const ctx = makeCtx(env);

    const pathTraversal = await handleBlobs(
      uploadRequest(validUploadBody({ filename: '../secret.png' })),
      ctx,
      'upload',
    );
    expect(pathTraversal.status).toBe(400);
    await expect(pathTraversal.json()).resolves.toMatchObject({ code: 'INVALID_FILENAME' });

    const blockedExt = await handleBlobs(
      uploadRequest(validUploadBody({ filename: 'malware.exe' })),
      ctx,
      'upload',
    );
    expect(blockedExt.status).toBe(400);
    await expect(blockedExt.json()).resolves.toMatchObject({
      code: 'INVALID_FILENAME',
      error: 'File type not allowed',
    });

    const badChars = await handleBlobs(
      uploadRequest(validUploadBody({ filename: 'file@name.png' })),
      ctx,
      'upload',
    );
    expect(badChars.status).toBe(400);
    await expect(badChars.json()).resolves.toMatchObject({ code: 'INVALID_FILENAME' });
  });

  it('returns 400 when mimeType is missing or disallowed', async () => {
    const env = makeBlobEnv();
    const ctx = makeCtx(env);

    const missing = await handleBlobs(
      uploadRequest({ filename: 'photo.png' }),
      ctx,
      'upload',
    );
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({
      code: 'MISSING_PARAM',
      param: 'mimeType',
    });

    const disallowed = await handleBlobs(
      uploadRequest(validUploadBody({ mimeType: 'application/javascript' })),
      ctx,
      'upload',
    );
    expect(disallowed.status).toBe(400);
    await expect(disallowed.json()).resolves.toMatchObject({ code: 'INVALID_MIME_TYPE' });
  });

  it('returns 413 when requested file size exceeds the per-file limit', async () => {
    const env = makeBlobEnv();
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      uploadRequest(validUploadBody({ size: 50_000_001 })),
      ctx,
      'upload',
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('returns 400 when blob count limit is reached', async () => {
    const env = makeBlobEnv({
      storage: { artifact_id: ARTIFACT_ID, used_bytes: 0, blob_count: 1000 },
    });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      uploadRequest(validUploadBody()),
      ctx,
      'upload',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'BLOB_LIMIT_EXCEEDED' });
  });

  it('returns 413 when storage quota would be exceeded', async () => {
    const env = makeBlobEnv({
      storage: { artifact_id: ARTIFACT_ID, used_bytes: 499_999_000, blob_count: 1 },
    });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      uploadRequest(validUploadBody({ size: 2_000_000 })),
      ctx,
      'upload',
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'STORAGE_LIMIT_EXCEEDED' });
  });
});

describe('handleBlobUpload — confirm upload flow', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-30T14:00:00.000Z'));
  });

  it('returns 405 when method is not PUT', async () => {
    const env = makeBlobEnv();
    const ctx = makeCtx(env);
    const response = await handleBlobUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/_upload/upl_token`, { method: 'POST' }),
      ctx,
      'upl_token',
    );

    expect(response.status).toBe(405);
    await expect(response.json()).resolves.toMatchObject({ code: 'METHOD_NOT_ALLOWED' });
  });

  it('returns 400 when upload token is invalid or already used', async () => {
    const env = makeBlobEnv({ uploadToken: null });
    const ctx = makeCtx(env);
    const response = await handleBlobUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/_upload/upl_missing`, {
        method: 'PUT',
        headers: { 'Content-Length': '10' },
        body: '0123456789',
      }),
      ctx,
      'upl_missing',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'UPLOAD_TOKEN_INVALID' });
  });

  it('returns 400 when upload token is expired', async () => {
    vi.setSystemTime(new Date('2026-05-30T15:00:00.000Z'));

    const env = makeBlobEnv({
      uploadToken: {
        ...sampleToken,
        expires_at: '2026-05-30T14:15:00.000Z',
      },
    });
    const ctx = makeCtx(env);
    const response = await handleBlobUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/_upload/upl_token`, {
        method: 'PUT',
        headers: { 'Content-Length': '4' },
        body: 'data',
      }),
      ctx,
      'upl_token',
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: 'UPLOAD_TOKEN_EXPIRED' });
  });

  it('returns 413 when uploaded content exceeds token max_size', async () => {
    const env = makeBlobEnv({
      uploadToken: { ...sampleToken, max_size: 100 },
      storage: null,
    });
    const ctx = makeCtx(env);
    const response = await handleBlobUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/_upload/upl_token`, {
        method: 'PUT',
        headers: { 'Content-Length': '500' },
        body: 'x'.repeat(500),
      }),
      ctx,
      'upl_token',
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('returns 413 when upload would exceed artifact storage quota', async () => {
    const env = makeBlobEnv({
      uploadToken: sampleToken,
      storage: { artifact_id: ARTIFACT_ID, used_bytes: 499_999_000, blob_count: 1 },
    });
    const ctx = makeCtx(env);
    const response = await handleBlobUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/_upload/upl_token`, {
        method: 'PUT',
        headers: { 'Content-Length': '2000' },
        body: 'x'.repeat(2000),
      }),
      ctx,
      'upl_token',
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'STORAGE_LIMIT_EXCEEDED' });
  });

  it('returns 413 when upload exceeds the instance per-file cap', async () => {
    // token + per-artifact limits pass; STORAGE_MAX_FILE_BYTES rejects.
    const env = makeBlobEnv({
      uploadToken: { ...sampleToken, max_size: 600_000_000 },
      storage: null,
    });
    (env as { STORAGE_MAX_FILE_BYTES?: string }).STORAGE_MAX_FILE_BYTES = '25000000';
    const response = await handleBlobUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/_upload/upl_token`, {
        method: 'PUT',
        headers: { 'Content-Length': String(30_000_000) }, // 30MB > 25MB free file cap
        body: 'x',
      }),
      makeCtx(env),
      'upl_token',
    );

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({ code: 'FILE_TOO_LARGE' });
  });

  it('stores content in R2 and records blob metadata on success', async () => {
    const env = makeBlobEnv({
      uploadToken: sampleToken,
      storage: { artifact_id: ARTIFACT_ID, used_bytes: 1000, blob_count: 2 },
    });
    const ctx = makeCtx(env);
    const fileBody = 'image-bytes';
    const response = await handleBlobUpload(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/_upload/upl_token`, {
        method: 'PUT',
        headers: { 'Content-Length': String(fileBody.length) },
        body: fileBody,
      }),
      ctx,
      'upl_token',
    );

    expect(response.status).toBe(201);
    const body = await response.json() as {
      data: {
        id: string;
        filename: string;
        mimeType: string;
        sizeBytes: number;
        createdAt: string;
      };
    };
    expect(body.data.id).toMatch(/^blob_/);
    expect(body.data).toMatchObject({
      filename: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: fileBody.length,
      createdAt: '2026-05-30T14:00:00.000Z',
    });
    expect(env.ARTIFACTS.put).toHaveBeenCalledWith(
      sampleToken.r2_key,
      expect.any(ArrayBuffer),
      { httpMetadata: { contentType: 'image/png' } },
    );
    expect(env.DB.batch).toHaveBeenCalledTimes(1);
  });
});

describe('listBlobs', () => {
  it('returns paginated blob list with total count', async () => {
    const blobs = [
      sampleBlob,
      { ...sampleBlob, id: 'blob_def', filename: 'clip.mp4', mime_type: 'video/mp4' },
    ];
    const env = makeBlobEnv({ blobList: blobs, blobCount: 2 });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs?limit=10&offset=0`, { method: 'GET' }),
      ctx,
      '',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as {
      data: {
        blobs: Array<{ id: string; filename: string; mimeType: string }>;
        total: number;
        limit: number;
        offset: number;
      };
    };
    expect(body.data.total).toBe(2);
    expect(body.data.limit).toBe(10);
    expect(body.data.offset).toBe(0);
    expect(body.data.blobs).toHaveLength(2);
    expect(body.data.blobs[0]).toMatchObject({
      id: 'blob_abc',
      filename: 'photo.png',
      mimeType: 'image/png',
      sizeBytes: 1024,
    });
  });

  it('caps limit at 1000 and defaults pagination params', async () => {
    const env = makeBlobEnv({ blobList: [], blobCount: 0 });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs?limit=5000`, { method: 'GET' }),
      ctx,
      '',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { limit: number; offset: number } };
    expect(body.data.limit).toBe(1000);
    expect(body.data.offset).toBe(0);
  });
});

describe('getBlobMetadata and getBlobContent', () => {
  it('returns 404 when blob metadata is missing', async () => {
    const env = makeBlobEnv({ blob: null });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/blob_missing`, { method: 'GET' }),
      ctx,
      'blob_missing',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'BLOB_NOT_FOUND' });
  });

  it('returns blob metadata with content URL on success', async () => {
    const env = makeBlobEnv({ blob: sampleBlob });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/blob_abc`, { method: 'GET' }),
      ctx,
      'blob_abc',
    );

    expect(response.status).toBe(200);
    const body = await response.json() as { data: { contentUrl: string; filename: string } };
    expect(body.data.filename).toBe('photo.png');
    expect(body.data.contentUrl).toBe(`/v1/data/${ARTIFACT_ID}/blobs/blob_abc/content`);
  });

  it('returns 404 when blob content is requested for a missing blob', async () => {
    const env = makeBlobEnv({ blob: null });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/blob_missing/content`, { method: 'GET' }),
      ctx,
      'blob_missing/content',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'BLOB_NOT_FOUND' });
  });

  it('returns 404 when blob content metadata exists but R2 object is missing', async () => {
    const env = makeBlobEnv({ blob: sampleBlob }, { getResult: null });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/blob_abc/content`, { method: 'GET' }),
      ctx,
      'blob_abc/content',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'BLOB_FILE_MISSING' });
  });

  it('streams blob content from R2 with cache headers', async () => {
    const r2Body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('png-data'));
        controller.close();
      },
    });
    const env = makeBlobEnv(
      { blob: sampleBlob },
      {
        getResult: {
          body: r2Body,
        } as unknown as R2ObjectBody,
      },
    );
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/blob_abc/content`, { method: 'GET' }),
      ctx,
      'blob_abc/content',
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('image/png');
    expect(response.headers.get('Content-Length')).toBe('1024');
    expect(response.headers.get('Cache-Control')).toContain('immutable');
    await expect(response.arrayBuffer()).resolves.toEqual(new TextEncoder().encode('png-data').buffer);
  });
});

describe('getBlobContent edge caching (008 Stage A)', () => {
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

  function r2Body(text = 'png-data') {
    return new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(text));
        controller.close();
      },
    });
  }

  function contentRequest() {
    return new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/blob_abc/content`, { method: 'GET' });
  }

  it('public artifact: reads R2 once, serves the repeat view from the edge cache', async () => {
    const env = makeBlobEnv({ blob: sampleBlob }, { getResult: { body: r2Body() } as unknown as R2ObjectBody });
    const ctx = makeCtx(env); // visibility: public

    const first = await handleBlobs(contentRequest(), ctx, 'blob_abc/content');
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).toContain('s-maxage=300');
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(1);
    expect(putSpy).toHaveBeenCalledTimes(1);

    const second = await handleBlobs(contentRequest(), ctx, 'blob_abc/content');
    expect(second.status).toBe(200);
    // Cache hit — no second R2 read.
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(1);
  });

  it('private artifact: never edge-cached, R2 read on every request', async () => {
    const env = makeBlobEnv({ blob: sampleBlob }, { getResult: { body: r2Body() } as unknown as R2ObjectBody });
    const ctx = makeCtx(env);
    ctx.artifact.visibility = 'private';

    const first = await handleBlobs(contentRequest(), ctx, 'blob_abc/content');
    expect(first.status).toBe(200);
    expect(first.headers.get('Cache-Control')).not.toContain('s-maxage');

    await handleBlobs(contentRequest(), ctx, 'blob_abc/content');
    expect(env.ARTIFACTS.get).toHaveBeenCalledTimes(2);
    expect(putSpy).not.toHaveBeenCalled();
  });

  it('public artifact with missing R2 object returns 404 and does not cache', async () => {
    const env = makeBlobEnv({ blob: sampleBlob }, { getResult: null });
    const ctx = makeCtx(env);

    const res = await handleBlobs(contentRequest(), ctx, 'blob_abc/content');
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toMatchObject({ code: 'BLOB_FILE_MISSING' });
    expect(putSpy).not.toHaveBeenCalled();
  });
});

describe('deleteBlob error paths', () => {
  it('returns 404 when deleting a missing blob', async () => {
    const env = makeBlobEnv({ blob: null });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/blob_missing`, { method: 'DELETE' }),
      ctx,
      'blob_missing',
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({ code: 'BLOB_NOT_FOUND' });
    expect(env.ARTIFACTS.delete).not.toHaveBeenCalled();
  });

  it('deletes R2 object and updates storage counters on success', async () => {
    const env = makeBlobEnv({ blob: sampleBlob });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/blob_abc`, { method: 'DELETE' }),
      ctx,
      'blob_abc',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ success: true, data: { deleted: true } });
    expect(env.ARTIFACTS.delete).toHaveBeenCalledWith(sampleBlob.r2_key);
    expect(env.DB.batch).toHaveBeenCalledTimes(1);
  });
});

describe('getStorageUsage', () => {
  it('returns usage limits and available bytes', async () => {
    const env = makeBlobEnv({
      storage: { artifact_id: ARTIFACT_ID, used_bytes: 1_000_000, blob_count: 3 },
    });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/storage`, { method: 'GET' }),
      ctx,
      'storage',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        usedBytes: 1_000_000,
        blobCount: 3,
        maxBytes: 500_000_000,
        maxBlobs: 1000,
        availableBytes: 499_000_000,
      },
    });
  });

  it('returns zero usage when no storage row exists', async () => {
    const env = makeBlobEnv({ storage: null });
    const ctx = makeCtx(env);
    const response = await handleBlobs(
      new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/blobs/storage`, { method: 'GET' }),
      ctx,
      'storage',
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      data: {
        usedBytes: 0,
        blobCount: 0,
        availableBytes: 500_000_000,
      },
    });
  });
});
