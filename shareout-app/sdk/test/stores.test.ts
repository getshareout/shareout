import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShareOut, ShareOutError } from '../src/index';

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

describe('CommentsStore', () => {
  it('creates, edits, deletes, queries, and loads threads', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/comments') && init?.method === 'POST') {
        const body = JSON.parse(init.body as string);
        if (body.parentId) {
          return jsonResponse({
            success: true,
            data: { id: 'cmt_2', content: body.content, parentId: body.parentId, createdAt: '2024-01-01T00:00:00Z' },
          });
        }
        return jsonResponse({
          success: true,
          data: { id: 'cmt_1', content: body.content, contextId: body.contextId, createdAt: '2024-01-01T00:00:00Z' },
        });
      }
      if (url.includes('/comments/') && url.includes('/replies')) {
        return jsonResponse({
          success: true,
          data: { replies: [], count: 0 },
        });
      }
      if (url.includes('/comments/cmt_1') && init?.method === 'PATCH') {
        return jsonResponse({
          success: true,
          data: { id: 'cmt_1', content: 'Updated', contextId: 'page', createdAt: '2024-01-01T00:00:00Z' },
        });
      }
      if (url.includes('/comments/cmt_1') && init?.method === 'DELETE') {
        return jsonResponse({ success: true, data: {} });
      }
      if (url.includes('/comments/cmt_1')) {
        return jsonResponse({
          success: true,
          data: { id: 'cmt_1', content: 'Hello', contextId: 'page', createdAt: '2024-01-01T00:00:00Z' },
        });
      }
      if (url.includes('/comments?')) {
        return jsonResponse({
          success: true,
          data: { comments: [{ id: 'cmt_1', content: 'Hello', contextId: 'page', createdAt: '2024-01-01T00:00:00Z' }], count: 1 },
        });
      }
      if (url.endsWith('/comments/_config') && init?.method === 'PUT') {
        return jsonResponse({ success: true, data: { enabled: true, moderation: 'open' } });
      }
      if (url.endsWith('/comments/_config')) {
        return jsonResponse({ success: true, data: { enabled: true, moderation: 'closed' } });
      }
      return jsonResponse({ success: true, data: {} });
    }));

    const sdk = createSdk();

    const addPromise = sdk.comments.add({ content: 'Hello', contextId: 'page' });
    await vi.advanceTimersByTimeAsync(10);
    await expect(addPromise).resolves.toMatchObject({ id: 'cmt_1', content: 'Hello' });

    const replyPromise = sdk.comments.reply('cmt_1', 'Reply');
    await vi.advanceTimersByTimeAsync(10);
    await expect(replyPromise).resolves.toMatchObject({ content: 'Reply' });

    const editPromise = sdk.comments.edit('cmt_1', 'Updated');
    await vi.advanceTimersByTimeAsync(10);
    await expect(editPromise).resolves.toMatchObject({ content: 'Updated' });

    const listPromise = sdk.comments.find({ contextId: 'page' }).limit(10).exec();
    await vi.advanceTimersByTimeAsync(10);
    await expect(listPromise).resolves.toHaveLength(1);

    const getPromise = sdk.comments.findById('cmt_1');
    await vi.advanceTimersByTimeAsync(10);
    await expect(getPromise).resolves.toMatchObject({ id: 'cmt_1' });

    const configPromise = sdk.comments.setConfig({ moderation: 'open' });
    await vi.advanceTimersByTimeAsync(10);
    await expect(configPromise).resolves.toMatchObject({ moderation: 'open' });

    const deletePromise = sdk.comments.delete('cmt_1');
    await vi.advanceTimersByTimeAsync(10);
    await expect(deletePromise).resolves.toBe(true);
  });

  it('returns null or false for missing comments', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: false,
      error: 'Missing',
      code: 'COMMENT_NOT_FOUND',
    }, 404)));

    const sdk = createSdk();
    const findPromise = sdk.comments.findById('missing');
    const deletePromise = sdk.comments.delete('missing');
    await vi.advanceTimersByTimeAsync(10);

    await expect(findPromise).resolves.toBeNull();
    await expect(deletePromise).resolves.toBe(false);
  });
});

