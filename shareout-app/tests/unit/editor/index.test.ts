/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorContext } from '../../../src/editor/index';
import type { Env } from '../../../src/types';

const mockHandleDraft = vi.fn();
const mockHandlePublish = vi.fn();
const mockHandleHistory = vi.fn();
const mockHandleUpload = vi.fn();
const mockHandleEditorWebSocket = vi.fn();
const mockHandleEditorChat = vi.fn();
const mockHandleSDKEditor = vi.fn();
const mockDetectComponents = vi.fn();
const mockGenerateEditorPage = vi.fn();

vi.mock('../../../src/editor/draft', () => ({
  handleDraft: (...args: unknown[]) => mockHandleDraft(...args),
  handlePublish: (...args: unknown[]) => mockHandlePublish(...args),
  handleHistory: (...args: unknown[]) => mockHandleHistory(...args),
  handleUpload: (...args: unknown[]) => mockHandleUpload(...args),
}));

vi.mock('../../../src/editor/collab/index', () => ({
  handleEditorWebSocket: (...args: unknown[]) => mockHandleEditorWebSocket(...args),
}));

vi.mock('../../../src/editor/chat/index', () => ({
  handleEditorChat: (...args: unknown[]) => mockHandleEditorChat(...args),
}));

vi.mock('../../../src/editor/sdk-editors/index', () => ({
  handleSDKEditor: (...args: unknown[]) => mockHandleSDKEditor(...args),
}));

vi.mock('../../../src/editor/detector', () => ({
  detectComponents: (...args: unknown[]) => mockDetectComponents(...args),
}));

vi.mock('../../../src/editor/visual-editor', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/editor/visual-editor')>();
  return {
    ...actual,
    generateEditorPage: (...args: unknown[]) => mockGenerateEditorPage(...args),
  };
});

import { handleEditor, serveEditorPage } from '../../../src/editor/index';

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
  all?: (sql: string, ...bindArgs: unknown[]) => unknown;
  run?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, ...bindArgs) ?? { results: [] }),
        run: vi.fn(async () => handlers.run?.(sql, ...bindArgs) ?? { success: true }),
      })),
    })),
  } as unknown as Env['DB'];
}

function makeR2Mock(getHandler?: (key: string) => Promise<{ text: () => Promise<string> } | null>): Env['ARTIFACTS'] {
  return {
    get: vi.fn(async (key: string) => getHandler?.(key) ?? null),
  } as unknown as Env['ARTIFACTS'];
}

