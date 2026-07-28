// @vitest-environment node
/**
 * Shared fixtures and DB/R2 mocks for artifact handler unit tests.
 * @module tests/unit/artifacts/shared
 */
import { vi } from 'vitest';
import type { AuthUser } from '../../../src/api-auth';
import type { Env } from '../../../src/types';

const user: AuthUser = { id: 'usr_1', email: 'owner@example.com', username: null };

const baseEnv = {
  SHAREOUT_BASE_URL: 'https://shareout.example.com',
} as Env;

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true, meta: { changes: 1 } }),
      })),
    })),
  } as unknown as Env['DB'];
}

function makeR2Mock(getHandler?: (key: string) => unknown): Env['ARTIFACTS'] {
  return {
    get: vi.fn(async (key: string) => getHandler?.(key) ?? null),
    delete: vi.fn(async () => undefined),
  } as unknown as Env['ARTIFACTS'];
}

function makeSlugsMock(): Env['SLUGS'] {
  return {
    delete: vi.fn(async () => undefined),
  } as unknown as Env['SLUGS'];
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

const artifactRow = {
  id: 'art_1',
  name: 'Demo',
  slug: 'demo-slug',
  visibility: 'public',
  paused: 0,
  created_at: '2024-01-01T00:00:00Z',
  description: 'A demo artifact',
  social_title: null,
  social_description: null,
  social_image_url: null,
  thumbnail_ext: null,
  auth_method: 'none',
  owner_id: 'usr_1',
  embed_allowed: 1,
  embed_origins: '["https://example.com"]',
  updated_at: '2024-01-02T00:00:00Z',
  deploy_slug: 'deploy-slug',
  current_version: 3,
  is_favorite: 0,
};

function ownerRoleFirst(sql: string, ...args: unknown[]): unknown {
  if (sql.includes('owner_id FROM artifacts') && !sql.includes('description')) {
    return { owner_id: 'usr_1' };
  }
  if (sql.includes('is_favorite')) {
    return artifactRow;
  }
  if (
    sql.includes('SELECT id FROM artifacts WHERE id') ||
    sql.includes('SELECT id, workspace_id FROM artifacts WHERE id')
  ) {
    return { id: 'art_1', workspace_id: null };
  }
  if (sql.includes('SELECT id, slug FROM artifacts')) {
    return { id: 'art_1', slug: 'demo-slug' };
  }
  if (sql.includes('slug FROM deployments')) {
    return { slug: 'deploy-slug' };
  }
  if (sql.includes('owner_id FROM artifacts WHERE id') && args[0] === 'art_1') {
    return { id: 'art_1', owner_id: 'usr_1' };
  }
  return null;
}


export {
  user,
  baseEnv,
  makeDbMock,
  makeR2Mock,
  makeSlugsMock,
  jsonBody,
  artifactRow,
  ownerRoleFirst,
};
