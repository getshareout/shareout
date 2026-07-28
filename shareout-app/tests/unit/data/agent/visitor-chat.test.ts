// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleConversations,
  handleVisitorChat,
  handleVisitorConfig,
} from '../../../../src/data/agent/visitor-chat';
import {
  ARTIFACT_ID,
  BASE_URL,
  agentConfigRow,
  defaultAgentConfig,
  jsonRequest,
  makeCtx,
  makeEnv,
  parseSSEEvents,
  readSSE,
} from './helpers';

const mockStreamChat = vi.fn();
const mockBuildVisitorContext = vi.fn();
const mockBuildVisitorSystemPrompt = vi.fn();
const mockCheckRateLimit = vi.fn();
const mockIncrementRateLimit = vi.fn();
const mockRecordUsage = vi.fn();
const mockRecordError = vi.fn();

vi.mock('../../../../src/data/agent/anthropic', () => ({
  streamChat: (...args: unknown[]) => mockStreamChat(...args),
  getAgentChatModel: vi.fn(() => 'gpt-4o'),
}));

vi.mock('../../../../src/data/agent/context', () => ({
  buildVisitorContext: (...args: unknown[]) => mockBuildVisitorContext(...args),
  buildVisitorSystemPrompt: (...args: unknown[]) => mockBuildVisitorSystemPrompt(...args),
}));

vi.mock('../../../../src/data/agent/usage', () => ({
  checkRateLimit: (...args: unknown[]) => mockCheckRateLimit(...args),
  incrementRateLimit: (...args: unknown[]) => mockIncrementRateLimit(...args),
  recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
  recordError: (...args: unknown[]) => mockRecordError(...args),
}));

const mockResolveAgentAiConfig = vi.fn();
const mockRecordAgentUsage = vi.fn();

vi.mock('../../../../src/data/agent/ai-config', () => ({
  resolveAgentAiConfig: (...args: unknown[]) => mockResolveAgentAiConfig(...args),
  recordAgentUsage: (...args: unknown[]) => mockRecordAgentUsage(...args),
}));

const visitorContext = { json: { key: 'val' }, tables: {}, blobUrls: [] };