function baseCtx(overrides: Partial<EditorContext> = {}): EditorContext {
  return {
    artifactId: 'art_1',
    userId: 'usr_1',
    userName: 'Test User',
    userAvatar: 'https://example.com/avatar.png',
    role: 'owner',
    env: {
      DB: makeDbMock(),
      ARTIFACTS: makeR2Mock(),
    } as unknown as Env,
    ...overrides,
  };
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

function mockResponse(status = 200, body = 'ok'): Response {
  return new Response(body, { status });
}

beforeEach(() => {
  mockHandleDraft.mockResolvedValue(mockResponse(200, JSON.stringify({ route: 'draft' })));
  mockHandlePublish.mockResolvedValue(mockResponse(200, JSON.stringify({ route: 'publish' })));
  mockHandleHistory.mockResolvedValue(mockResponse(200, JSON.stringify({ route: 'history' })));
  mockHandleUpload.mockResolvedValue(mockResponse(200, JSON.stringify({ route: 'upload' })));
  mockHandleEditorWebSocket.mockResolvedValue(mockResponse(101));
  mockHandleEditorChat.mockResolvedValue(mockResponse(200, JSON.stringify({ route: 'chat' })));
  mockHandleSDKEditor.mockResolvedValue(mockResponse(200, JSON.stringify({ route: 'sdk' })));
  mockDetectComponents.mockReturnValue({ sdkComponents: [], charts: [], widgets: [] });
  mockGenerateEditorPage.mockReturnValue('<html>editor</html>');
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleEditor routing', () => {
  it('returns 403 for viewer role', async () => {
    const ctx = baseCtx({ role: 'viewer' });
    const res = await handleEditor(new Request('http://x/editor'), ctx, '');
    const body = await jsonBody(res);

    expect(res.status).toBe(403);
    expect(body.code).toBe('FORBIDDEN');
    expect(mockHandleDraft).not.toHaveBeenCalled();
  });

  it('delegates draft to handleDraft', async () => {
    const ctx = baseCtx();
    const req = new Request('http://x/editor/draft', { method: 'POST' });
    const res = await handleEditor(req, ctx, 'draft');

    expect(mockHandleDraft).toHaveBeenCalledWith(req, ctx, 'POST');
    expect(res.status).toBe(200);
  });

  it('delegates publish POST to handlePublish', async () => {
    const ctx = baseCtx();
    const req = new Request('http://x/editor/publish', { method: 'POST' });
    await handleEditor(req, ctx, 'publish');

    expect(mockHandlePublish).toHaveBeenCalledWith(req, ctx);
  });

  it('returns 405 for publish with wrong method', async () => {
    const res = await handleEditor(new Request('http://x/editor/publish', { method: 'GET' }), baseCtx(), 'publish');
    expect(res.status).toBe(405);
    expect((await jsonBody(res)).code).toBe('METHOD_NOT_ALLOWED');
  });

  it('delegates history GET to handleHistory', async () => {
    const ctx = baseCtx();
    const req = new Request('http://x/editor/history');
    await handleEditor(req, ctx, 'history');

    expect(mockHandleHistory).toHaveBeenCalledWith(req, ctx);
  });

  it('delegates upload POST to handleUpload', async () => {
    const ctx = baseCtx();
    const req = new Request('http://x/editor/upload', { method: 'POST' });
    await handleEditor(req, ctx, 'upload');

    expect(mockHandleUpload).toHaveBeenCalledWith(req, ctx);
  });

  it('delegates websocket upgrade to handleEditorWebSocket', async () => {
    const ctx = baseCtx();
    const req = new Request('http://x/editor/ws');
    vi.spyOn(req.headers, 'get').mockImplementation((name) =>
      name.toLowerCase() === 'upgrade' ? 'websocket' : null,
    );
    await handleEditor(req, ctx, 'ws');

    expect(mockHandleEditorWebSocket).toHaveBeenCalledWith(req, ctx);
  });

  it('returns 405 for ws without upgrade header', async () => {
    const res = await handleEditor(new Request('http://x/editor/ws'), baseCtx(), 'ws');
    expect(res.status).toBe(405);
  });

  it('delegates chat subpath to handleEditorChat', async () => {
    const ctx = baseCtx();
    const req = new Request('http://x/editor/chat/agent');
    await handleEditor(req, ctx, 'chat/agent');

    expect(mockHandleEditorChat).toHaveBeenCalledWith(req, ctx, 'agent');
  });

  it('delegates sdk routes to handleSDKEditor with component header', async () => {
    const ctx = baseCtx();
    const req = new Request('http://x/editor/sdk/table/save', {
      headers: { 'X-SDK-Component-Name': 'sales_data' },
    });
    await handleEditor(req, ctx, 'sdk/table/save');

    expect(mockHandleSDKEditor).toHaveBeenCalledWith(
      req,
      expect.objectContaining({
        artifactId: 'art_1',
        userId: 'usr_1',
        component: expect.objectContaining({
          type: 'table',
          name: 'sales_data',
        }),
      }),
      'table/save',
    );
  });

  it('returns 405 for load with wrong method', async () => {
    const res = await handleEditor(new Request('http://x/editor', { method: 'POST' }), baseCtx(), '');
    expect(res.status).toBe(405);
  });

  it('returns 405 for history with wrong method', async () => {
    const res = await handleEditor(new Request('http://x/editor/history', { method: 'POST' }), baseCtx(), 'history');
    expect(res.status).toBe(405);
  });

  it('returns 405 for upload with wrong method', async () => {
    const res = await handleEditor(new Request('http://x/editor/upload', { method: 'GET' }), baseCtx(), 'upload');
    expect(res.status).toBe(405);
  });

  it('returns 404 for unknown action', async () => {
    const res = await handleEditor(new Request('http://x/editor/unknown'), baseCtx(), 'unknown');
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe('NOT_FOUND');
  });

  it('returns 405 for detect with wrong method', async () => {
    const res = await handleEditor(new Request('http://x/editor/detect'), baseCtx(), 'detect');
    expect(res.status).toBe(405);
  });
});

describe('handleEditor load (GET /editor)', () => {
  it('returns 404 when artifact is missing', async () => {
    const ctx = baseCtx();
    const res = await handleEditor(new Request('http://x/editor'), ctx, '');
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe('ARTIFACT_NOT_FOUND');
  });

  it('loads published html, draft, collaborators, and assets', async () => {
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: (sql) => {
            if (sql.includes('FROM artifacts a')) {
              return {
                id: 'art_1',
                name: 'Demo',
                slug: 'demo',
                visibility: 'private',
                owner_id: 'usr_1',
                version_id: 'ver_1',
                entrypoint: 'index.html',
                version_no: 3,
              };
            }
            if (sql.includes('FROM assets') && sql.includes('path = ?')) {
              return { r2_key: 'r2/index.html' };
            }
            if (sql.includes('FROM artifact_drafts')) {
              return {
                id: 'draft_1',
                html_content: '<h1>Draft</h1>',
                updated_at: '2024-06-01T00:00:00Z',
              };
            }
            return null;
          },
          all: (sql) => {
            if (sql.includes('FROM editor_sessions')) {
              return {
                results: [{
                  user_id: 'usr_2',
                  user_name: 'Alice',
                  user_avatar: 'https://a.png',
                  user_color: '#3b82f6',
                  cursor_x: 10,
                  cursor_y: 20,
                  selected_element: '#title',
                  last_active: '2024-06-01T12:00:00Z',
                }],
              };
            }
            if (sql.includes('FROM assets') && sql.includes('WHERE version_id = ?')) {
              return {
                results: [{
                  id: 'asset_1',
                  path: 'style.css',
                  r2_key: 'r2/style.css',
                  mime: 'text/css',
                  size_bytes: 128,
                }],
              };
            }
            return { results: [] };
          },
        }),
        ARTIFACTS: makeR2Mock(async (key) => {
          if (key === 'r2/index.html') {
            return { text: async () => '<html>Published</html>' };
          }
          return null;
        }),
      } as unknown as Env,
    });

    const res = await handleEditor(new Request('http://x/editor'), ctx, '');
    const body = await jsonBody(res);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    const editor = body.editor as Record<string, unknown>;
    expect(editor.html).toBe('<h1>Draft</h1>');
    expect(editor.hasDraft).toBe(true);
    expect(editor.versionNo).toBe(3);
    expect(editor.assets).toEqual([{
      id: 'asset_1',
      path: 'style.css',
      url: '/a/demo/style.css',
      mime: 'text/css',
      size: 128,
    }]);
    expect(editor.collaborators).toEqual([expect.objectContaining({
      userId: 'usr_2',
      userName: 'Alice',
      cursor: { x: 10, y: 20 },
      selectedElement: '#title',
    })]);
  });

  it('falls back to published html when no draft exists', async () => {
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: (sql) => {
            if (sql.includes('FROM artifacts a')) {
              return {
                id: 'art_1',
                name: 'Demo',
                slug: 'demo',
                visibility: 'public',
                owner_id: 'usr_1',
                version_id: 'ver_1',
                entrypoint: 'index.html',
                version_no: 1,
              };
            }
            if (sql.includes('FROM assets') && sql.includes('path = ?')) {
              return { r2_key: 'r2/index.html' };
            }
            if (sql.includes('FROM artifact_drafts')) return null;
            return null;
          },
        }),
        ARTIFACTS: makeR2Mock(async () => ({
          text: async () => '<html>Published only</html>',
        })),
      } as unknown as Env,
    });

    const body = await jsonBody(await handleEditor(new Request('http://x/editor'), ctx, ''));
    expect((body.editor as { html: string }).html).toBe('<html>Published only</html>');
    expect((body.editor as { hasDraft: boolean }).hasDraft).toBe(false);
  });

  it('returns 500 when load throws', async () => {
    const ctx = baseCtx({
      env: {
        DB: {
          prepare: vi.fn(() => {
            throw new Error('db down');
          }),
        },
        ARTIFACTS: makeR2Mock(),
      } as unknown as Env,
    });

    const res = await handleEditor(new Request('http://x/editor'), ctx, '');
    expect(res.status).toBe(500);
    expect((await jsonBody(res)).code).toBe('INTERNAL_ERROR');
  });
});

