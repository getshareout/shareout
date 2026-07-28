// @vitest-environment node
/**
 * Shared fixtures and request helpers for tables handler unit tests.
 * @module tests/unit/data/tables/shared
 */
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';
import { createTablesDb } from '../tables-mock-db';

export { createTablesDb };
export type TablesDb = ReturnType<typeof createTablesDb>;

export const ARTIFACT_ID = 'art_1';

export function ctxFromDb(db: ReturnType<typeof createTablesDb>, origin: string | null = null): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    workspaceId: 'ws_test',
    artifact: {
      id: ARTIFACT_ID,
      name: 'Test Artifact',
      visibility: 'public',
      auth_method: null,
      workspace_id: 'ws_test',
    },
    db: db as unknown as DataContext['db'],
    env: { SESSION_SECRET: 'session-secret', DB: db } as unknown as Env,
    origin,
  };
}

export function tablesRequest(path: string, init: RequestInit = {}): Request {
  return new Request(`https://example.com/v1/data/${ARTIFACT_ID}/tables${path}`, init);
}