beforeEach(() => {
  mockBuildVisitorContext.mockResolvedValue(visitorContext);
  mockBuildVisitorSystemPrompt.mockReturnValue('visitor system');
  mockCheckRateLimit.mockResolvedValue({ allowed: true, remaining: 9 });
  mockIncrementRateLimit.mockResolvedValue(undefined);
  mockRecordUsage.mockResolvedValue(undefined);
  mockRecordError.mockResolvedValue(undefined);
  mockResolveAgentAiConfig.mockResolvedValue({
    workspaceId: null,
    aiConfig: { provider: 'openai', apiKey: 'test-key', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
    byo: false,
    balanceMicroUsd: null,
  });
  mockRecordAgentUsage.mockResolvedValue(undefined);
  mockStreamChat.mockImplementation(async function* () {
    yield { type: 'content', content: 'Hello visitor' };
    yield { type: 'done', usage: { input_tokens: 5, output_tokens: 8 } };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

function configDb(config: Record<string, unknown> | null = agentConfigRow()) {
  return {
    first: (sql: string) => {
      if (sql.includes('artifact_agent_config')) return config;
      if (sql.includes('rate_limits')) return null;
      return null;
    },
    all: (sql: string) => {
      if (sql.includes('agent_messages')) return { results: [] };
      if (sql.includes('agent_threads')) return { results: [] };
      return { results: [] };
    },
    run: vi.fn(async () => ({ success: true })),
  };
}

describe('handleVisitorChat', () => {
  it('rejects non-POST', async () => {
    const ctx = makeCtx(makeEnv(configDb()));
    const res = await handleVisitorChat(new Request(BASE_URL, { method: 'GET' }), ctx);
    expect(res.status).toBe(400);
  });

  it('returns forbidden when agent disabled', async () => {
    const ctx = makeCtx(makeEnv(configDb(agentConfigRow({ visitor_enabled: false }))));
    const res = await handleVisitorChat(
      jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'hi' }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('returns forbidden when no config', async () => {
    const ctx = makeCtx(makeEnv(configDb(null)));
    const res = await handleVisitorChat(
      jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'hi' }),
      ctx,
    );
    expect(res.status).toBe(403);
  });

  it('returns 429 when rate limited', async () => {
    mockCheckRateLimit.mockResolvedValue({ allowed: false, retryAfter: 30 });
    const ctx = makeCtx(makeEnv(configDb()));
    const res = await handleVisitorChat(
      jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'hi' }),
      ctx,
    );
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBe('30');
  });


  it('does NOT block a continuing conversation when over credit (grace)', async () => {
    mockResolveAgentAiConfig.mockResolvedValue({
      workspaceId: 'wsp_1',
      aiConfig: { provider: 'openai', apiKey: 'k', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o' },
      byo: false,
    });
    // The conversation exists → grace applies.
    const db = configDb();
    const origFirst = db.first;
    db.first = (sql: string) =>
      sql.includes('FROM agent_threads') ? { id: 'conv_existing' } : origFirst(sql);
    const ctx = makeCtx(makeEnv(db));
    const res = await handleVisitorChat(
      jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'hi', conversationId: 'conv_existing' }),
      ctx,
    );
    expect(res.status).not.toBe(402);
    await readSSE(res);
    expect(mockStreamChat).toHaveBeenCalled();
  });


  it('records billed usage after a successful stream', async () => {
    const ctx = makeCtx(makeEnv(configDb()));
    const res = await handleVisitorChat(
      jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'hi' }),
      ctx,
    );
    await readSSE(res);
    expect(mockRecordAgentUsage).toHaveBeenCalledWith(
      ctx.env,
      expect.objectContaining({ mode: 'visitor', inputTokens: 5, outputTokens: 8, byo: false }),
    );
  });

  it('rejects invalid JSON and missing message', async () => {
    const ctx = makeCtx(makeEnv(configDb()));
    expect((await handleVisitorChat(
      new Request(`${BASE_URL}/chat`, { method: 'POST', body: 'x', headers: { 'Content-Type': 'application/json', 'cf-connecting-ip': '203.0.113.7' } }),
      ctx,
    )).status).toBe(400);
    expect((await handleVisitorChat(jsonRequest(`${BASE_URL}/chat`, 'POST', {}), ctx)).status).toBe(400);
  });

  it('streams SSE for new conversation', async () => {
    const ctx = makeCtx(makeEnv(configDb()));
    const res = await handleVisitorChat(
      jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'What is this app?' }),
      ctx,
    );

    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const events = parseSSEEvents(await readSSE(res));
    expect(events.some((e) => e.type === 'content')).toBe(true);
    expect(events.find((e) => e.type === 'done')).toMatchObject({
      usage: { input_tokens: 5, output_tokens: 8 },
    });
    expect(mockRecordUsage).toHaveBeenCalledWith(ctx.env, ARTIFACT_ID, 'visitor', 5, 8);
    expect(mockIncrementRateLimit).toHaveBeenCalledWith(ctx.env, ARTIFACT_ID, 13);
  });

  it('injects per-message context into the model message but persists it clean', async () => {
    const runCalls: Array<{ sql: string; args: unknown[] }> = [];
    const env = makeEnv({
      first: (sql) => (sql.includes('artifact_agent_config') ? agentConfigRow() : null),
      all: () => ({ results: [] }),
      run: (sql, args) => { runCalls.push({ sql, args }); return { success: true }; },
    });
    const ctx = makeCtx(env);
    const res = await handleVisitorChat(
      jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'Why did revenue change?', context: { revenue: 12345, brand: 'northwind' } }),
      ctx,
    );
    await readSSE(res);

    // Model sees the live data block. streamChat(env, messages, ...)
    const messagesArg = mockStreamChat.mock.calls[0][1] as Array<{ role: string; content: string }>;
    const lastUser = messagesArg[messagesArg.length - 1];
    expect(lastUser.role).toBe('user');
    expect(lastUser.content).toContain('Why did revenue change?');
    expect(lastUser.content).toContain('Live page data');
    expect(lastUser.content).toContain('12345');

    // The persisted user-message row stores only the clean text (role is a bound param now).
    const userInsert = runCalls.find(
      c => c.sql.includes('INSERT INTO agent_messages') && Array.isArray(c.args)
        && (c.args as unknown[]).includes('user') && (c.args as unknown[]).includes('Why did revenue change?'),
    );
    expect(userInsert).toBeDefined();
    expect(JSON.stringify(userInsert!.args)).not.toContain('Live page data');
  });

  it('does not add a context block when none is provided', async () => {
    const ctx = makeCtx(makeEnv(configDb()));
    await readSSE(await handleVisitorChat(
      jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'plain question' }),
      ctx,
    ));
    const messagesArg = mockStreamChat.mock.calls[0][1] as Array<{ role: string; content: string }>;
    expect(messagesArg[messagesArg.length - 1].content).toBe('plain question');
  });

  it('loads existing conversation messages', async () => {
    const env = makeEnv({
      first: (sql) => {
        if (sql.includes('artifact_agent_config')) return agentConfigRow();
        return null;
      },
      all: (sql) => {
        if (sql.includes('agent_messages')) {
          return { results: [{ role: 'assistant', content: 'Welcome' }] };
        }
        return { results: [] };
      },
      run: vi.fn(async () => ({ success: true })),
    });
    const ctx = makeCtx(env);
    const res = await handleVisitorChat(
      jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'Thanks', conversationId: 'conv_1' }),
      ctx,
    );
    await readSSE(res);
    expect(mockStreamChat).toHaveBeenCalledWith(
      env,
      expect.arrayContaining([
        { role: 'assistant', content: 'Welcome' },
        { role: 'user', content: 'Thanks' },
      ]),
      'visitor system',
      'gpt-4o',
      defaultAgentConfig.visitor_max_tokens,
      expect.objectContaining({ provider: 'openai', model: 'gpt-4o' }),
    );
  });

  it('handles stream error chunk', async () => {
    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'error', error: 'AI API error: 500 {"error":"secret upstream body"}' };
      yield { type: 'done', usage: { input_tokens: 0, output_tokens: 0 } };
    });
    const ctx = makeCtx(makeEnv(configDb()));
    const res = await handleVisitorChat(jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'hi' }), ctx);
    const events = parseSSEEvents(await readSSE(res));
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toMatchObject({ type: 'error', error: 'AI request failed' });
    expect(JSON.stringify(errEvent)).not.toContain('secret upstream body');
    expect(mockRecordError).toHaveBeenCalled();
  });

  it('handles unexpected stream failure', async () => {
    mockStreamChat.mockImplementation(async function* () {
      throw new Error('D1_ERROR: no such table');
    });
    const ctx = makeCtx(makeEnv(configDb()));
    const res = await handleVisitorChat(jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'hi' }), ctx);
    const events = parseSSEEvents(await readSSE(res));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: 'Chat failed' });
    expect(JSON.stringify(events.at(-1))).not.toContain('D1_ERROR');
  });

  it('blocks anonymous chat on a public artifact when not opted in (Workstream A)', async () => {
    const ctx = makeCtx(makeEnv(configDb()));
    ctx.artifact.allow_anon_agent = 0; // owner has NOT enabled anon AI chat
    const res = await handleVisitorChat(jsonRequest(`${BASE_URL}/chat`, 'POST', { message: 'hi' }), ctx);
    expect(res.status).toBe(403);
  });
});

