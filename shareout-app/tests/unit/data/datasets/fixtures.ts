/**
 * Request builders, D1/R2 stubs, and sample rows shared by datasets handler unit tests.
 */
import { vi } from 'vitest';
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';

export const ARTIFACT_ID = 'art_test';
export const BASE_URL = 'https://shareout.example.com';
export const ORIGIN = 'https://app.example.com';

export interface DatasetRow {
  id: string;
  artifact_id: string;
  name: string;
  format: string;
  r2_key: string;
  size_bytes: number;
  sha256: string;
  version: number;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface UploadTokenRow {
  id: string;
  artifact_id: string;
  dataset_name: string;
  format: string;
  r2_key: string;
  expires_at: string;
  used_at: string | null;
}

export type DbScenario = {
  datasetList?: Array<Pick<DatasetRow, 'name' | 'format' | 'size_bytes' | 'version' | 'updated_at'>>;
  dataset?: DatasetRow | null;
  existingDataset?: { id: string; version: number } | null;
  uploadToken?: UploadTokenRow | null;
};

/** getDatasetContent streams obj.body (008 Stage B1); content mocks need a ReadableStream body. */
export function r2Body(content: string): R2ObjectBody {
  const bytes = new TextEncoder().encode(content);
  return {
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    size: bytes.length,
  } as unknown as R2ObjectBody;
}

export function makeR2Mock(
  options: {
    getResult?: R2ObjectBody | null;
    headResult?: R2Object | null;
    putImpl?: (...args: unknown[]) => Promise<void>;
    deleteImpl?: (...args: unknown[]) => Promise<void>;
  } = {},
): Env['ARTIFACTS'] {
  return {
    put: vi.fn(options.putImpl ?? (async () => undefined)),
    get: vi.fn(async () => options.getResult ?? null),
    head: vi.fn(async () => options.headResult ?? null),
    delete: vi.fn(options.deleteImpl ?? (async () => undefined)),
  } as unknown as Env['ARTIFACTS'];
}

function dbFirst(sql: string, _args: unknown[], scenario: DbScenario): unknown {
  if (sql.includes('FROM datasets') && sql.includes('ORDER BY name')) {
    return null;
  }
  if (sql.includes('FROM datasets') && sql.includes('artifact_id = ? AND name = ?')) {
    if (sql.includes('id, version')) {
      return scenario.existingDataset ?? null;
    }
    if (sql.includes('id, r2_key')) {
      return scenario.dataset
        ? { id: scenario.dataset.id, r2_key: scenario.dataset.r2_key }
        : null;
    }
    return scenario.dataset ?? null;
  }
  if (sql.includes('FROM upload_tokens')) {
    return scenario.uploadToken ?? null;
  }
  return null;
}

export function makeDatasetEnv(
  scenario: DbScenario = {},
  r2Options: Parameters<typeof makeR2Mock>[0] = {},
): Env {
  const DB = {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => dbFirst(sql, bindArgs, scenario)),
        all: vi.fn(async () => ({
          results: scenario.datasetList ?? [],
        })),
        run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
      })),
    })),
  } as unknown as Env['DB'];

  return {
    DB,
    ARTIFACTS: makeR2Mock(r2Options),
  } as Env;
}

export function makeCtx(env: Env, origin: string | null = ORIGIN): DataContext {
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

export function jsonRequest(method: string, path: string, body?: unknown): Request {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  return new Request(`${BASE_URL}/v1/data/${ARTIFACT_ID}/datasets/${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const sampleDataset: DatasetRow = {
  id: 'dst_abc',
  artifact_id: ARTIFACT_ID,
  name: 'sales_data',
  format: 'json',
  r2_key: `${ARTIFACT_ID}/datasets/sales_data/upl_token.json`,
  size_bytes: 42,
  sha256: 'etag123',
  version: 1,
  metadata: JSON.stringify({ rowCount: 2, columns: ['id', 'amount'] }),
  created_at: '2026-05-30T14:00:00.000Z',
  updated_at: '2026-05-30T14:00:00.000Z',
};

export const sampleToken: UploadTokenRow = {
  id: 'upl_token',
  artifact_id: ARTIFACT_ID,
  dataset_name: 'sales_data',
  format: 'json',
  r2_key: `${ARTIFACT_ID}/datasets/sales_data/upl_token.json`,
  expires_at: '2026-05-30T14:15:00.000Z',
  used_at: null,
};
