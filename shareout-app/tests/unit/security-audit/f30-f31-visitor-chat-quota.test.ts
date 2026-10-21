import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';

const gate = vi.hoisted(() => ({ release: null as null | (() => void), wait: null as null | Promise<void> }));

vi.mock('../../../src/data/agent/anthropic', () => ({
  getAgentChatModel: () => 'gpt-4o',
  streamChat: async function* () {
    await gate.wait;
    yield { type: 'content', content: 'hi' };
    yield { type: 'done', usage: { input_tokens: 5, output_tokens: 8 } };
  },
}));
vi.mock('../../../src/data/agent/context', () => ({
  buildVisitorContext: async () => ({ json: {}, tables: {}, blobUrls: [] }),
  buildVisitorSystemPrompt: () => 'sys',
}));
vi.mock('../../../src/data/agent/ai-config', () => ({
  resolveAgentAiConfig: async () => ({
    workspaceId: null, byo: false,
    aiConfig: { provider: 'openai', apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
  }),
  recordAgentUsage: async () => undefined,
}));

import { handleVisitorChat } from '../../../src/data/agent/visitor-chat';
import { AGENT_REQUESTS_PER_MINUTE } from '../../../src/data/agent/usage';

const ART = 'art_f30_chat';
const OWNER = 'usr_f30_owner';

function kv() {
  const m = new Map<string, string>();
  return { get: async (k: string) => m.get(k) ?? null, put: async (k: string, v: string) => void m.set(k, v) } as unknown as KVNamespace;
}

const ctxFor = (over: Record<string, unknown> = {}) => ({
  artifactId: ART,
  artifact: { id: ART, visibility: 'private', owner_id: OWNER, allow_anon_agent: 0 },
  env: { DB: e.DB, RATE_LIMIT_KV: kv(), SESSION_SECRET: 's' },
  origin: null,
  viewer: { email: 'v@x.test' },
  isOwner: false,
  ...over,
}) as never;

const chat = (ctx: never, ip = '1.1.1.1') =>
  handleVisitorChat(new Request('https://so.test/chat', {
    method: 'POST', body: JSON.stringify({ message: 'hi' }), headers: { 'cf-connecting-ip': ip },
  }), ctx);

const counter = (action: string) =>
  e.DB.prepare("SELECT COALESCE(SUM(count),0) AS c FROM rate_limits WHERE principal_type='artifact' AND principal_id=? AND action=?").bind(ART, action).first<{ c: number }>();

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT OR IGNORE INTO users (id, email) VALUES (?, ?)').bind(OWNER, 'f30@x.test'),
    e.DB.prepare('INSERT OR IGNORE INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, ?)').bind(ART, ART, ART, OWNER, 'private'),
    e.DB.prepare('INSERT OR IGNORE INTO artifact_agent_config (artifact_id, visitor_enabled) VALUES (?, 1)').bind(ART),
  ]);
});

beforeEach(async () => {
  await e.DB.prepare("DELETE FROM rate_limits WHERE principal_id = ?").bind(ART).run();
  gate.wait = new Promise<void>((r) => { gate.release = r; });
});

describe('f30 visitor chat quota is reserved before the stream', () => {
  it('blocks: in-flight streams already count against the per-minute budget', async () => {
    const ctx = ctxFor();
    const responses = await Promise.all(Array.from({ length: AGENT_REQUESTS_PER_MINUTE + 5 }, () => chat(ctx)));
    gate.release!();
    await Promise.all(responses.map((r) => r.text()));
    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(AGENT_REQUESTS_PER_MINUTE);
    expect(statuses).toContain(429);
  });

  it('a completed request settles to its real token usage', async () => {
    gate.release!();
    const res = await chat(ctxFor());
    await res.text();
    expect((await counter('agent_requests'))!.c).toBe(1);
    expect((await counter('agent_tokens'))!.c).toBe(13);
  });
});

describe('f31 one anonymous IP cannot drain the owner anon bucket', () => {
  const anon = () => ctxFor({
    artifact: { id: ART, visibility: 'public', owner_id: OWNER, allow_anon_agent: 1 },
    viewer: null,
  });

  it('blocks: a single IP is capped below the owner-wide anon budget', async () => {
    gate.release!();
    const ctx = anon();
    let blocked = 0;
    for (let i = 0; i < 120; i++) {
      await e.DB.prepare("DELETE FROM rate_limits WHERE principal_id = ?").bind(ART).run();
      const res = await chat(ctx, '9.9.9.9');
      if (res.status === 429) blocked++; else await res.text();
    }
    expect(blocked).toBeGreaterThan(0);
    const other = await chat(ctx, '8.8.8.8');
    expect(other.status).toBe(200);
  });
});
