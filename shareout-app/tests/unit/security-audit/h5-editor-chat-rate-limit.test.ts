import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { EditorContext } from '../../../src/editor/index';

vi.mock('../../../src/features/flags', () => ({ isArtifactFeatureEnabled: async () => true }));
vi.mock('../../../src/editor/chat/handlers', () => ({
  handleNormalChat: async () => new Response('ok'),
  handleInlineChat: async () => new Response('ok'),
  handleLassoChat: async () => new Response('ok'),
  handleApplyChanges: async () => new Response('ok'),
  handleRejectChanges: async () => new Response('ok'),
}));

import { handleEditorChat } from '../../../src/editor/chat/index';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) } as unknown as KVNamespace;
}
const ctx = (env: Env, userId: string): EditorContext => ({ artifactId: 'art_h5cr', userId, userName: 'u', role: 'editor', env });
const call = (c: EditorContext, mode: string) => handleEditorChat(new Request('https://so.test/x', { method: 'POST', body: '{}' }), c, mode);

describe('h5 editor chat LLM spend', () => {
  it('blocks: model calls are rate limited per user; apply/reject and other users are unaffected', async () => {
    const env = { RATE_LIMIT_KV: kv() } as Env;
    const a = ctx(env, 'usr_h5cr_a');
    const statuses: number[] = [];
    for (let i = 0; i < 120; i++) statuses.push((await call(a, i % 3 === 0 ? 'normal' : i % 3 === 1 ? 'inline' : 'lasso')).status);
    expect(statuses.slice(0, 100).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(100)).toContain(429);
    expect((await call(a, 'apply')).status).toBe(200);
    expect((await call(a, 'reject')).status).toBe(200);
    expect((await call(ctx(env, 'usr_h5cr_b'), 'normal')).status).toBe(200);
  });
});
