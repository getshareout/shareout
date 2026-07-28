// @vitest-environment node
/**
 * Tables handler tests — auth.
 * Split from tables.test.ts (2026-07-21 large-file decomposition).
 */
import './mocks';
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { dataMiddleware } from '../../../../src/data/middleware';
import { handleDataRequest } from '../../../../src/data/router';
import { createAccessToken } from '../../../../src/token';
import type { Env } from '../../../../src/types';

describe('tables auth via dataMiddleware', () => {
  function authEnv(artifact: {
    id: string;
    visibility: string;
    auth_method: string | null;
  }) {
    return {
      SESSION_SECRET: 'session-secret',
      DB: {
        prepare: vi.fn((sql: string) => ({
          bind: vi.fn(() => ({
            first: vi.fn(async () => {
              if (sql.includes('FROM artifacts WHERE id')) return artifact;
              return null;
            }),
          })),
        })),
      },
    } as unknown as Env;
  }

  it('blocks private artifact table access without credentials', async () => {
    const env = authEnv({
      id: 'art_private',
      visibility: 'private',
      auth_method: 'password',
    });

    const response = await dataMiddleware(
      new Request('https://example.com/v1/data/art_private/tables'),
      env,
      'art_private'
    ) as Response;

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'UNAUTHORIZED',
    });
  });

  it('allows private artifact table access with a valid bearer token', async () => {
    const env = authEnv({
      id: 'art_private',
      visibility: 'private',
      auth_method: 'password',
    });
    const token = await createAccessToken('art_private', 'password', env);

    const result = await dataMiddleware(
      new Request('https://example.com/v1/data/art_private/tables', {
        headers: { Authorization: `Bearer ${token}` },
      }),
      env,
      'art_private'
    );

    expect(result).toMatchObject({ artifactId: 'art_private' });
  });

  it('returns auth failure from handleDataRequest before reaching table handlers', async () => {
    const env = authEnv({
      id: 'art_private',
      visibility: 'private',
      auth_method: 'password',
    });

    const response = await handleDataRequest(
      new Request('https://example.com/v1/data/art_private/tables/users', {
        method: 'POST',
        body: JSON.stringify({ name: 'Alice' }),
      }),
      env,
      'art_private/tables/users'
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      success: false,
      code: 'UNAUTHORIZED',
    });
  });
});
