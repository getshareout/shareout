// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockGetAIProvider = vi.fn();
const mockResolveAgentAiConfig = vi.fn();
const mockRecordAgentUsage = vi.fn();
const mockGetAgentConfig = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockIncrementRateLimit = vi.fn();
const mockRecordUsage = vi.fn();
const mockCheckSlidingWindowRateLimit = vi.fn();
const mockFetchWithTimeout = vi.fn();

vi.mock('../../../../src/data/agent/anthropic', () => ({
  getAIProvider: (...args: unknown[]) => mockGetAIProvider(...args),
  AGENT_CHAT_MODEL: 'gpt-4o',
}));

vi.mock('../../../../src/data/agent/ai-config', () => ({
  resolveAgentAiConfig: (...args: unknown[]) => mockResolveAgentAiConfig(...args),
  recordAgentUsage: (...args: unknown[]) => mockRecordAgentUsage(...args),
}));

vi.mock('../../../../src/data/agent/visitor-chat', () => ({
  getAgentConfig: (...args: unknown[]) => mockGetAgentConfig(...args),
}));

vi.mock('../../../../src/data/agent/usage', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  incrementRateLimit: (...args: unknown[]) => mockIncrementRateLimit(...args),
  recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
}));

vi.mock('../../../../src/rate-limit', () => ({
  checkSlidingWindowRateLimit: (...args: unknown[]) => mockCheckSlidingWindowRateLimit(...args),
  getTrustedClientIp: (req: Request) => req.headers.get('cf-connecting-ip'),
}));

vi.mock('../../../../src/fetch-utils', () => ({
  fetchWithTimeout: (...args: unknown[]) => mockFetchWithTimeout(...args),
  FetchTimeoutError: class FetchTimeoutError extends Error {},
}));

import { handlePilot, handlePilotSpike } from '../../../../src/data/agent/pilot';
import { makeCtx, makeEnv, BASE_URL } from './helpers';
import type { DataContext } from '../../../../src/data/middleware';
import type { Env } from '../../../../src/types';

const TASK_ID = 'task-abcdef12';

function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => { store.set(k, v); }),
  };
}

function spikeRequest(body: unknown): Request {
  return new Request(`${BASE_URL}/spike/agent/pilot/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer client-fake-key',
      'cf-connecting-ip': '203.0.113.7',
    },
    body: JSON.stringify(body),
  });
}

function realRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`${BASE_URL}/art_test/agent/pilot/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'cf-connecting-ip': '203.0.113.7',
      'x-pilot-task': TASK_ID,
      ...headers,
    },
    body: JSON.stringify(body),
  });
}

function upstreamOk(usage = { prompt_tokens: 11, completion_tokens: 7 }): Response {
  return new Response(
    JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'hi' } }], usage }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

function realCtx(kv = makeKv()): DataContext {
  const env = makeEnv({}, { RATE_LIMIT_KV: kv as unknown as KVNamespace });
  const ctx = makeCtx(env);
  // Owner-viewer so the anon gate is skipped by default.
  ctx.viewer = { email: 'owner@example.com', isOwner: true };
  ctx.isOwner = true;
  ctx.artifact.owner_id = 'usr_owner';
  return ctx;
}

const billingConfig = {
  provider: 'openai',
  apiKey: 'sk-real-server-key',
  baseUrl: 'https://api.openai.com/v1',
  model: 'gpt-4o',
};

