// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { isAllowedMimeType, isInlineType } from '../../src/data/blobs/handler';
import { getOrCreateAssetBucket } from '../../src/assets/bucket';
import type { Env } from '../../src/types';

describe('asset library — file-type policy', () => {
  it('accepts office/archive MIME types in the standard allowlist', () => {
    expect(isAllowedMimeType('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')).toBe(true);
    expect(isAllowedMimeType('application/vnd.openxmlformats-officedocument.presentationml.presentation')).toBe(true);
    expect(isAllowedMimeType('application/zip')).toBe(true);
    expect(isAllowedMimeType('image/png')).toBe(true);
  });

  it('bypasses the allowlist for asset buckets (any MIME) but still blocks via filename', () => {
    expect(isAllowedMimeType('application/x-weird-thing')).toBe(false);
    expect(isAllowedMimeType('application/x-weird-thing', true)).toBe(true);
  });

  it('inlines only safe displayable media; everything else downloads', () => {
    expect(isInlineType('image/png')).toBe(true);
    expect(isInlineType('video/mp4')).toBe(true);
    expect(isInlineType('application/pdf')).toBe(true);
    // SVG can carry script — never inline it.
    expect(isInlineType('image/svg+xml')).toBe(false);
    expect(isInlineType('application/zip')).toBe(false);
    expect(isInlineType('application/vnd.ms-excel')).toBe(false);
  });
});

/** Minimal D1 stub: records prepared SQL and returns scripted first()/run() results. */
function mkEnv(firstQueue: unknown[], capture: string[]): Env {
  const DB = {
    prepare: vi.fn((sql: string) => {
      capture.push(sql);
      return {
        bind: vi.fn(() => ({
          first: vi.fn(async () => (firstQueue.length ? firstQueue.shift() : null)),
          run: vi.fn(async () => ({ success: true })),
          all: vi.fn(async () => ({ results: [] })),
        })),
      };
    }),
    batch: vi.fn(async (stmts: unknown[]) => stmts.map(() => ({ success: true }))),
  };
  return { DB } as unknown as Env;
}

describe('asset library — bucket provisioning', () => {
  it('returns the existing workspace bucket when one exists (no insert)', async () => {
    const sql: string[] = [];
    const env = mkEnv([{ id: 'art_b', name: 'Workspace Assets', visibility: 'unlisted', auth_method: null, workspace_id: 'wsp_1', owner_id: 'usr_1' }], sql);
    const bucket = await getOrCreateAssetBucket(env, 'usr_1', 'wsp_1');
    expect(bucket.id).toBe('art_b');
    expect(sql.some((s) => s.includes('INSERT INTO artifacts'))).toBe(false);
    expect(sql[0]).toContain('FROM asset_buckets b JOIN artifacts a');
    expect(sql[0]).toContain('b.workspace_id = ?');
  });

  it('creates a hidden bucket artifact + asset_buckets row when none exists', async () => {
    const sql: string[] = [];
    const env = mkEnv([null], sql); // lookup misses → insert path
    const bucket = await getOrCreateAssetBucket(env, 'usr_1', null);
    expect(bucket.visibility).toBe('public');
    expect(bucket.workspace_id).toBeNull();
    expect(bucket.name).toBe('My Assets');
    // Uses an allowed artifact_type (the CHECK constraint rejects new types).
    expect(sql.some((s) => s.includes('INSERT INTO artifacts'))).toBe(true);
    expect(sql.some((s) => s.includes('INSERT INTO asset_buckets'))).toBe(true);
  });

  it('scopes a personal bucket lookup to the owner, not a workspace', async () => {
    const sql: string[] = [];
    const env = mkEnv([{ id: 'art_p', name: 'My Assets', visibility: 'unlisted', auth_method: null, workspace_id: null, owner_id: 'usr_1' }], sql);
    await getOrCreateAssetBucket(env, 'usr_1', null);
    expect(sql[0]).toContain('b.workspace_id IS NULL');
    expect(sql[0]).toContain('b.owner_id = ?');
  });
});
