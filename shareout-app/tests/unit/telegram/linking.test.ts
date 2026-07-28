import { describe, expect, it, vi } from 'vitest';
import { mintLinkCode, consumeLinkCode, getLinkedUserId } from '../../../src/telegram/linking';
import type { Env } from '../../../src/types';

function makeKv(): KVNamespace {
  const store = new Map<string, string>();
  return {
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
    delete: vi.fn(async (k: string) => { store.delete(k); }),
  } as unknown as KVNamespace;
}

describe('telegram linking', () => {
  it('mints a code that consumes once to the bound user', async () => {
    const env = { RATE_LIMIT_KV: makeKv() } as Env;
    const code = await mintLinkCode(env, 'usr_1');
    expect(code).toBeTruthy();

    expect(await consumeLinkCode(env, code!)).toBe('usr_1');
    // One-time use: second consume yields nothing.
    expect(await consumeLinkCode(env, code!)).toBeNull();
  });

  it('returns null when KV is unbound', async () => {
    expect(await mintLinkCode({} as Env, 'usr_1')).toBeNull();
    expect(await consumeLinkCode({} as Env, 'whatever')).toBeNull();
  });

  it('consuming an unknown code returns null', async () => {
    const env = { RATE_LIMIT_KV: makeKv() } as Env;
    expect(await consumeLinkCode(env, 'nope')).toBeNull();
  });

  it('getLinkedUserId reads the mapping', async () => {
    const env = {
      DB: {
        prepare: vi.fn(() => ({
          bind: vi.fn(() => ({ first: vi.fn(async () => ({ user_id: 'usr_9' })) })),
        })),
      },
    } as unknown as Env;
    expect(await getLinkedUserId(env, 555)).toBe('usr_9');
  });
});
