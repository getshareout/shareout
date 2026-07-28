import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

// A sandboxed CDN frame: `<hex>.shareoutcdn.site`, parent !== window, and a
// dispatch() helper so a test can deliver a late shareout:init message.
function cdnWindow() {
  const listeners: Record<string, Array<(ev: unknown) => void>> = {};
  const postMessage = vi.fn();
  const win: Record<string, unknown> = {
    addEventListener: (t: string, h: (ev: unknown) => void) => {
      (listeners[t] ||= []).push(h);
    },
    removeEventListener: (t: string, h: (ev: unknown) => void) => {
      listeners[t] = (listeners[t] || []).filter((x) => x !== h);
    },
    dispatch: (t: string, ev: unknown) => {
      (listeners[t] || []).slice().forEach((h) => h(ev));
    },
    parent: { postMessage },
    location: {
      hostname: 'abc123.shareoutcdn.site',
      pathname: '/',
      href: 'https://abc123.shareoutcdn.site/',
    },
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    readyState: 'complete',
    addEventListener: vi.fn(),
  });
  return { win, postMessage };
}

async function freshShareOut() {
  vi.resetModules();
  return (await import('../src/core/shareout')).ShareOut;
}

describe('SDK open is decoupled from late shareout:init', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('resolves create() without waiting for init (id comes from the CDN hostname)', async () => {
    cdnWindow();
    const ShareOut = await freshShareOut();
    // No artifactId, no embedded data, init never delivered. Old behavior blocked
    // up to 10s here; new behavior must resolve immediately.
    const sdk = await ShareOut.create({ baseUrl: 'https://api.example.com' });
    expect(sdk).toBeTruthy();
  });

  it('a data read awaits late init and carries its session token', async () => {
    const { win } = cdnWindow();
    const fetchMock = vi.fn(async () =>
      jsonResponse({ success: true, data: { key: 'k', value: 1, updatedAt: 'now' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const ShareOut = await freshShareOut();
    const sdk = await ShareOut.create({ baseUrl: 'https://api.example.com' });

    const readP = sdk.json.get('k');
    await Promise.resolve();
    // Read is parked on ensureEmbeddedInit — no network yet.
    expect(fetchMock).not.toHaveBeenCalled();

    (win as { dispatch: (t: string, ev: unknown) => void }).dispatch('message', {
      data: {
        type: 'shareout:init',
        data: {
          artifactId: 'art_abc123',
          baseUrl: 'https://api.example.com',
          sessionToken: 'tok_123',
        },
      },
    });

    // Flush the request batcher's short timer under fake timers.
    await vi.advanceTimersByTimeAsync(20);
    await readP;
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = fetchMock.mock.calls[0][1].headers as Headers;
    expect(headers.get('Authorization')).toBe('Bearer tok_123');
  });
});