beforeEach(() => {
  mockGetAIProvider.mockReturnValue({ ...billingConfig });
  mockCheckSlidingWindowRateLimit.mockResolvedValue({ allowed: true });
  mockRecordAgentUsage.mockResolvedValue(undefined);
  mockRecordUsage.mockResolvedValue(undefined);
  mockIncrementRateLimit.mockResolvedValue(undefined);
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
  mockGetAgentConfig.mockResolvedValue({ pilot_enabled: true });
  mockResolveAgentAiConfig.mockResolvedValue({
    workspaceId: 'wsp_test',
    aiConfig: { ...billingConfig },
    byo: false,
    balanceMicroUsd: 5_000_000,
  });
  mockFetchWithTimeout.mockImplementation(async () => upstreamOk());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('pilot spike path (localhost)', () => {
  it('overrides client model with server default and forces stream:false', async () => {
    const req = spikeRequest({ model: 'gpt-4o-super-expensive', stream: true, messages: [{ role: 'user', content: 'hi' }] });
    const res = await handlePilotSpike(req, makeEnv(), null);
    expect(res.status).toBe(200);
    const [, init] = mockFetchWithTimeout.mock.calls[0];
    const forwarded = JSON.parse((init as RequestInit).body as string);
    expect(forwarded.model).toBe('gpt-4o');
    expect(forwarded.stream).toBe(false);
  });

  it('attaches the real server provider key, never the client Authorization', async () => {
    await handlePilotSpike(spikeRequest({ messages: [{ role: 'user', content: 'hi' }] }), makeEnv(), null);
    const [, init] = mockFetchWithTimeout.mock.calls[0];
    const auth = (init as RequestInit).headers as Record<string, string>;
    expect(auth['Authorization']).toBe('Bearer sk-real-server-key');
  });

  it('rejects the execute_javascript tool with 400', async () => {
    const req = spikeRequest({ messages: [{ role: 'user', content: 'hi' }], tools: [{ type: 'function', function: { name: 'execute_javascript' } }] });
    const res = await handlePilotSpike(req, makeEnv(), null);
    expect(res.status).toBe(400);
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('logs usage and does not bill for the spike id', async () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const res = await handlePilotSpike(spikeRequest({ messages: [{ role: 'user', content: 'hi' }] }), makeEnv(), null);
    expect(res.status).toBe(200);
    expect(mockRecordAgentUsage).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('[pilot] usage prompt=11 completion=7'));
    logSpy.mockRestore();
  });
});

// The opt-in gate applies to NON-owners. A signed-in non-owner (email present,
// isOwner false) clears the anon gate but is still subject to pilot_enabled.
function nonOwnerCtx(kv = makeKv()): DataContext {
  const ctx = realCtx(kv);
  ctx.viewer = { email: 'viewer@example.com', isOwner: false };
  ctx.isOwner = false;
  return ctx;
}

describe('pilot opt-in gate', () => {
  it('returns PILOT_DISABLED 403 when pilot_enabled is falsy', async () => {
    mockGetAgentConfig.mockResolvedValue({ pilot_enabled: false });
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), nonOwnerCtx());
    expect(res.status).toBe(403);
    const json = await res.json() as { code: string };
    expect(json.code).toBe('PILOT_DISABLED');
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('returns PILOT_DISABLED 403 when there is no config row', async () => {
    mockGetAgentConfig.mockResolvedValue(null);
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), nonOwnerCtx());
    expect(res.status).toBe(403);
  });

  it('forwards when pilot is enabled', async () => {
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), realCtx());
    expect(res.status).toBe(200);
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('bypasses the pilot_enabled gate for the OWNER (crew pilot_verify path)', async () => {
    // pilot disabled for the public, but the requester is the verified owner: the
    // gate is skipped and the run forwards (getAgentConfig never consulted).
    mockGetAgentConfig.mockResolvedValue({ pilot_enabled: false });
    const ctx = realCtx();
    ctx.isOwner = true;
    ctx.viewer = { email: 'owner@example.com', isOwner: true };
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), ctx);
    expect(res.status).toBe(200);
    expect(mockGetAgentConfig).not.toHaveBeenCalled();
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(1);
  });

  it('keeps the 403 gate for a non-owner on a pilot-disabled artifact', async () => {
    mockGetAgentConfig.mockResolvedValue({ pilot_enabled: false });
    const ctx = realCtx();
    ctx.isOwner = false;
    ctx.viewer = { email: null, isOwner: false };
    ctx.artifact.allow_anon_agent = 1; // isolate: not blocked by the anon gate
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), ctx);
    expect(res.status).toBe(403);
    const json = await res.json() as { code: string };
    expect(json.code).toBe('PILOT_DISABLED');
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });
});

