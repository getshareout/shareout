// @vitest-environment node
import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Env } from '../../../src/types';

const notifyAdmin = vi.fn(async () => true);
vi.mock('../../../src/observability/alerts', () => ({ notifyAdmin: (...a: unknown[]) => notifyAdmin(...a) }));

import { isPublicRolloutKilled, setPublicRolloutKilled, checkPublicAutoRollback } from '../../../src/public-rollout';

function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => (store.has(k) ? store.get(k)! : null)),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  };
}

function makeEnv(abuseCount: number, kv = makeKv(), extra: Partial<Env> = {}): Env {
  return {
    SLUGS: kv as unknown as KVNamespace,
    DB: {
      prepare: () => ({ bind: () => ({ first: async () => ({ n: abuseCount }) }), first: async () => ({ n: abuseCount }) }),
    },
    ...extra,
  } as unknown as Env;
}

beforeEach(() => notifyAdmin.mockClear());

describe('public rollout kill switch', () => {
  it('reflects the KV flag', async () => {
    const kv = makeKv();
    const env = makeEnv(0, kv);
    expect(await isPublicRolloutKilled(env)).toBe(false);
    await setPublicRolloutKilled(env, true, 'manual');
    expect(await isPublicRolloutKilled(env)).toBe(true);
    await setPublicRolloutKilled(env, false);
    expect(await isPublicRolloutKilled(env)).toBe(false);
  });
});

describe('checkPublicAutoRollback', () => {
  it('trips the kill switch + alerts when abuse exceeds the threshold', async () => {
    const env = makeEnv(100); // default threshold 50
    await checkPublicAutoRollback(env);
    expect(await isPublicRolloutKilled(env)).toBe(true);
    expect(notifyAdmin).toHaveBeenCalled();
  });

  it('does nothing below the threshold', async () => {
    const env = makeEnv(3);
    await checkPublicAutoRollback(env);
    expect(await isPublicRolloutKilled(env)).toBe(false);
    expect(notifyAdmin).not.toHaveBeenCalled();
  });

  it('respects a custom threshold and is idempotent once killed', async () => {
    const env = makeEnv(10, makeKv(), { PUBLIC_ABUSE_AUTOKILL_PER_DAY: '5' });
    await checkPublicAutoRollback(env);
    expect(await isPublicRolloutKilled(env)).toBe(true);
    notifyAdmin.mockClear();
    await checkPublicAutoRollback(env); // already killed -> no-op
    expect(notifyAdmin).not.toHaveBeenCalled();
  });
});
