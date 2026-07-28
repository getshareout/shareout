// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleAdminChat,
  handleAdminContext,
  handleApplyEdits,
  handlePublish,
} from '../../../../src/data/agent/admin-chat';
import {
  ARTIFACT_ID,
  BASE_URL,
  jsonRequest,
  makeCtx,
  makeEnv,
  makeR2Mock,
  parseSSEEvents,
  readSSE,
} from './helpers';

const mockStreamChat = vi.fn();
const mockBuildAdminContext = vi.fn();
const mockBuildAdminSystemPrompt = vi.fn();
const mockRecordUsage = vi.fn();
const mockRecordError = vi.fn();

vi.mock('../../../../src/data/agent/anthropic', () => ({
  streamChat: (...args: unknown[]) => mockStreamChat(...args),
  getAgentChatModel: vi.fn(() => 'gpt-4o'),
}));

vi.mock('../../../../src/data/agent/context', () => ({
  buildAdminContext: (...args: unknown[]) => mockBuildAdminContext(...args),
  buildAdminSystemPrompt: (...args: unknown[]) => mockBuildAdminSystemPrompt(...args),
}));

vi.mock('../../../../src/data/agent/usage', () => ({
  recordUsage: (...args: unknown[]) => mockRecordUsage(...args),
  recordError: (...args: unknown[]) => mockRecordError(...args),
}));

const mockResolveAgentAiConfig = vi.fn();
const mockRecordAgentUsage = vi.fn();

vi.mock('../../../../src/data/agent/ai-config', () => ({
  resolveAgentAiConfig: (...args: unknown[]) => mockResolveAgentAiConfig(...args),
  recordAgentUsage: (...args: unknown[]) => mockRecordAgentUsage(...args),
}));

const adminContext = {
  files: [{ path: 'index.html', content: '<h1>Hi</h1>', mime: 'text/html' }],
  skillDocs: 'docs',
  artifact: { id: ARTIFACT_ID, name: 'App', visibility: 'public', currentVersion: 1 },
  json: {},
  tables: [],
};