describe('handleConversations', () => {
  const sampleConv = {
    id: 'conv_1',
    artifact_id: ARTIFACT_ID,
    mode: 'visitor',
    title: 'Hello',
    message_count: 2,
    created_at: '2026-01-01',
    updated_at: '2026-01-01',
  };

  it('returns conversation with messages on GET by id', async () => {
    const env = makeEnv({
      first: (sql) => {
        if (sql.includes('agent_threads')) return sampleConv;
        return null;
      },
      all: (sql) => {
        if (sql.includes('agent_messages')) {
          return { results: [{ id: 'msg_1', role: 'user', content: 'hi' }] };
        }
        return { results: [] };
      },
    });
    const ctx = makeCtx(env);
    const res = await handleConversations(
      new Request(`${BASE_URL}/conversations/conv_1`, { method: 'GET' }),
      ctx,
      'conv_1',
    );
    const body = await res.json() as { data: { conversation: typeof sampleConv; messages: unknown[] } };
    expect(body.data.conversation.id).toBe('conv_1');
    expect(body.data.messages).toHaveLength(1);
  });

  it('returns 404 for missing conversation', async () => {
    const ctx = makeCtx(makeEnv({ first: () => null }));
    const res = await handleConversations(
      new Request(`${BASE_URL}/conversations/missing`, { method: 'GET' }),
      ctx,
      'missing',
    );
    expect(res.status).toBe(404);
  });

  it('deletes conversation on DELETE', async () => {
    const ctx = makeCtx(makeEnv({ run: vi.fn(async () => ({ success: true })) }));
    const res = await handleConversations(
      new Request(`${BASE_URL}/conversations/conv_1`, { method: 'DELETE' }),
      ctx,
      'conv_1',
    );
    const body = await res.json() as { data: { deleted: boolean } };
    expect(body.data.deleted).toBe(true);
  });

  it('rejects unsupported methods on conversation id', async () => {
    const ctx = makeCtx(makeEnv());
    const res = await handleConversations(
      new Request(`${BASE_URL}/conversations/conv_1`, { method: 'PATCH' }),
      ctx,
      'conv_1',
    );
    expect(res.status).toBe(400);
  });

  it('lists conversations with pagination', async () => {
    const env = makeEnv({
      all: (sql) => {
        if (sql.includes('LIMIT')) return { results: [sampleConv] };
        return { results: [] };
      },
      first: (sql) => {
        if (sql.includes('COUNT(*)')) return { count: 5 };
        return null;
      },
    });
    const ctx = makeCtx(env);
    const res = await handleConversations(
      new Request(`${BASE_URL}/conversations?limit=10&offset=2&mode=admin`, { method: 'GET' }),
      ctx,
    );
    const body = await res.json() as { data: { conversations: unknown[]; total: number; limit: number; offset: number } };
    expect(body.data.total).toBe(5);
    expect(body.data.limit).toBe(10);
    expect(body.data.offset).toBe(2);
  });

  it('rejects non-GET list', async () => {
    const ctx = makeCtx(makeEnv());
    const res = await handleConversations(
      new Request(`${BASE_URL}/conversations`, { method: 'POST' }),
      ctx,
    );
    expect(res.status).toBe(400);
  });
});

