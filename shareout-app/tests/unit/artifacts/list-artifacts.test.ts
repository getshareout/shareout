// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleListArtifacts } from '../../../src/artifacts';
import {
  artifactRow,
  baseEnv,
  jsonBody,
  makeDbMock,
  makeR2Mock,
  makeSlugsMock,
  ownerRoleFirst,
  user,
} from './shared';

describe('handleListArtifacts', () => {
  it('returns paginated artifact summaries with has_more from a LIMIT+1 probe', async () => {
    const seenSql: string[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => { seenSql.push(sql); return null; },
        all: (sql, ...args) => {
          seenSql.push(sql);
          if (sql.includes('SELECT DISTINCT')) {
            // limit=10 → binds limit+1 (11) as the LIMIT param, offset 5 after it.
            expect(args).toContain(11);
            expect(args).toContain(5);
            return {
              results: [{
                id: 'art_1',
                name: 'Demo',
                slug: 'demo',
                visibility: 'public',
                paused: 0,
                created_at: '2024-01-01T00:00:00Z',
                updated_at: '2024-01-02T00:00:00Z',
                current_version: 2,
                user_role: 'owner',
              }],
            };
          }
          return { results: [] };
        },
      }),
    };

    const response = await handleListArtifacts(
      new Request('https://shareout.example.com/v1/artifacts?limit=10&offset=5'),
      env,
      user,
    );

    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    // Default path: no exact total, no unbounded count scan, no email round-trip.
    expect(body.total).toBeUndefined();
    expect(body.has_more).toBe(false);
    expect(seenSql.some(s => s.includes('COUNT(DISTINCT'))).toBe(false);
    expect(seenSql.some(s => s.includes('email FROM users'))).toBe(false);
    expect(body.limit).toBe(10);
    expect(body.offset).toBe(5);
    expect(body.artifacts).toEqual([{
      id: 'art_1',
      name: 'Demo',
      slug: 'demo',
      visibility: 'public',
      paused: false,
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-02T00:00:00Z',
      current_version: 2,
      user_role: 'owner',
      artifact_type: 'html',
      is_favorite: false,
    }]);
  });

  it('sets has_more=true and trims the probe row when an extra row is returned', async () => {
    const row = (id: string) => ({
      id, name: id, slug: id, visibility: 'public', paused: 0,
      created_at: '2024-01-01T00:00:00Z', updated_at: null,
      current_version: 1, user_role: 'owner',
    });
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        all: (sql) => {
          if (sql.includes('SELECT DISTINCT')) {
            // limit=2 → probe fetches 3 rows.
            return { results: [row('a'), row('b'), row('c')] };
          }
          return { results: [] };
        },
      }),
    };

    const response = await handleListArtifacts(
      new Request('https://shareout.example.com/v1/artifacts?limit=2'),
      env,
      user,
    );

    const body = await jsonBody(response);
    expect(body.has_more).toBe(true);
    expect((body.artifacts as unknown[]).length).toBe(2);
    expect((body.artifacts as { id: string }[]).map(a => a.id)).toEqual(['a', 'b']);
  });

  it('returns an exact total only when count=true is requested', async () => {
    const seenSql: string[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          seenSql.push(sql);
          if (sql.includes('COUNT(DISTINCT')) return { total: 42 };
          return null;
        },
        all: () => ({ results: [] }),
      }),
    };

    const response = await handleListArtifacts(
      new Request('https://shareout.example.com/v1/artifacts?count=true'),
      env,
      user,
    );

    const body = await jsonBody(response);
    expect(body.total).toBe(42);
    expect(seenSql.some(s => s.includes('COUNT(DISTINCT'))).toBe(true);
  });

  it('caps limit at 100', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        all: () => ({ results: [] }),
      }),
    };

    const response = await handleListArtifacts(
      new Request('https://shareout.example.com/v1/artifacts?limit=500'),
      env,
      user,
    );

    expect((await jsonBody(response)).limit).toBe(100);
  });

  it('returns 403 for workspace_id when the caller is not a member', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('role FROM workspace_members')) return null;
          return null;
        },
      }),
    };

    const response = await handleListArtifacts(
      new Request('https://shareout.example.com/v1/artifacts?workspace_id=wsp_1'),
      env,
      user,
    );

    expect(response.status).toBe(403);
    expect(await jsonBody(response)).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('scopes the query to the workspace for an admin member', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('role FROM workspace_members')) return { role: 'admin' };
          return null;
        },
        all: (sql, ...args) => {
          if (sql.includes('SELECT DISTINCT')) {
            expect(sql).toContain('a.workspace_id = ?');
            expect(sql).not.toContain("a.visibility != 'private'");
            expect(args).toContain('wsp_1');
            return {
              results: [{
                id: 'art_ws', name: 'WS', slug: 'ws', visibility: 'private',
                paused: 0, created_at: '2024-01-01T00:00:00Z', updated_at: null,
                current_version: 1, user_role: null,
              }],
            };
          }
          return { results: [] };
        },
      }),
    };

    const response = await handleListArtifacts(
      new Request('https://shareout.example.com/v1/artifacts?workspace_id=wsp_1'),
      env,
      user,
    );

    expect(response.status).toBe(200);
    const body = await jsonBody(response);
    expect(body.has_more).toBe(false);
    expect((body.artifacts as unknown[]).length).toBe(1);
  });

  it('applies a visibility filter for a plain workspace member', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('role FROM workspace_members')) return { role: 'member' };
          return null;
        },
        all: (sql) => {
          if (sql.includes('SELECT DISTINCT')) {
            expect(sql).toContain("a.visibility != 'private'");
          }
          return { results: [] };
        },
      }),
    };

    const response = await handleListArtifacts(
      new Request('https://shareout.example.com/v1/artifacts?workspace_id=wsp_1'),
      env,
      user,
    );

    expect(response.status).toBe(200);
  });
});