beforeEach(() => {
  mockBuildAdminContext.mockResolvedValue(adminContext);
  mockBuildAdminSystemPrompt.mockReturnValue('system prompt');
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
    yield { type: 'content', content: 'Here is a change:\n```diff\n--- index.html\n+++ index.html\n-<h1>Hi</h1>\n+<h1>Hello</h1>\n```' };
    yield { type: 'done', usage: { input_tokens: 10, output_tokens: 20 } };
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('handleAdminContext', () => {
  it('rejects non-GET', async () => {
    const ctx = makeCtx(makeEnv());
    const res = await handleAdminContext(new Request(BASE_URL, { method: 'POST' }), ctx);
    expect(res.status).toBe(400);
  });

  it('returns built context on success', async () => {
    const ctx = makeCtx(makeEnv());
    const res = await handleAdminContext(new Request(BASE_URL, { method: 'GET' }), ctx);
    const body = await res.json() as { success: boolean; data: { context: unknown } };

    expect(body.success).toBe(true);
    expect(body.data.context).toEqual(adminContext);
  });

  it('returns error when context build fails', async () => {
    mockBuildAdminContext.mockRejectedValue(new Error('D1_ERROR: no such table'));
    const ctx = makeCtx(makeEnv());
    const res = await handleAdminContext(new Request(BASE_URL, { method: 'GET' }), ctx);
    expect(res.status).toBe(500);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('Failed to build context');
    expect(body.error).not.toContain('D1_ERROR');
  });
});

describe('handleAdminChat', () => {
  function chatDb(existingConv = false) {
    return {
      all: (sql: string) => {
        if (sql.includes('agent_messages') && existingConv) {
          return { results: [{ role: 'user', content: 'prior' }] };
        }
        if (sql.includes('FROM assets')) return { results: [] };
        return { results: [] };
      },
      run: vi.fn(async () => ({ success: true })),
    };
  }

  it('rejects non-POST', async () => {
    const ctx = makeCtx(makeEnv());
    const res = await handleAdminChat(new Request(BASE_URL, { method: 'GET' }), ctx);
    expect(res.status).toBe(400);
  });

  it('rejects invalid JSON', async () => {
    const ctx = makeCtx(makeEnv());
    const res = await handleAdminChat(
      new Request(BASE_URL, { method: 'POST', body: 'not-json', headers: { 'Content-Type': 'application/json' } }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('requires message field', async () => {
    const ctx = makeCtx(makeEnv());
    const res = await handleAdminChat(jsonRequest(`${BASE_URL}/admin/chat`, 'POST', {}), ctx);
    expect(res.status).toBe(400);
  });

  it('streams SSE for new conversation with edit suggestions', async () => {
    const ctx = makeCtx(makeEnv(chatDb()));
    const res = await handleAdminChat(
      jsonRequest(`${BASE_URL}/admin/chat`, 'POST', { message: 'Make heading say Hello' }),
      ctx,
    );

    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const raw = await readSSE(res);
    const events = parseSSEEvents(raw);

    expect(events.some((e) => e.type === 'content')).toBe(true);
    const done = events.find((e) => e.type === 'done');
    expect(done).toMatchObject({
      type: 'done',
      usage: { input_tokens: 10, output_tokens: 20 },
    });
    expect((done?.suggestedEdits as unknown[])?.length).toBeGreaterThan(0);
    expect(mockRecordUsage).toHaveBeenCalledWith(ctx.env, ARTIFACT_ID, 'admin', 10, 20);
  });

  it('loads existing conversation when conversationId provided', async () => {
    const ctx = makeCtx(makeEnv(chatDb(true)));
    const res = await handleAdminChat(
      jsonRequest(`${BASE_URL}/admin/chat`, 'POST', { message: 'follow up', conversationId: 'conv_existing' }),
      ctx,
    );

    await readSSE(res);
    expect(mockStreamChat).toHaveBeenCalledWith(
      ctx.env,
      expect.arrayContaining([
        { role: 'user', content: 'prior' },
        { role: 'user', content: 'follow up' },
      ]),
      'system prompt',
      'gpt-4o',
      8192,
      expect.objectContaining({ provider: 'openai', model: 'gpt-4o' }),
    );
  });

  it('emits stream error chunk and records error', async () => {
    mockStreamChat.mockImplementation(async function* () {
      yield { type: 'error', error: 'AI API error: 401 invalid key' };
      yield { type: 'done', usage: { input_tokens: 0, output_tokens: 0 } };
    });
    const ctx = makeCtx(makeEnv(chatDb()));
    const res = await handleAdminChat(
      jsonRequest(`${BASE_URL}/admin/chat`, 'POST', { message: 'test' }),
      ctx,
    );
    const events = parseSSEEvents(await readSSE(res));
    const errEvent = events.find((e) => e.type === 'error');
    expect(errEvent).toMatchObject({ type: 'error', error: 'AI request failed' });
    expect(JSON.stringify(errEvent)).not.toContain('invalid key');
    expect(mockRecordError).toHaveBeenCalled();
  });

  it('handles unexpected stream failure', async () => {
    mockStreamChat.mockImplementation(async function* () {
      throw new Error('D1_ERROR: disk I/O error');
    });
    const ctx = makeCtx(makeEnv(chatDb()));
    const res = await handleAdminChat(
      jsonRequest(`${BASE_URL}/admin/chat`, 'POST', { message: 'test' }),
      ctx,
    );
    const events = parseSSEEvents(await readSSE(res));
    expect(events.at(-1)).toMatchObject({ type: 'error', error: 'Chat failed' });
    expect(JSON.stringify(events.at(-1))).not.toContain('D1_ERROR');
    expect(mockRecordError).toHaveBeenCalled();
  });

  it('parses file: path code block suggestions', async () => {
    mockStreamChat.mockImplementation(async function* () {
      yield {
        type: 'content',
        content: 'file: styles.css\n```css\nbody { color: red; }\n```',
      };
      yield { type: 'done', usage: { input_tokens: 1, output_tokens: 1 } };
    });
    const ctx = makeCtx(makeEnv(chatDb()));
    const res = await handleAdminChat(
      jsonRequest(`${BASE_URL}/admin/chat`, 'POST', { message: 'style it' }),
      ctx,
    );
    const done = parseSSEEvents(await readSSE(res)).find((e) => e.type === 'done');
    const edits = done?.suggestedEdits as Array<{ file: string }>;
    expect(edits?.[0]?.file).toBe('styles.css');
  });
});

describe('handleApplyEdits', () => {
  it('rejects non-POST and invalid body', async () => {
    const ctx = makeCtx(makeEnv());
    expect((await handleApplyEdits(new Request(BASE_URL, { method: 'GET' }), ctx)).status).toBe(400);
    expect((await handleApplyEdits(jsonRequest(BASE_URL, 'POST', 'bad'), ctx)).status).toBe(400);
    expect((await handleApplyEdits(jsonRequest(BASE_URL, 'POST', {}), ctx)).status).toBe(400);
  });

  it('rejects invalid JSON body', async () => {
    const ctx = makeCtx(makeEnv());
    const res = await handleApplyEdits(
      new Request(BASE_URL, { method: 'POST', body: '{', headers: { 'Content-Type': 'application/json' } }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when no version exists', async () => {
    const ctx = makeCtx(makeEnv({ first: () => null }));
    const res = await handleApplyEdits(
      jsonRequest(BASE_URL, 'POST', { conversationId: 'conv_1', edits: [{ file: 'a.html', type: 'replace', replace: 'x' }] }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('applies search-replace edit successfully', async () => {
    const env = makeEnv({
      first: (sql, args) => {
        if (sql.includes('FROM versions')) return { id: 'ver_1' };
        if (sql.includes('FROM assets')) return { r2_key: 'r2/index.html', mime: 'text/html' };
        return null;
      },
    }, { ARTIFACTS: makeR2Mock({ getText: { 'r2/index.html': '<h1>Hi</h1>' } }) });
    const ctx = makeCtx(env);

    const res = await handleApplyEdits(
      jsonRequest(BASE_URL, 'POST', {
        conversationId: 'conv_1',
        edits: [{ file: 'index.html', type: 'replace', search: '<h1>Hi</h1>', replace: '<h1>Hello</h1>' }],
      }),
      ctx,
    );
    const body = await res.json() as { data: { applied: Array<{ success: boolean }> } };
    expect(body.data.applied[0].success).toBe(true);
  });

  it('reports search text not found', async () => {
    const env = makeEnv({
      first: (sql) => {
        if (sql.includes('FROM versions')) return { id: 'ver_1' };
        if (sql.includes('FROM assets')) return { r2_key: 'r2/f', mime: 'text/plain' };
        return null;
      },
    }, { ARTIFACTS: makeR2Mock({ getText: { 'r2/f': 'content' } }) });
    const ctx = makeCtx(env);

    const res = await handleApplyEdits(
      jsonRequest(BASE_URL, 'POST', {
        conversationId: 'conv_1',
        edits: [{ file: 'f.txt', type: 'replace', search: 'missing', replace: 'new' }],
      }),
      ctx,
    );
    const body = await res.json() as { data: { applied: Array<{ success: boolean; error?: string }> } };
    expect(body.data.applied[0]).toEqual({ file: 'f.txt', success: false, error: 'Search text not found' });
  });

  it('applies full file replacement when no search', async () => {
    const env = makeEnv({
      first: (sql) => {
        if (sql.includes('FROM versions')) return { id: 'ver_1' };
        if (sql.includes('FROM assets')) return null;
        return null;
      },
    });
    const ctx = makeCtx(env);

    const res = await handleApplyEdits(
      jsonRequest(BASE_URL, 'POST', {
        conversationId: 'conv_1',
        edits: [{ file: 'new.html', type: 'replace', replace: '<html></html>' }],
      }),
      ctx,
    );
    const body = await res.json() as { data: { applied: Array<{ success: boolean }> } };
    expect(body.data.applied[0].success).toBe(true);
  });

  it('rejects invalid edit type', async () => {
    const env = makeEnv({
      first: (sql) => {
        if (sql.includes('FROM versions')) return { id: 'ver_1' };
        if (sql.includes('FROM assets')) return { r2_key: 'r2/f', mime: 'text/plain' };
        return null;
      },
    });
    const ctx = makeCtx(env);

    const res = await handleApplyEdits(
      jsonRequest(BASE_URL, 'POST', {
        conversationId: 'conv_1',
        edits: [{ file: 'f.txt', type: 'delete' }],
      }),
      ctx,
    );
    const body = await res.json() as { data: { applied: Array<{ success: boolean; error?: string }> } };
    expect(body.data.applied[0].error).toBe('Invalid edit type');
  });

  it('captures per-edit exceptions', async () => {
    const env = makeEnv({
      first: (sql) => {
        if (sql.includes('FROM versions')) return { id: 'ver_1' };
        if (sql.includes('FROM assets')) throw new Error('D1_ERROR: disk I/O error');
        return null;
      },
    });
    const ctx = makeCtx(env);

    const res = await handleApplyEdits(
      jsonRequest(BASE_URL, 'POST', {
        conversationId: 'conv_1',
        edits: [{ file: 'f.txt', type: 'replace', replace: 'x' }],
      }),
      ctx,
    );
    const body = await res.json() as { data: { applied: Array<{ success: boolean; error?: string }> } };
    expect(body.data.applied[0]).toMatchObject({ success: false, error: 'Failed to apply edit' });
    expect(body.data.applied[0].error).not.toContain('D1_ERROR');
  });
});

describe('handlePublish', () => {
  const pendingEdit = {
    id: 'ped_1',
    artifact_id: ARTIFACT_ID,
    conversation_id: 'conv_1',
    file_path: 'index.html',
    original_content: '<h1>Hi</h1>',
    new_content: '<h1>Hello</h1>',
    status: 'pending',
    created_at: '2026-01-01',
  };

  function publishDb(options: {
    pending?: typeof pendingEdit[];
    artifact?: boolean;
    version?: { id: string; version_no: number } | null;
    assets?: Array<{ path: string; r2_key: string; mime: string; size_bytes: number; sha256: string }>;
    deployment?: { slug: string } | null;
  } = {}) {
    const {
      pending = [pendingEdit],
      artifact = true,
      version = { id: 'ver_1', version_no: 1 },
      assets = [{ path: 'index.html', r2_key: 'r2/old', mime: 'text/html', size_bytes: 10, sha256: 'abc' }],
      deployment = { slug: 'my-app' },
    } = options;

    return {
      all: (sql: string) => {
        if (sql.includes('artifact_pending_edits')) return { results: pending };
        if (sql.includes('FROM assets')) return { results: assets };
        return { results: [] };
      },
      first: (sql: string) => {
        if (sql.includes('FROM artifacts')) {
          return artifact ? { id: ARTIFACT_ID, name: 'App', slug: 'app', visibility: 'public' } : null;
        }
        if (sql.includes('FROM versions')) return version;
        if (sql.includes('FROM deployments')) return deployment;
        return null;
      },
      run: vi.fn(async () => ({ success: true })),
    };
  }

  it('validates method and body', async () => {
    const ctx = makeCtx(makeEnv());
    expect((await handlePublish(new Request(BASE_URL, { method: 'GET' }), ctx)).status).toBe(400);
    expect((await handlePublish(jsonRequest(BASE_URL, 'POST', {}), ctx)).status).toBe(400);
  });

  it('rejects invalid JSON body', async () => {
    const ctx = makeCtx(makeEnv(publishDb()));
    const res = await handlePublish(
      new Request(BASE_URL, { method: 'POST', body: 'bad', headers: { 'Content-Type': 'application/json' } }),
      ctx,
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when no pending edits', async () => {
    const ctx = makeCtx(makeEnv(publishDb({ pending: [] })));
    const res = await handlePublish(
      jsonRequest(BASE_URL, 'POST', { conversationId: 'conv_1' }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when artifact missing', async () => {
    const ctx = makeCtx(makeEnv(publishDb({ artifact: false })));
    const res = await handlePublish(
      jsonRequest(BASE_URL, 'POST', { conversationId: 'conv_1' }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when no version', async () => {
    const ctx = makeCtx(makeEnv(publishDb({ version: null })));
    const res = await handlePublish(
      jsonRequest(BASE_URL, 'POST', { conversationId: 'conv_1' }),
      ctx,
    );
    expect(res.status).toBe(404);
  });

  it('publishes new version with edited and copied assets', async () => {
    const putMock = vi.fn(async () => undefined);
    const db = publishDb({
      assets: [
        { path: 'index.html', r2_key: 'r2/old-html', mime: 'text/html', size_bytes: 10, sha256: 'a' },
        { path: 'style.css', r2_key: 'r2/old-css', mime: 'text/css', size_bytes: 5, sha256: 'b' },
      ],
    });
    const env = makeEnv(db, { ARTIFACTS: makeR2Mock({ put: putMock }) });
    const ctx = makeCtx(env);

    const res = await handlePublish(
      jsonRequest(BASE_URL, 'POST', { conversationId: 'conv_1', commitMessage: 'Update heading' }),
      ctx,
    );
    const body = await res.json() as { data: { version: { version_no: number }; url: string; appliedEdits: number } };

    expect(body.data.version.version_no).toBe(2);
    expect(body.data.url).toBe(`${BASE_URL}/a/my-app`);
    expect(body.data.appliedEdits).toBe(1);
    expect(putMock).toHaveBeenCalled();
  });

  it('returns null url when deployment slug missing', async () => {
    const ctx = makeCtx(makeEnv(publishDb({ deployment: null })));
    const res = await handlePublish(
      jsonRequest(BASE_URL, 'POST', { conversationId: 'conv_1' }),
      ctx,
    );
    const body = await res.json() as { data: { url: string | null } };
    expect(body.data.url).toBeNull();
  });
});
