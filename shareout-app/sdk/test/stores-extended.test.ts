import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareOut } from '../src/index';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function createSdk() {
  return new ShareOut({
    artifactId: 'art_1',
    baseUrl: 'https://api.example.com',
    batchDelay: 10,
  });
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('SheetsStore extended APIs', () => {
  it('covers auth, fetch, update, append, and cache helpers', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/sheets/auth-url')) {
        return jsonResponse({ success: true, data: { authUrl: 'https://auth.example.com', message: 'Authorize' } });
      }
      if (url.endsWith('/sheets/token-status')) {
        return jsonResponse({ success: true, data: { connected: true } });
      }
      if (url.endsWith('/sheets/fetch') && init?.method === 'POST') {
        return jsonResponse({
          success: true,
          data: { data: [['A', 'B']], headers: ['col1', 'col2'], rowCount: 1, cached: false },
        });
      }
      if (url.endsWith('/sheets/update') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { updated: true, updatedCells: 2, updatedRows: 1 } });
      }
      if (url.endsWith('/sheets/append') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { appended: true, appendedRows: 1, appendedCells: 2 } });
      }
      if (url.includes('/sheets/cache') && init?.method === 'DELETE') {
        return jsonResponse({ success: true, data: { cleared: true } });
      }
      if (url.includes('/sheets/cache')) {
        return jsonResponse({
          success: true,
          data: { caches: [{ key: 'sheet-a', cachedAt: '2024-01-01T00:00:00Z', rowCount: 10 }], count: 1 },
        });
      }
      if (url.endsWith('/sheets/disconnect') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: {} });
      }
      return jsonResponse({ success: true, data: {} });
    }));

    const sdk = createSdk();

    const authPromise = sdk.sheets.getAuthUrl('/return');
    await vi.advanceTimersByTimeAsync(10);
    await expect(authPromise).resolves.toMatchObject({ authUrl: 'https://auth.example.com' });

    const tokenPromise = sdk.sheets.isConnected();
    await vi.advanceTimersByTimeAsync(10);
    await expect(tokenPromise).resolves.toBe(true);

    const fetchPromise = sdk.sheets.fetch<{ col1: string; col2: string }>({
      spreadsheetId: 'sheet_1',
      range: 'A1:B2',
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(fetchPromise).resolves.toMatchObject({ rowCount: 1 });

    const updatePromise = sdk.sheets.update({
      spreadsheetId: 'sheet_1',
      range: 'A1',
      values: [['Updated']],
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(updatePromise).resolves.toMatchObject({ updatedCells: 2 });

    const appendPromise = sdk.sheets.append({
      spreadsheetId: 'sheet_1',
      range: 'A1',
      values: [['New']],
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(appendPromise).resolves.toMatchObject({ appendedRows: 1 });

    const cacheListPromise = sdk.sheets.cacheStatus();
    await vi.advanceTimersByTimeAsync(10);
    await expect(cacheListPromise).resolves.toMatchObject({ count: 1 });

    const clearCachePromise = sdk.sheets.clearCache('sheet-a');
    await vi.advanceTimersByTimeAsync(10);
    await expect(clearCachePromise).resolves.toMatchObject({ cleared: true });

    const disconnectPromise = sdk.sheets.disconnect();
    await vi.advanceTimersByTimeAsync(10);
    await expect(disconnectPromise).resolves.toBeUndefined();

    const refreshPromise = sdk.sheets.refresh({
      spreadsheetId: 'sheet_1',
      range: 'A1:B2',
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(refreshPromise).resolves.toMatchObject({ rowCount: 1 });
  });
});

describe('Store helpers', () => {
  it('exposes dashboard and slide helper utilities', () => {
    const sdk = createSdk();
    expect(sdk.dashboards.helpers).toBeDefined();
    expect(sdk.slides.helpers).toBeDefined();
  });
});

describe('Comments replies and config', () => {
  it('loads replies and comment configuration', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url.includes('/replies')) {
        return jsonResponse({
          success: true,
          data: { replies: [{ id: 'cmt_2', content: 'Reply' }], count: 1 },
        });
      }
      return jsonResponse({ success: true, data: { enabled: true, moderation: 'open' } });
    }));

    const sdk = createSdk();

    const repliesPromise = sdk.comments.getReplies('cmt_1');
    await vi.advanceTimersByTimeAsync(10);
    await expect(repliesPromise).resolves.toHaveLength(1);

    const configPromise = sdk.comments.getConfig();
    await vi.advanceTimersByTimeAsync(10);
    await expect(configPromise).resolves.toMatchObject({ enabled: true });
  });
});
