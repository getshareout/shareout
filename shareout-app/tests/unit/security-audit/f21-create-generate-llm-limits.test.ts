import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import { createFetchContext } from '../../../src/router/context';

const getSessionUser = vi.hoisted(() => vi.fn());
const chat = vi.hoisted(() => vi.fn());
const streamChat = vi.hoisted(() => vi.fn());

vi.mock('../../../src/auth/session', async (importOriginal) => ({ ...(await importOriginal<object>()), getSessionUser }));
vi.mock('../../../src/pages/home/host', () => ({ hostWorkspaceId: async () => null }));
vi.mock('../../../src/pages/create-gate', () => ({ requireCreateEnabled: async () => null }));
vi.mock('../../../src/data/agent/anthropic', () => ({
  chat, streamChat, getAgentChatModel: () => 'model', getBuildConfig: () => ({}),
}));

import { routeCreateApi } from '../../../src/router/api/create';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) } as unknown as KVNamespace;
}

const post = (env: Env, body: unknown, ip = '5.5.5.5') =>
  routeCreateApi(createFetchContext(new Request('https://shareout.site/v1/create/generate', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(body),
  }), env));

beforeEach(() => {
  getSessionUser.mockReset().mockResolvedValue(null);
  chat.mockReset().mockResolvedValue({ content: JSON.stringify({ mode: 'build' }) });
  streamChat.mockReset().mockImplementation(async function* () { yield { type: 'content', content: '<html></html>' }; });
});

describe('f21 create/generate LLM spend', () => {
  it('blocks: anonymous plan calls are rate limited per IP, other IPs unaffected', async () => {
    const env = { RATE_LIMIT_KV: kv() } as Env;
    const statuses: number[] = [];
    for (let i = 0; i < 40; i++) statuses.push((await post(env, { phase: 'plan', prompt: 'a page' }))!.status);
    expect(statuses).toContain(429);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect((await post(env, { phase: 'plan', prompt: 'a page' }, '6.6.6.6'))!.status).toBe(200);
  });

  it('blocks: signed-in preview is rate limited per user', async () => {
    getSessionUser.mockResolvedValue({ id: 'usr_f21', email: 'f21@x.test' });
    const env = { RATE_LIMIT_KV: kv() } as Env;
    const statuses: number[] = [];
    for (let i = 0; i < 70; i++) {
      const res = (await post(env, { phase: 'preview', prompt: 'a page' }))!;
      statuses.push(res.status);
      if (res.status === 200) await res.text();
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(60)).toContain(429);
  });
});
