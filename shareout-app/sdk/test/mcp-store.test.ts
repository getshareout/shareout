import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { McpError, McpStore, _resetMcpTokenCache } from '../src/stores/mcp-store';
import type { SdkClient } from '../src/core/sdk-client';

type Listener = (e: MessageEvent) => void;

function frame(tokens: string[], opts: { replySource?: 'parent' | 'other' } = {}) {
  const listeners = new Set<Listener>();
  const requests: unknown[] = [];
  const parent = {
    postMessage: vi.fn((msg: { type: string; requestId: string }) => {
      requests.push(msg);
      const token = tokens.shift() ?? null;
      queueMicrotask(() => {
        for (const l of [...listeners]) {
          l({
            source: opts.replySource === 'other' ? {} : parent,
            data: { type: 'shareout:mcp-token', requestId: msg.requestId, token, expiresAt: Date.now() + 300_000 },
          } as unknown as MessageEvent);
        }
      });
    }),
  };
  vi.stubGlobal('window', {
    parent,
    addEventListener: (_t: string, l: Listener) => listeners.add(l),
    removeEventListener: (_t: string, l: Listener) => listeners.delete(l),
  });
  return { parent, requests };
}

const sdk = { _baseUrl: 'https://shareout.test', _artifactId: 'art_1' } as unknown as SdkClient;

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

beforeEach(() => _resetMcpTokenCache());
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('sdk.mcp', () => {
  it('asks the parent for a broker token and sends it as Bearer', async () => {
    const { requests } = frame(['mcpt.one']);
    const fetchMock = vi.fn(async () => reply(200, { success: true, data: { content: [{ type: 'text', text: '{"n":3}' }] } }));
    vi.stubGlobal('fetch', fetchMock);

    const result = await new McpStore(sdk).callTool('notion', 'search', { q: 'x' });
    expect(result.payload).toEqual({ n: 3 });
    expect(requests).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://shareout.test/v1/data/art_1/mcp/call');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer mcpt.one');
    expect(JSON.parse(init.body as string)).toEqual({ connection: 'notion', tool: 'search', input: { q: 'x' } });
  });

  it('reuses a cached token and refreshes once on token_stale', async () => {
    const { requests } = frame(['mcpt.one', 'mcpt.two']);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply(200, { success: true, data: { connections: [] } }))
      .mockResolvedValueOnce(reply(401, { success: false, code: 'token_stale', error: 'stale' }))
      .mockResolvedValueOnce(reply(200, { success: true, data: { content: [], structuredContent: { ok: 1 } } }));
    vi.stubGlobal('fetch', fetchMock);

    const mcp = new McpStore(sdk);
    await mcp.listConnections();
    const result = await mcp.callTool('notion', 'search');
    expect(result.payload).toEqual({ ok: 1 });
    expect(requests).toHaveLength(2);
    expect((fetchMock.mock.calls[2][1] as RequestInit & { headers: Record<string, string> }).headers.Authorization).toBe('Bearer mcpt.two');
  });

  it('rejects with McpError carrying code, connection and retryable', async () => {
    frame(['mcpt.one']);
    vi.stubGlobal('fetch', vi.fn(async () => reply(403, { success: false, code: 'approval_required', error: 'Allow it', connection: 'notion' })));
    const err = await new McpStore(sdk).callTool('notion', 'search').catch((x) => x);
    expect(err).toBeInstanceOf(McpError);
    expect(err).toMatchObject({ code: 'approval_required', connection: 'notion', retryable: false, status: 403 });
  });

  it('ignores token replies from windows other than the parent', async () => {
    vi.useFakeTimers();
    frame(['mcpt.evil'], { replySource: 'other' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const pending = new McpStore(sdk).listConnections().catch((x) => x);
    await vi.advanceTimersByTimeAsync(10_001);
    const err = await pending;
    expect(err.code).toBe('mcp_not_available');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('is unavailable outside a ShareOut frame', async () => {
    const self: Record<string, unknown> = {};
    self.parent = self;
    vi.stubGlobal('window', self);
    const err = await new McpStore(sdk).listConnections().catch((x) => x);
    expect(err.code).toBe('mcp_not_available');
  });
});

describe('sdk.mcp.requestAccess', () => {
  it('asks the parent and resolves with its answer, ignoring other windows', async () => {
    const listeners = new Set<Listener>();
    const parent = {
      postMessage: vi.fn((msg: { type: string; requestId: string; connection: string }) => {
        queueMicrotask(() => {
          for (const l of [...listeners]) {
            l({ source: {}, data: { type: 'shareout:mcp-access', requestId: msg.requestId, allowed: true, connected: true } } as unknown as MessageEvent);
            l({ source: parent, data: { type: 'shareout:mcp-access', requestId: msg.requestId, allowed: false, connected: true, code: 'declined' } } as unknown as MessageEvent);
          }
        });
      }),
    };
    vi.stubGlobal('window', {
      parent,
      addEventListener: (_t: string, l: Listener) => listeners.add(l),
      removeEventListener: (_t: string, l: Listener) => listeners.delete(l),
    });
    const res = await new McpStore(sdk).requestAccess('notion');
    expect(parent.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'shareout:mcp-access-request', connection: 'notion' }), '*');
    expect(res).toEqual({ allowed: false, connected: true, code: 'declined' });
  });
});

describe('sdk.mcp.watchTool', () => {
  function docStub(state: { hidden: boolean }) {
    const listeners = new Set<() => void>();
    vi.stubGlobal('document', {
      get visibilityState() { return state.hidden ? 'hidden' : 'visible'; },
      addEventListener: (_t: string, l: () => void) => listeners.add(l),
      removeEventListener: (_t: string, l: () => void) => listeners.delete(l),
    });
    return { show() { state.hidden = false; for (const l of [...listeners]) l(); } };
  }

  it('polls no faster than every 30 s and stops after unsubscribe', async () => {
    vi.useFakeTimers();
    frame(['mcpt.one']);
    docStub({ hidden: false });
    const fetchMock = vi.fn(async () => reply(200, { success: true, data: { content: [], structuredContent: { n: 1 } } }));
    vi.stubGlobal('fetch', fetchMock);
    const events: string[] = [];
    const stop = new McpStore(sdk).watchTool('notion', 'search', {}, (e) => events.push(e.type), { refetchInterval: 1000 });
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(29_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    stop();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toEqual(['data', 'data']);
  });

  it('stops polling on errors only the viewer can fix', async () => {
    vi.useFakeTimers();
    frame(['mcpt.one']);
    docStub({ hidden: false });
    const fetchMock = vi.fn(async () => reply(403, { success: false, code: 'approval_required', error: 'Allow it', connection: 'notion' }));
    vi.stubGlobal('fetch', fetchMock);
    const codes: string[] = [];
    new McpStore(sdk).watchTool('notion', 'search', {}, (e) => { if (e.type === 'error') codes.push(e.error.code); }, { refetchInterval: 30_000 });
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(codes).toEqual(['approval_required']);
  });

  it('waits while the page is hidden and catches up when it is shown', async () => {
    vi.useFakeTimers();
    frame(['mcpt.one']);
    const state = { hidden: false };
    const visibility = docStub(state);
    const fetchMock = vi.fn(async () => reply(200, { success: true, data: { content: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    new McpStore(sdk).watchTool('notion', 'search', {}, () => {}, { refetchInterval: 30_000 });
    await vi.advanceTimersByTimeAsync(0);
    state.hidden = true;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    visibility.show();
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
