// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { incomingBytes, checkStorageQuota, canAddPublicArtifact } from '../../../src/quota';
import type { Env, FileEntry } from '../../../src/types';

const file = (content: string, encoding?: 'base64'): FileEntry =>
  ({ path: 'x', content, mime: 'text/plain', ...(encoding ? { encoding } : {}) } as FileEntry);

// DB mock: SUM returns `usedBytes`, public COUNT returns `publicCount`. Caps come
// from instance settings, not a plan.
function makeEnv(
  usedBytes: number,
  publicCount = 0,
  vars: { STORAGE_QUOTA_BYTES?: string; PUBLIC_ARTIFACT_LIMIT?: string } = {},
): Env {
  return {
    ...vars,
    DB: {
      prepare: (sql: string) => ({
        bind: () => ({
          first: async () => {
            if (sql.includes('SUM(ast.size_bytes)')) return { bytes: usedBytes };
            if (sql.includes("visibility = 'public'")) return { n: publicCount };
            return null;
          },
        }),
      }),
    },
  } as unknown as Env;
}

describe('incomingBytes', () => {
  it('measures utf-8 and base64 payloads', () => {
    expect(incomingBytes([file('hello')])).toBe(5);
    expect(incomingBytes([file('QUFBQQ==', 'base64')])).toBe(6); // 8 b64 chars -> 6 bytes
  });
});

describe('checkStorageQuota', () => {
  it('blocks an account over the configured cap', async () => {
    const env = makeEnv(199_999_999, 0, { STORAGE_QUOTA_BYTES: '200000000' });
    const r = await checkStorageQuota(env, 'usr_1', [file('x'.repeat(2_000_000))]);
    expect(r.allowed).toBe(false);
  });

  it('allows an account under the configured cap', async () => {
    const env = makeEnv(1_000_000, 0, { STORAGE_QUOTA_BYTES: '200000000' });
    const r = await checkStorageQuota(env, 'usr_1', [file('small')]);
    expect(r.allowed).toBe(true);
  });

  it('is unlimited when no cap is configured (the default)', async () => {
    const env = makeEnv(1_000_000_000_000);
    const r = await checkStorageQuota(env, 'usr_1', [file('x'.repeat(1_000_000))]);
    expect(r.allowed).toBe(true);
    expect(r.max).toBe(0);
  });
});

describe('canAddPublicArtifact', () => {
  it('blocks at the configured public-artifact cap', async () => {
    const env = makeEnv(0, 25, { PUBLIC_ARTIFACT_LIMIT: '25' });
    expect((await canAddPublicArtifact(env, 'usr_1')).allowed).toBe(false);
  });
  it('allows under the configured cap', async () => {
    const env = makeEnv(0, 3, { PUBLIC_ARTIFACT_LIMIT: '25' });
    expect((await canAddPublicArtifact(env, 'usr_1')).allowed).toBe(true);
  });
  it('is unlimited when no cap is configured (the default)', async () => {
    const env = makeEnv(0, 100_000);
    expect((await canAddPublicArtifact(env, 'usr_1')).allowed).toBe(true);
  });
});
