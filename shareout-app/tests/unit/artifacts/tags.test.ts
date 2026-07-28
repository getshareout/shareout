// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { handleGetTags, handleAddTag, handleRemoveTag } from '../../../src/artifacts';
import type { Env } from '../../../src/types';
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

describe('artifact tags', () => {
  it('lists tags for a viewer', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => (sql.includes('owner_id FROM artifacts') ? { owner_id: 'usr_1' } : null),
        all: (sql) =>
          sql.includes('FROM artifact_tags')
            ? { results: [{ label: 'design' }, { label: 'sales' }] }
            : { results: [] },
      }),
    } as Env;

    const res = await handleGetTags(new Request('https://x'), env, user, 'art_1');
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ tags: ['design', 'sales'] });
  });

  it('adds a normalized tag and returns the updated list', async () => {
    const inserted: unknown[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('COUNT(*) as n')) return { n: 2 };
          return null;
        },
        run: (sql, ...args) => {
          if (sql.includes('INSERT OR IGNORE INTO artifact_tags')) inserted.push(args);
          return { success: true };
        },
        all: (sql) =>
          sql.includes('FROM artifact_tags') ? { results: [{ label: 'q2' }] } : { results: [] },
      }),
    } as Env;

    const req = new Request('https://x', { method: 'POST', body: JSON.stringify({ label: '  Q2  ' }) });
    const res = await handleAddTag(req, env, user, 'art_1');
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ tags: ['q2'] });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toContain('Q2');
  });

  it('rejects an empty tag label', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => (sql.includes('owner_id FROM artifacts') ? { owner_id: 'usr_1' } : null),
      }),
    } as Env;
    const req = new Request('https://x', { method: 'POST', body: JSON.stringify({ label: '   ' }) });
    const res = await handleAddTag(req, env, user, 'art_1');
    expect(res.status).toBe(400);
  });

  it('enforces the per-artifact tag cap', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'usr_1' };
          if (sql.includes('COUNT(*) as n')) return { n: 12 };
          return null;
        },
      }),
    } as Env;
    const req = new Request('https://x', { method: 'POST', body: JSON.stringify({ label: 'extra' }) });
    const res = await handleAddTag(req, env, user, 'art_1');
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toMatchObject({ code: 'TOO_MANY_TAGS' });
  });

  it('removes a tag (owner only)', async () => {
    const deleted: unknown[] = [];
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => (sql.includes('owner_id FROM artifacts') ? { owner_id: 'usr_1' } : null),
        run: (sql, ...args) => {
          if (sql.includes('DELETE FROM artifact_tags')) deleted.push(args);
          return { success: true };
        },
      }),
    } as Env;
    const res = await handleRemoveTag(new Request('https://x', { method: 'DELETE' }), env, user, 'art_1', 'design');
    expect(res.status).toBe(200);
    expect(deleted[0]).toContain('design');
  });

  it('forbids tag changes for non-collaborators', async () => {
    const env = {
      ...baseEnv,
      DB: makeDbMock({
        first: (sql) => {
          if (sql.includes('owner_id FROM artifacts')) return { owner_id: 'someone_else' };
          if (sql.includes('email FROM users')) return { email: 'owner@example.com' };
          return null; // no collaborator row
        },
      }),
    } as Env;
    const req = new Request('https://x', { method: 'POST', body: JSON.stringify({ label: 'x' }) });
    const res = await handleAddTag(req, env, user, 'art_1');
    expect(res.status).toBe(403);
  });
});
