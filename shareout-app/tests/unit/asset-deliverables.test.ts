// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { createShareLink, resolveShareLink, hashAssetLinkPassword, listShareLinks, revokeShareLink, setDeliverableFields } from '../../src/assets/deliverables';
import type { Env } from '../../src/types';

/** D1 stub with scripted first()/all() queues; records SQL. */
function mkEnv(opts: { first?: unknown[]; all?: unknown[]; capture?: string[]; runChanges?: number }): Env {
  const firstQ = [...(opts.first || [])];
  const allQ = [...(opts.all || [])];
  const DB = {
    prepare: vi.fn((sql: string) => {
      opts.capture?.push(sql);
      return {
        bind: vi.fn(() => ({
          first: vi.fn(async () => (firstQ.length ? firstQ.shift() : null)),
          all: vi.fn(async () => (allQ.length ? allQ.shift() : { results: [] })),
          run: vi.fn(async () => ({ success: true, meta: { changes: opts.runChanges ?? 0 } })),
        })),
      };
    }),
    batch: vi.fn(async (s: unknown[]) => s.map(() => ({ success: true }))),
  };
  return { DB, SHAREOUT_BASE_URL: 'https://shareout.site' } as unknown as Env;
}

describe('asset deliverables — share links', () => {
  it('creates a dlk_ link with a /d/ public url', async () => {
    const env = mkEnv({});
    const link = await createShareLink(env, 'col_1', 'usr_1', {});
    expect(link.id).toMatch(/^dlk_/);
    expect(link.url).toBe(`https://shareout.site/d/${link.id}`);
  });

  it('hashes a link password deterministically and distinctly', async () => {
    const a = await hashAssetLinkPassword('hunter2');
    const b = await hashAssetLinkPassword('hunter2');
    const c = await hashAssetLinkPassword('different');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('returns the gate + gate_value for a protected link', async () => {
    const env = mkEnv({
      first: [
        { collection_id: 'col_1', expires_at: null, revoked: 0, gate: 'password', gate_value: 'abc123' },
        { name: 'Protected', bucket_artifact_id: 'art_b' },
      ],
      all: [{ results: [] }],
    });
    const r = await resolveShareLink(env, 'dlk_p');
    expect(r!.gate).toBe('password');
    expect(r!.gateValue).toBe('abc123');
  });

  it('resolves a live link to its collection files (+ creator + views for open-notify)', async () => {
    const env = mkEnv({
      first: [
        { collection_id: 'col_1', expires_at: null, revoked: 0, created_by: 'usr_owner', view_count: 0 },
        { name: 'Final files', bucket_artifact_id: 'art_b' },
      ],
      all: [{ results: [{ deliverable_name: 'Hero', filename: 'hero.png', mime_type: 'image/png', size_bytes: 100, version_no: 2, blob_id: 'blob_9' }] }],
    });
    const r = await resolveShareLink(env, 'dlk_x');
    expect(r).not.toBeNull();
    expect(r!.collectionName).toBe('Final files');
    expect(r!.files[0].contentPath).toBe('/v1/data/art_b/blobs/blob_9/content');
    expect(r!.files[0].version).toBe(2);
    expect(r!.createdBy).toBe('usr_owner');
    expect(r!.viewCount).toBe(0);
  });

  it('returns null for a revoked link', async () => {
    const env = mkEnv({ first: [{ collection_id: 'col_1', expires_at: null, revoked: 1 }] });
    expect(await resolveShareLink(env, 'dlk_x')).toBeNull();
  });

  it('returns null for an expired link', async () => {
    const env = mkEnv({ first: [{ collection_id: 'col_1', expires_at: '2000-01-01T00:00:00Z', revoked: 0 }] });
    expect(await resolveShareLink(env, 'dlk_x')).toBeNull();
  });
});

describe('asset deliverables — manage / revoke', () => {
  it('lists links with status flags + public url', async () => {
    const env = mkEnv({
      all: [{ results: [
        { id: 'dlk_a', collection_id: 'col_1', gate: 'password', expires_at: '2000-01-01T00:00:00Z', revoked: 0, view_count: 5, created_at: 'x', collection_name: 'Acme', file_count: 3 },
        { id: 'dlk_b', collection_id: 'col_2', gate: 'none', expires_at: null, revoked: 1, view_count: 0, created_at: 'y', collection_name: 'Beta', file_count: 1 },
      ] }],
    });
    const links = await listShareLinks(env, 'art_b');
    expect(links[0].url).toBe('https://shareout.site/d/dlk_a');
    expect(links[0].gate).toBe('password');
    expect(links[0].expired).toBe(true);
    expect(links[0].revoked).toBe(false);
    expect(links[1].revoked).toBe(true);
    expect(links[1].expired).toBe(false);
  });

  it('revokeShareLink reports whether a row changed', async () => {
    expect(await revokeShareLink(mkEnv({ runChanges: 1 }), 'art_b', 'dlk_a')).toBe(true);
    expect(await revokeShareLink(mkEnv({ runChanges: 0 }), 'art_b', 'dlk_a')).toBe(false);
  });
});

describe('setDeliverableFields', () => {
  /** Env stub that records the SET-clause SQL and the ordered bind args. */
  function mkFieldsEnv(runChanges: number) {
    const sql: string[] = [];
    let bound: unknown[] = [];
    const DB = {
      prepare: vi.fn((s: string) => { sql.push(s); return {
        bind: vi.fn((...args: unknown[]) => { bound = args; return {
          run: vi.fn(async () => ({ meta: { changes: runChanges } })),
        }; }),
      }; }),
    };
    return { env: { DB } as unknown as Env, sql, get bound() { return bound; } };
  }

  it('builds SET for both fields and binds visibility, folder, id, bucket in order', async () => {
    const h = mkFieldsEnv(1);
    const ok = await setDeliverableFields(h.env, 'art_b', 'dlv_1', { visibility: 'private', folderId: 'fld_9' });
    expect(ok).toBe(true);
    expect(h.sql[0]).toContain('SET visibility = ?, folder_id = ?');
    expect(h.sql[0]).toContain('deleted_at IS NULL');
    expect(h.bound).toEqual(['private', 'fld_9', 'dlv_1', 'art_b']);
  });

  it('updates only the folder when visibility is omitted', async () => {
    const h = mkFieldsEnv(1);
    await setDeliverableFields(h.env, 'art_b', 'dlv_1', { folderId: null });
    expect(h.sql[0]).toContain('SET folder_id = ?');
    expect(h.sql[0]).not.toContain('visibility = ?');
    expect(h.bound).toEqual([null, 'dlv_1', 'art_b']);
  });

  it('no-ops (no query, returns false) when no fields given', async () => {
    const h = mkFieldsEnv(1);
    expect(await setDeliverableFields(h.env, 'art_b', 'dlv_1', {})).toBe(false);
    expect(h.sql.length).toBe(0);
  });

  it('returns false when no row matched (wrong bucket / soft-deleted)', async () => {
    const h = mkFieldsEnv(0);
    expect(await setDeliverableFields(h.env, 'art_b', 'dlv_x', { visibility: 'workspace' })).toBe(false);
  });
});