describe('handleEditor rollback', () => {
  it('returns 400 when versionId is missing', async () => {
    const res = await handleEditor(
      new Request('http://x/editor/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      baseCtx(),
      'rollback',
    );
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe('INVALID_REQUEST');
  });

  it('returns 404 when version does not belong to artifact', async () => {
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: () => ({
            id: 'ver_other',
            artifact_id: 'art_other',
            entrypoint: 'index.html',
          }),
        }),
        ARTIFACTS: makeR2Mock(),
      } as unknown as Env,
    });

    const res = await handleEditor(
      new Request('http://x/editor/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: 'ver_other' }),
      }),
      ctx,
      'rollback',
    );
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe('VERSION_NOT_FOUND');
  });

  it('returns 404 when version asset row is missing', async () => {
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: (sql) => {
            if (sql.includes('FROM versions')) {
              return { id: 'ver_1', artifact_id: 'art_1', entrypoint: 'index.html' };
            }
            return null;
          },
        }),
        ARTIFACTS: makeR2Mock(),
      } as unknown as Env,
    });

    const res = await handleEditor(
      new Request('http://x/editor/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: 'ver_1' }),
      }),
      ctx,
      'rollback',
    );
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe('ASSET_NOT_FOUND');
  });

  it('returns 404 when R2 object is missing', async () => {
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: (sql) => {
            if (sql.includes('FROM versions')) {
              return { id: 'ver_1', artifact_id: 'art_1', entrypoint: 'index.html' };
            }
            if (sql.includes('FROM assets')) return { r2_key: 'r2/missing.html' };
            return null;
          },
        }),
        ARTIFACTS: makeR2Mock(async () => null),
      } as unknown as Env,
    });

    const res = await handleEditor(
      new Request('http://x/editor/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: 'ver_1' }),
      }),
      ctx,
      'rollback',
    );
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe('ASSET_NOT_FOUND');
  });

  it('saves rolled-back html as draft', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: (sql) => {
            if (sql.includes('FROM versions')) {
              return { id: 'ver_1', artifact_id: 'art_1', entrypoint: 'index.html' };
            }
            if (sql.includes('FROM assets')) return { r2_key: 'r2/old.html' };
            return null;
          },
          run,
        }),
        ARTIFACTS: makeR2Mock(async () => ({
          text: async () => '<html>Old version</html>',
        })),
      } as unknown as Env,
    });

    const res = await handleEditor(
      new Request('http://x/editor/rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: 'ver_1' }),
      }),
      ctx,
      'rollback',
    );
    const body = await jsonBody(res);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.html).toBe('<html>Old version</html>');
    expect(run).toHaveBeenCalled();
  });

  it('returns 500 when rollback throws', async () => {
    const ctx = baseCtx({
      env: {
        DB: makeDbMock(),
        ARTIFACTS: makeR2Mock(),
      } as unknown as Env,
    });

    const res = await handleEditor(
      new Request('http://x/editor/rollback', {
        method: 'POST',
        body: 'not-json',
      }),
      ctx,
      'rollback',
    );
    expect(res.status).toBe(500);
    expect((await jsonBody(res)).code).toBe('INTERNAL_ERROR');
  });

  it('returns 405 for rollback with wrong method', async () => {
    const res = await handleEditor(new Request('http://x/editor/rollback'), baseCtx(), 'rollback');
    expect(res.status).toBe(405);
  });
});