describe('handleVisitorConfig', () => {
  it('returns config on GET', async () => {
    const ctx = makeCtx(makeEnv(configDb()));
    const res = await handleVisitorConfig(new Request(`${BASE_URL}/config`, { method: 'GET' }), ctx);
    const body = await res.json() as { data: { config: { visitor_enabled: boolean } } };
    expect(body.data.config.visitor_enabled).toBe(true);
  });

  it('returns null config when not configured', async () => {
    const ctx = makeCtx(makeEnv(configDb(null)));
    const res = await handleVisitorConfig(new Request(`${BASE_URL}/config`, { method: 'GET' }), ctx);
    const body = await res.json() as { data: { config: null } };
    expect(body.data.config).toBeNull();
  });

  it('updates existing config on PUT', async () => {
    const env = makeEnv({
      first: (sql) => {
        if (sql.includes('artifact_agent_config')) return agentConfigRow();
        return null;
      },
      run: vi.fn(async () => ({ success: true })),
    });
    const ctx = makeCtx(env);
    const res = await handleVisitorConfig(
      jsonRequest(`${BASE_URL}/config`, 'PUT', {
        visitor_enabled: false,
        visitor_system_prompt: 'New prompt',
        visitor_context_tables: ['orders'],
      }),
      ctx,
    );
    const body = await res.json() as { data: { config: { visitor_enabled: boolean } } };
    expect(body.data.config.visitor_enabled).toBe(true); // re-fetched from mock
    expect(env.DB.prepare).toHaveBeenCalled();
  });

  it('inserts new config on PUT when none exists', async () => {
    let callCount = 0;
    const env = makeEnv({
      first: () => {
        callCount += 1;
        return callCount === 1 ? null : agentConfigRow({ visitor_enabled: true });
      },
      run: vi.fn(async () => ({ success: true })),
    });
    const ctx = makeCtx(env);
    const res = await handleVisitorConfig(
      jsonRequest(`${BASE_URL}/config`, 'PUT', {
        visitor_enabled: true,
        visitor_system_prompt: 'Welcome',
      }),
      ctx,
    );
    expect(res.status).toBe(200);
  });

  it('rejects invalid JSON on PUT', async () => {
    const ctx = makeCtx(makeEnv(configDb()));
    const res = await handleVisitorConfig(
      new Request(`${BASE_URL}/config`, { method: 'PUT', body: '{bad', headers: { 'Content-Type': 'application/json' } }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('rejects unsupported methods', async () => {
    const ctx = makeCtx(makeEnv(configDb()));
    const res = await handleVisitorConfig(new Request(`${BASE_URL}/config`, { method: 'DELETE' }), ctx);
    expect(res.status).toBe(400);
  });

  it('parses visitor_context_tables from stored JSON', async () => {
    const ctx = makeCtx(makeEnv(configDb(agentConfigRow({
      visitor_context_tables: ['a', 'b'],
    }))));
    const res = await handleVisitorConfig(new Request(`${BASE_URL}/config`, { method: 'GET' }), ctx);
    const body = await res.json() as { data: { config: { visitor_context_tables: string[] } } };
    expect(body.data.config.visitor_context_tables).toEqual(['a', 'b']);
  });
});
