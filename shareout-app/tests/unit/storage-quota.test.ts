// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { checkStorageQuota, getSubjectStorageBytes } from '../../src/storage-quota';
import type { Env } from '../../src/types';

interface Scenario {
  owner_id?: string | null;
  workspace_id?: string | null;
  assetsBytes?: number;
  datasetsBytes?: number;
  blobsBytes?: number;
  quotaBytes?: number;   // STORAGE_QUOTA_BYTES
  fileBytes?: number;    // STORAGE_MAX_FILE_BYTES
}

// Routes each prepared SQL to a canned first() result based on a fingerprint of the query.
function makeEnv(s: Scenario): { env: Env; calls: string[] } {
  const calls: string[] = [];
  const first = (sql: string): unknown => {
    calls.push(sql.replace(/\s+/g, ' ').trim());
    if (sql.includes('FROM artifacts') && sql.includes('owner_id, workspace_id')) {
      return { owner_id: s.owner_id ?? null, workspace_id: s.workspace_id ?? null };
    }
    if (sql.includes('FROM assets')) return { bytes: s.assetsBytes ?? 0 };
    if (sql.includes('FROM datasets')) return { bytes: s.datasetsBytes ?? 0 };
    if (sql.includes('FROM artifact_storage')) return { bytes: s.blobsBytes ?? 0 };
    return null;
  };
  const env = {
    STORAGE_QUOTA_BYTES: s.quotaBytes != null ? String(s.quotaBytes) : undefined,
    STORAGE_MAX_FILE_BYTES: s.fileBytes != null ? String(s.fileBytes) : undefined,
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({ first: async () => first(sql) }),
      }),
    },
  } as unknown as Env;
  return { env, calls };
}

describe('getSubjectStorageBytes', () => {
  it('sums assets + datasets + blobs for a workspace subject', async () => {
    const { env, calls } = makeEnv({ assetsBytes: 100, datasetsBytes: 200, blobsBytes: 50 });
    const bytes = await getSubjectStorageBytes(env, { ownerId: null, workspaceId: 'wsp_1' });
    expect(bytes).toBe(350);
    expect(calls.some(c => c.includes('a.workspace_id = ?'))).toBe(true);
  });

  it('scopes to personal (workspace_id IS NULL) artifacts for an owner subject', async () => {
    const { env, calls } = makeEnv({ assetsBytes: 10, datasetsBytes: 0, blobsBytes: 0 });
    const bytes = await getSubjectStorageBytes(env, { ownerId: 'usr_1', workspaceId: null });
    expect(bytes).toBe(10);
    expect(calls.some(c => c.includes('a.workspace_id IS NULL'))).toBe(true);
  });
});

describe('checkStorageQuota', () => {
  it('allows everything when no caps are configured (the default)', async () => {
    const { env, calls } = makeEnv({ owner_id: 'usr_1', assetsBytes: 5_368_709_120 });
    const q = await checkStorageQuota(env, 'art_1', 1_000_000_000);
    expect(q.allowed).toBe(true);
    expect(q.max).toBe(0);
    // Unlimited short-circuits before summing storage.
    expect(calls.some(c => c.includes('FROM assets'))).toBe(false);
  });

  it('allows an upload that stays under the configured cap', async () => {
    const { env } = makeEnv({ owner_id: 'usr_1', quotaBytes: 50_000_000, assetsBytes: 1_000_000 });
    const q = await checkStorageQuota(env, 'art_1', 1_000_000);
    expect(q.allowed).toBe(true);
    expect(q.max).toBe(50_000_000);
  });

  it('rejects a single file over the per-file cap (no storage sum needed)', async () => {
    const { env, calls } = makeEnv({ owner_id: 'usr_1', fileBytes: 25_000_000 });
    const q = await checkStorageQuota(env, 'art_1', 30_000_000);
    expect(q.allowed).toBe(false);
    expect(q.reason).toBe('file_too_large');
    expect(calls.some(c => c.includes('FROM assets'))).toBe(false);
  });

  it('rejects when used + incoming exceeds the total cap', async () => {
    const { env } = makeEnv({ owner_id: 'usr_1', quotaBytes: 50_000_000, assetsBytes: 48_000_000 });
    const q = await checkStorageQuota(env, 'art_1', 5_000_000);
    expect(q.allowed).toBe(false);
    expect(q.reason).toBe('over_quota');
    expect(q.used).toBe(48_000_000);
  });

  it('subtracts the replaced dataset bytes so re-upload of similar size is allowed', async () => {
    // 48MB used (includes the 10MB dataset being replaced); replace with 11MB.
    // Without the subtraction 48+11=59 > 50 would fail; net 48-10+11=49 ≤ 50 passes.
    const { env } = makeEnv({ owner_id: 'usr_1', quotaBytes: 50_000_000, assetsBytes: 48_000_000 });
    const q = await checkStorageQuota(env, 'art_1', 11_000_000, 10_000_000);
    expect(q.allowed).toBe(true);
  });
});