describe('SheetsStore', () => {
  it('lists connections and performs import/export actions', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/sheets/status')) {
        return jsonResponse({ success: true, data: { connected: true, email: 'user@example.com' } });
      }
      if (url.endsWith('/sheets') && init?.method === 'POST') {
        return jsonResponse({
          success: true,
          data: { name: 'sales', spreadsheetId: 'sheet_1', targetTable: 'sales_rows' },
        });
      }
      if (url.endsWith('/sheets/import/sales') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { imported: 10, columns: ['a'], rows: [] } });
      }
      if (url.endsWith('/sheets/export/sales') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { exported: 5, spreadsheetId: 'sheet_1', columns: ['a'] } });
      }
      if (url.endsWith('/sheets/sales') && init?.method === 'DELETE') {
        return jsonResponse({ success: true, data: {} });
      }
      if (url.endsWith('/sheets/sales')) {
        return jsonResponse({
          success: true,
          data: { name: 'sales', spreadsheetId: 'sheet_1', targetTable: 'sales_rows' },
        });
      }
      return jsonResponse({
        success: true,
        data: { connections: [{ name: 'sales', spreadsheetId: 'sheet_1', targetTable: 'sales_rows' }], count: 1 },
      });
    }));

    const sdk = createSdk();

    const statusPromise = sdk.sheets.status();
    await vi.advanceTimersByTimeAsync(10);
    await expect(statusPromise).resolves.toMatchObject({ connected: true });

    expect(sdk.sheets.getConnectUrl('/done')).toContain('/sheets/connect?return=%2Fdone');

    const listPromise = sdk.sheets.list();
    await vi.advanceTimersByTimeAsync(10);
    await expect(listPromise).resolves.toHaveLength(1);

    const createPromise = sdk.sheets.create({
      name: 'sales',
      spreadsheetId: 'sheet_1',
      targetTable: 'sales_rows',
    });
    await vi.advanceTimersByTimeAsync(10);
    await expect(createPromise).resolves.toMatchObject({ name: 'sales' });

    const importPromise = sdk.sheets.import('sales');
    await vi.advanceTimersByTimeAsync(10);
    await expect(importPromise).resolves.toMatchObject({ imported: 10 });

    const exportPromise = sdk.sheets.export('sales');
    await vi.advanceTimersByTimeAsync(10);
    await expect(exportPromise).resolves.toMatchObject({ exported: 5 });

    const deletePromise = sdk.sheets.delete('sales');
    await vi.advanceTimersByTimeAsync(10);
    await expect(deletePromise).resolves.toBe(true);
  });
});

describe('DashboardsStore', () => {
  it('creates, lists, and deletes dashboards', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/dashboards') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { id: 'dash_1', name: 'Ops', url: '/dash/1' } });
      }
      if (url.endsWith('/dashboards/dash_1') && init?.method === 'DELETE') {
        return jsonResponse({ success: true, data: {} });
      }
      if (url.endsWith('/dashboards')) {
        return jsonResponse({
          success: true,
          data: {
            dashboards: [{
              id: 'dash_1',
              name: 'Ops',
              description: null,
              widgetCount: 2,
              createdAt: '2024-01-01T00:00:00Z',
              createdBy: { id: 'usr_1', name: 'Ada', email: 'ada@example.com' },
              isAutoSave: true,
              thumbnail: null,
            }],
            count: 1,
          },
        });
      }
      return jsonResponse({ success: true, data: {} });
    }));

    const sdk = createSdk();

    const createPromise = sdk.dashboards.create({ name: 'Ops' });
    await vi.advanceTimersByTimeAsync(10);
    await expect(createPromise).resolves.toMatchObject({ id: 'dash_1' });

    const listPromise = sdk.dashboards.list();
    await vi.advanceTimersByTimeAsync(10);
    await expect(listPromise).resolves.toHaveLength(1);

    const deletePromise = sdk.dashboards.delete('dash_1');
    await vi.advanceTimersByTimeAsync(10);
    await expect(deletePromise).resolves.toBe(true);
  });
});

