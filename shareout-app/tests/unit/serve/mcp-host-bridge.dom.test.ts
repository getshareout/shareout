// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMcpHostBridge } from '../../../src/serve/sandbox-viewer/bridge-script';

type Posted = { type: string; requestId?: string; [k: string]: unknown };

let frameWin: { postMessage: ReturnType<typeof vi.fn> };
let fetchMock: ReturnType<typeof vi.fn>;
const added: [string, EventListenerOrEventListenerObject][] = [];

// Each test boots a fresh bridge; capture its window listeners so the previous
// test's bridge can't also answer this test's messages.
function boot(lang = 'en') {
  const html = renderMcpHostBridge('art_1', lang);
  const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));
  const original = window.addEventListener.bind(window);
  window.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject, o?: unknown) => {
    added.push([type, fn]);
    return original(type, fn, o as AddEventListenerOptions);
  }) as typeof window.addEventListener;
  try {
    eval(js);
  } finally {
    window.addEventListener = original;
  }
}

function teardown() {
  for (const [type, fn] of added.splice(0)) window.removeEventListener(type, fn);
}

function fromFrame(data: unknown, source: unknown = frameWin) {
  const ev = new MessageEvent('message', { data });
  Object.defineProperty(ev, 'source', { value: source });
  window.dispatchEvent(ev);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const flush = () => new Promise((r) => setTimeout(r, 0));
const posted = (): Posted[] => frameWin.postMessage.mock.calls.map((c) => c[0] as Posted);
const consentState = (conn: Record<string, unknown>) => ({
  workspaceId: 'wsp_1',
  connections: [{ name: 'notion', tools: ['search'], available: true, connectionId: 'conn_1', needsSignIn: true, ...conn }],
});

beforeEach(() => {
  delete (window as { __shareoutMcpBridge?: boolean }).__shareoutMcpBridge;
  document.body.innerHTML = '<iframe></iframe>';
  frameWin = { postMessage: vi.fn() };
  Object.defineProperty(document.querySelector('iframe')!, 'contentWindow', { value: frameWin });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  boot();
});

afterEach(() => {
  teardown();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('MCP host bridge', () => {
  it('answers token requests from its own frame with a same-origin fetch', async () => {
    fetchMock.mockResolvedValueOnce(json(200, { token: 'mcpt.x', expiresAt: 123 }));
    fromFrame({ type: 'shareout:mcp-token-request', requestId: 'r1' });
    await flush(); await flush();
    expect(fetchMock.mock.calls[0][0]).toBe('/v1/artifacts/art_1/mcp/token');
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'same-origin' });
    expect(posted()[0]).toMatchObject({ type: 'shareout:mcp-token', requestId: 'r1', token: 'mcpt.x', expiresAt: 123 });
  });

  it('ignores messages from any other window', async () => {
    fromFrame({ type: 'shareout:mcp-token-request', requestId: 'r1' }, {});
    fromFrame({ type: 'shareout:mcp-access-request', requestId: 'r2', connection: 'notion' }, window);
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(document.querySelector('.so-c-modal')).toBeNull();
  });

  it('allows without a dialog when already connected and allowed', async () => {
    fetchMock.mockResolvedValueOnce(json(200, consentState({ connected: true, allowed: true })));
    fromFrame({ type: 'shareout:mcp-access-request', requestId: 'r1', connection: 'notion' });
    await flush(); await flush();
    expect(document.querySelector('.so-c-modal')).toBeNull();
    expect(posted()[0]).toMatchObject({ type: 'shareout:mcp-access', allowed: true, connected: true });
  });

  it('shows the dialog, and Allow grants consent for that connection', async () => {
    fetchMock
      .mockResolvedValueOnce(json(200, consentState({ connected: true, allowed: false })))
      .mockResolvedValueOnce(json(200, consentState({ connected: true, allowed: true })));
    fromFrame({ type: 'shareout:mcp-access-request', requestId: 'r1', connection: 'notion' });
    await flush(); await flush();

    const modal = document.querySelector('.so-c-modal')!;
    expect(modal.textContent).toContain('Use your notion account on this page?');
    expect(modal.textContent).toContain('It can use: search');
    const allow = modal.querySelector<HTMLButtonElement>('.so-c-btn--primary')!;
    expect(allow.textContent).toBe('Allow');
    allow.click();
    await flush(); await flush();

    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe('/v1/artifacts/art_1/mcp/consent');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ connections: ['notion'] });
    expect(document.querySelector('.so-c-modal')).toBeNull();
    expect(posted()[0]).toMatchObject({ type: 'shareout:mcp-access', requestId: 'r1', allowed: true });
  });

  it('"Not now" is final for this page load', async () => {
    fetchMock.mockResolvedValue(json(200, consentState({ connected: true, allowed: false })));
    fromFrame({ type: 'shareout:mcp-access-request', requestId: 'r1', connection: 'notion' });
    await flush(); await flush();
    document.querySelector<HTMLButtonElement>('.so-c-btn--secondary')!.click();
    expect(posted()[0]).toMatchObject({ allowed: false, code: 'declined' });

    fromFrame({ type: 'shareout:mcp-access-request', requestId: 'r2', connection: 'notion' });
    await flush();
    expect(document.querySelector('.so-c-modal')).toBeNull();
    expect(posted()[1]).toMatchObject({ requestId: 'r2', allowed: false, code: 'declined' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('offers Connect first and opens the sign-in popup synchronously on click', async () => {
    const popup = { location: { href: '' }, close: vi.fn() };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
    fetchMock
      .mockResolvedValueOnce(json(200, consentState({ connected: false, allowed: false })))
      .mockResolvedValueOnce(json(200, { authUrl: 'https://auth.example.com/authorize?x=1' }));
    fromFrame({ type: 'shareout:mcp-access-request', requestId: 'r1', connection: 'notion' });
    await flush(); await flush();

    const primary = document.querySelector<HTMLButtonElement>('.so-c-btn--primary')!;
    expect(primary.textContent).toBe('Connect notion');
    primary.click();
    expect(open).toHaveBeenCalledWith('about:blank', 'so_mcp_conn_1', expect.any(String));
    await flush(); await flush();
    expect(fetchMock.mock.calls[1][0]).toBe('/v1/workspaces/wsp_1/connections/conn_1/mcp/connect');
    expect(popup.location.href).toBe('https://auth.example.com/authorize?x=1');
  });

  it('localizes the dialog', async () => {
    teardown();
    delete (window as { __shareoutMcpBridge?: boolean }).__shareoutMcpBridge;
    document.body.innerHTML = '<iframe></iframe>';
    Object.defineProperty(document.querySelector('iframe')!, 'contentWindow', { value: frameWin });
    boot('es-AR');
    fetchMock.mockResolvedValue(json(200, consentState({ connected: true, allowed: false })));
    fromFrame({ type: 'shareout:mcp-access-request', requestId: 'r1', connection: 'notion' });
    await flush(); await flush();
    expect(document.querySelector('.so-c-btn--primary')!.textContent).toBe('Permitir');
  });
});