describe('handleEditor detect', () => {
  it('returns 400 when html is missing', async () => {
    const res = await handleEditor(
      new Request('http://x/editor/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
      baseCtx(),
      'detect',
    );
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe('INVALID_REQUEST');
  });

  it('returns detected components', async () => {
    mockDetectComponents.mockReturnValue({
      sdkComponents: [{ type: 'table', name: 'sales' }],
      charts: [],
      widgets: [],
    });

    const res = await handleEditor(
      new Request('http://x/editor/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: '<div>sdk.table("sales")</div>' }),
      }),
      baseCtx(),
      'detect',
    );
    const body = await jsonBody(res);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(mockDetectComponents).toHaveBeenCalledWith('<div>sdk.table("sales")</div>');
    expect(body.components).toEqual({
      sdkComponents: [{ type: 'table', name: 'sales' }],
      charts: [],
      widgets: [],
    });
  });

  it('returns 500 when detect throws', async () => {
    mockDetectComponents.mockImplementation(() => {
      throw new Error('detect failed');
    });

    const res = await handleEditor(
      new Request('http://x/editor/detect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ html: '<div></div>' }),
      }),
      baseCtx(),
      'detect',
    );
    expect(res.status).toBe(500);
    expect((await jsonBody(res)).code).toBe('INTERNAL_ERROR');
  });
});

describe('serveEditorPage', () => {
  it('returns generated html with no-cache headers', async () => {
    mockGenerateEditorPage.mockReturnValue('<html><body>Editor</body></html>');

    const res = await serveEditorPage(
      new Request('http://x/editor-page'),
      'art_1',
      'demo',
      {} as Env,
      'Demo Artifact',
      'A demo',
      { userId: 'usr_1', userName: 'Test User', userAvatar: 'https://a.png' },
    );

    expect(mockGenerateEditorPage).toHaveBeenCalledWith({
      artifactId: 'art_1',
      slug: 'demo',
      name: 'Demo Artifact',
      description: 'A demo',
      userId: 'usr_1',
      userName: 'Test User',
      userAvatar: 'https://a.png',
      openVisDisabled: false,
      baseUrl: expect.any(String),
      aiEnabled: false, // no AI keys on empty test env
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/html; charset=utf-8');
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await res.text()).toBe('<html><body>Editor</body></html>');
  });

  it('omits optional name and description when null', async () => {
    await serveEditorPage(new Request('http://x'), 'art_2', 'slug-2', {} as Env, null, null);

    expect(mockGenerateEditorPage).toHaveBeenCalledWith({
      artifactId: 'art_2',
      slug: 'slug-2',
      name: undefined,
      description: undefined,
      userId: undefined,
      userName: undefined,
      userAvatar: undefined,
      openVisDisabled: false,
      baseUrl: expect.any(String),
      aiEnabled: false,
    });
  });
});