describe('SlidesStore', () => {
  it('creates, lists, and deletes presentations', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/slides') && init?.method === 'POST') {
        return jsonResponse({ success: true, data: { id: 'pres_1', name: 'Quarterly', slideCount: 0 } });
      }
      if (url.endsWith('/slides/pres_1') && init?.method === 'DELETE') {
        return jsonResponse({ success: true, data: {} });
      }
      return jsonResponse({
        success: true,
        data: {
          presentations: [{
            id: 'pres_1',
            name: 'Quarterly',
            slideCount: 3,
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
          }],
          count: 1,
        },
      });
    }));

    const sdk = createSdk();

    const createPromise = sdk.slides.create({ name: 'Quarterly' });
    await vi.advanceTimersByTimeAsync(10);
    await expect(createPromise).resolves.toMatchObject({ id: 'pres_1' });

    const listPromise = sdk.slides.list();
    await vi.advanceTimersByTimeAsync(10);
    await expect(listPromise).resolves.toHaveLength(1);

    const deletePromise = sdk.slides.delete('pres_1');
    await vi.advanceTimersByTimeAsync(10);
    await expect(deletePromise).resolves.toBe(true);
  });
});

describe('AgentStore conversations', () => {
  it('lists, loads, and deletes conversations', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes('/agent/conversations/conv_1') && init?.method === 'DELETE') {
        return jsonResponse({ success: true, data: { deleted: true } });
      }
      if (url.includes('/agent/conversations/conv_1')) {
        return jsonResponse({
          success: true,
          data: { conversation: { id: 'conv_1', title: 'Help' }, messages: [{ role: 'user', content: 'Hi' }] },
        });
      }
      return jsonResponse({
        success: true,
        data: { conversations: [{ id: 'conv_1', title: 'Help' }], total: 1 },
      });
    }));

    const sdk = createSdk();

    const listPromise = sdk.agent.conversations.list({ limit: 10 });
    await vi.advanceTimersByTimeAsync(10);
    await expect(listPromise).resolves.toMatchObject({ total: 1 });

    const getPromise = sdk.agent.conversations.get('conv_1');
    await vi.advanceTimersByTimeAsync(10);
    await expect(getPromise).resolves.toMatchObject({ conversation: { id: 'conv_1' } });

    const deletePromise = sdk.agent.conversations.delete('conv_1');
    await vi.advanceTimersByTimeAsync(10);
    await expect(deletePromise).resolves.toEqual({ deleted: true });
  });

  it('streams chat chunks decoded from an SSE response split across chunks', async () => {
    function sseResponse(chunks: string[]): Response {
      const enc = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          for (const c of chunks) controller.enqueue(enc.encode(c));
          controller.close();
        },
      });
      return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    }

    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      'data: {"type":"content","content":"Hel',
      'lo"}\n\ndata: {"type":"content","content":" world"}\n\n',
      'data: {"type":"done","conversationId":"conv_9"}\n\n',
    ])));

    const sdk = createSdk();
    const chunks = [];
    for await (const chunk of sdk.agent.chat({ message: 'hi' })) chunks.push(chunk);

    expect(chunks).toEqual([
      { type: 'content', content: 'Hello' },
      { type: 'content', content: ' world' },
      { type: 'done', conversationId: 'conv_9' },
    ]);
  });
});

describe('ShareOutError propagation', () => {
  it('rethrows unknown errors from connection queries', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      success: false,
      error: 'Server error',
      code: 'INTERNAL',
    }, 500)));

    const sdk = createSdk();
    const promise = sdk.connection('warehouse').query('SELECT 1');
    const caught = promise.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    await expect(caught).resolves.toBeInstanceOf(ShareOutError);
  });
});