describe('pilot task header + step cap', () => {
  it('rejects a missing x-pilot-task header with 400', async () => {
    const req = new Request(`${BASE_URL}/art_test/agent/pilot/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }),
    });
    const res = await handlePilot(req, realCtx());
    expect(res.status).toBe(400);
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });

  it('rejects a malformed x-pilot-task header with 400', async () => {
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }, { 'x-pilot-task': 'bad id!' }), realCtx());
    expect(res.status).toBe(400);
  });

  it('rejects the 21st request for the same task with PILOT_STEP_CAP 429', async () => {
    const ctx = realCtx();
    for (let i = 0; i < 20; i++) {
      const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), ctx);
      expect(res.status).toBe(200);
    }
    const capped = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), ctx);
    expect(capped.status).toBe(429);
    const json = await capped.json() as { code: string };
    expect(json.code).toBe('PILOT_STEP_CAP');
    expect(mockFetchWithTimeout).toHaveBeenCalledTimes(20);
  });
});

describe('pilot message-shape guard', () => {
  it('rejects an invalid message role with 400', async () => {
    const res = await handlePilot(realRequest({ messages: [{ role: 'developer', content: 'hi' }] }), realCtx());
    expect(res.status).toBe(400);
  });

  it('rejects a system message that is not first with 400', async () => {
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'a' }, { role: 'system', content: 'b' }] }), realCtx());
    expect(res.status).toBe(400);
  });

  it('rejects more than one system message with 400', async () => {
    const res = await handlePilot(realRequest({ messages: [{ role: 'system', content: 'a' }, { role: 'system', content: 'b' }] }), realCtx());
    expect(res.status).toBe(400);
  });

  it('accepts tool + assistant roles with a leading system message', async () => {
    const res = await handlePilot(realRequest({ messages: [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
      { role: 'tool', content: 't' },
    ] }), realCtx());
    expect(res.status).toBe(200);
  });
});

describe('pilot AI config + usage', () => {
  it('records usage with the resolved workspace and byo flag', async () => {
    await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), realCtx());
    expect(mockRecordAgentUsage).toHaveBeenCalledTimes(1);
    const [, params] = mockRecordAgentUsage.mock.calls[0];
    expect(params).toMatchObject({
      workspaceId: 'wsp_test',
      artifactId: 'art_test',
      mode: 'pilot',
      byo: false,
      inputTokens: 11,
      outputTokens: 7,
    });
  });

  it('uses the BYO key for the upstream call and marks byo:true', async () => {
    mockResolveAgentAiConfig.mockResolvedValue({
      workspaceId: 'wsp_byo',
      aiConfig: { provider: 'openai', apiKey: 'sk-byo-customer-key', baseUrl: 'https://byo.example/v1', model: 'gpt-4o' },
      byo: true,
    });
    await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), realCtx());
    const [url, init] = mockFetchWithTimeout.mock.calls[0];
    expect(url).toBe('https://byo.example/v1/chat/completions');
    const auth = (init as RequestInit).headers as Record<string, string>;
    expect(auth['Authorization']).toBe('Bearer sk-byo-customer-key');
    const [, params] = mockRecordAgentUsage.mock.calls[0];
    expect(params).toMatchObject({ byo: true, workspaceId: 'wsp_byo' });
  });

  it('returns 503 when no AI provider is configured on the instance', async () => {
    mockResolveAgentAiConfig.mockResolvedValue({ workspaceId: 'wsp_test', aiConfig: null, byo: false });
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), realCtx());
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });
});

describe('pilot anon gate', () => {
  it('denies anonymous access when allow_anon_agent is off', async () => {
    const ctx = realCtx();
    ctx.viewer = { email: null, isOwner: false };
    ctx.isOwner = false;
    ctx.artifact.allow_anon_agent = 0;
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), ctx);
    expect(res.status).toBe(403);
    expect(mockFetchWithTimeout).not.toHaveBeenCalled();
  });
});

function upstreamError(status: number, body: string): Response {
  return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
}

describe('pilot upstream error sanitization', () => {
  it('does not leak upstream API error bodies on handlePilot', async () => {
    const leakBody = JSON.stringify({
      error: { message: 'Incorrect API key provided: sk-secret-key', code: 'invalid_api_key' },
    });
    mockFetchWithTimeout.mockResolvedValue(upstreamError(401, leakBody));
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), realCtx());
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('sk-secret-key');
    expect(text).not.toContain('invalid_api_key');
    const json = JSON.parse(text) as { error: { message: string; code: string } };
    expect(json.error.message).toBe('AI request failed');
    expect(json.error.code).toBe('UPSTREAM_ERROR');
  });

  it('maps upstream 429 to a rate-limit message on handlePilot', async () => {
    mockFetchWithTimeout.mockResolvedValue(
      upstreamError(429, JSON.stringify({ error: { message: 'rate limit exceeded' } })),
    );
    const res = await handlePilot(realRequest({ messages: [{ role: 'user', content: 'hi' }] }), realCtx());
    const json = await res.json() as { error: { message: string } };
    expect(json.error.message).toBe('AI service is busy. Try again shortly.');
  });

  it('does not leak upstream API error bodies on handlePilotSpike', async () => {
    const leakBody = JSON.stringify({
      error: { message: 'Incorrect API key provided: sk-spike-leak', code: 'invalid_api_key' },
    });
    mockFetchWithTimeout.mockResolvedValue(upstreamError(500, leakBody));
    const res = await handlePilotSpike(spikeRequest({ messages: [{ role: 'user', content: 'hi' }] }), makeEnv(), null);
    expect(res.status).toBe(502);
    const text = await res.text();
    expect(text).not.toContain('sk-spike-leak');
    const json = JSON.parse(text) as { error: { message: string } };
    expect(json.error.message).toBe('AI request failed');
  });
});
