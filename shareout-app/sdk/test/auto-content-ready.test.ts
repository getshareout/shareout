import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function stubEmbeddedWindow(postMessage: ReturnType<typeof vi.fn>): void {
  const win: Record<string, unknown> = {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    parent: { postMessage },
  };
  vi.stubGlobal('window', win);
}

// Each test needs the module's ready state fresh (it models one page load), so we
// reset modules and re-import ShareOut per test.
async function freshShareOut() {
  vi.resetModules();
  return (await import('../src/core/shareout')).ShareOut;
}

describe('SDK auto content-ready', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('fires content-ready after the network goes idle following a data call', async () => {
    const postMessage = vi.fn();
    stubEmbeddedWindow(postMessage);
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse({ success: true, data: { key: 'k', value: 1, updatedAt: 'now' } }),
    ));

    const ShareOut = await freshShareOut();
    const sdk = await ShareOut.create({ artifactId: 'art_1', baseUrl: 'https://api.example.com' });
    await sdk.json.set('k', 1);

    // Not yet — the idle debounce hasn't elapsed.
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'shareout:content-ready' }, '*');

    await vi.advanceTimersByTimeAsync(450);
    expect(postMessage).toHaveBeenCalledWith({ type: 'shareout:content-ready' }, '*');
  });

  it('fires content-ready via the no-activity fallback when no data calls are made', async () => {
    const postMessage = vi.fn();
    stubEmbeddedWindow(postMessage);

    const ShareOut = await freshShareOut();
    await ShareOut.create({ artifactId: 'art_1', baseUrl: 'https://api.example.com' });
    expect(postMessage).not.toHaveBeenCalledWith({ type: 'shareout:content-ready' }, '*');

    await vi.advanceTimersByTimeAsync(1100);
    expect(postMessage).toHaveBeenCalledWith({ type: 'shareout:content-ready' }, '*');
  });

  it('does not fire when not embedded in an iframe', async () => {
    const postMessage = vi.fn();
    const win: Record<string, unknown> = { addEventListener: vi.fn(), postMessage };
    win.parent = win; // top-level: parent === window
    vi.stubGlobal('window', win);

    const ShareOut = await freshShareOut();
    await ShareOut.create({ artifactId: 'art_1', baseUrl: 'https://api.example.com' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(postMessage).not.toHaveBeenCalled();
  });
});
