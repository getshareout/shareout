import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleDraft,
  handleHistory,
  handlePublish,
  handleUpload,
} from '../../../src/editor/draft';
import type { EditorContext } from '../../../src/editor/index';
import type { Env } from '../../../src/types';

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
    batch: vi.fn(async (stmts: unknown[]) =>
      Array.isArray(stmts) ? stmts.map(() => ({ success: true })) : [],
    ),
  } as unknown as Env['DB'];
}

function makeR2Mock(): Env['ARTIFACTS'] {
  return {
    put: vi.fn(async () => undefined),
  } as unknown as Env['ARTIFACTS'];
}

function makeSlugsMock(): Env['SLUGS'] {
  return {
    delete: vi.fn(async () => undefined),
  } as unknown as Env['SLUGS'];
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
      SLUGS: makeSlugsMock(),
    } as unknown as Env,
    ...overrides,
  };
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json() as Promise<Record<string, unknown>>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('handleDraft', () => {
  it('GET returns null when no draft exists', async () => {
    const ctx = baseCtx();
    const res = await handleDraft(new Request('http://x/draft'), ctx, 'GET');
    const body = await jsonBody(res);

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.draft).toBeNull();
  });

  it('GET returns draft with parsed assets', async () => {
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: () => ({
            id: 'draft_1',
            html_content: '<h1>Draft</h1>',
            assets_json: JSON.stringify([{ id: 'a1' }]),
            created_at: '2024-01-01',
            updated_at: '2024-01-02',
          }),
        }),
        ARTIFACTS: makeR2Mock(),
      } as unknown as Env,
    });

    const body = await jsonBody(await handleDraft(new Request('http://x/draft'), ctx, 'GET'));
    expect(body.draft).toMatchObject({
      id: 'draft_1',
      html: '<h1>Draft</h1>',
      createdAt: '2024-01-01',
    });
    expect((body.draft as { assets: unknown[] }).assets).toHaveLength(1);
  });

  it('GET returns 500 on database error', async () => {
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

    const res = await handleDraft(new Request('http://x/draft'), ctx, 'GET');
    expect(res.status).toBe(500);
    expect((await jsonBody(res)).code).toBe('INTERNAL_ERROR');
  });

  it('POST saves draft and updates session when cursor provided', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({ run }),
        ARTIFACTS: makeR2Mock(),
      } as unknown as Env,
    });

    const req = new Request('http://x/draft', {
      method: 'POST',
      body: JSON.stringify({ html: '<p>Hi</p>', cursorPosition: { x: 10, y: 20 } }),
    });
    const body = await jsonBody(await handleDraft(req, ctx, 'POST'));

    expect(body.success).toBe(true);
    expect(body.draftId).toMatch(/^draft_/);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('POST returns 409 on a stale baseUpdatedAt and does not clobber the other writer (F1)', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: (sql) => (String(sql).includes('SELECT updated_at') ? { updated_at: 'server-newer' } : null),
          run,
        }),
        ARTIFACTS: makeR2Mock(),
      } as unknown as Env,
    });

    const req = new Request('http://x/draft', {
      method: 'POST',
      body: JSON.stringify({ html: '<p>mine</p>', baseUpdatedAt: 'client-older' }),
    });
    const res = await handleDraft(req, ctx, 'POST');
    const body = await jsonBody(res);

    expect(res.status).toBe(409);
    expect(body.code).toBe('DRAFT_CONFLICT');
    expect(body.currentUpdatedAt).toBe('server-newer');
    expect(run).not.toHaveBeenCalled();
  });

  it('POST saves when baseUpdatedAt matches and returns the new draftUpdatedAt (F1)', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: (sql) => (String(sql).includes('SELECT updated_at') ? { updated_at: 'ts-1' } : null),
          run,
        }),
        ARTIFACTS: makeR2Mock(),
      } as unknown as Env,
    });

    const req = new Request('http://x/draft', {
      method: 'POST',
      body: JSON.stringify({ html: '<p>ok</p>', baseUpdatedAt: 'ts-1' }),
    });
    const body = await jsonBody(await handleDraft(req, ctx, 'POST'));

    expect(body.success).toBe(true);
    expect(body.draftUpdatedAt).toBe('ts-1');
    expect(run).toHaveBeenCalled();
  });

  it('POST rejects missing html', async () => {
    const ctx = baseCtx();
    const req = new Request('http://x/draft', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await handleDraft(req, ctx, 'POST');
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe('INVALID_REQUEST');
  });

  it('DELETE removes draft', async () => {
    const run = vi.fn(async () => ({ success: true }));
    const ctx = baseCtx({
      env: { DB: makeDbMock({ run }), ARTIFACTS: makeR2Mock() } as unknown as Env,
    });

    const body = await jsonBody(await handleDraft(new Request('http://x/draft'), ctx, 'DELETE'));
    expect(body.success).toBe(true);
    expect(run).toHaveBeenCalled();
  });

  it('returns 405 for unsupported methods', async () => {
    const res = await handleDraft(new Request('http://x/draft'), baseCtx(), 'PATCH');
    expect(res.status).toBe(405);
    expect((await jsonBody(res)).code).toBe('METHOD_NOT_ALLOWED');
  });
});

describe('editor URLs name this instance', () => {
  // Both were hardcoded to shareout.site. The publish URL sent the author to another
  // instance for a page that only exists on theirs; the upload URL is embedded into
  // the artifact HTML, so every image uploaded on a self-hosted instance pointed at a
  // host that does not have the file and silently broke.
  it('publish returns a URL on the serving instance', async () => {
    const ctx = baseCtx({
      env: {
        SHAREOUT_BASE_URL: 'https://acme.workers.dev',
        DB: makeDbMock({
          first: (sql) => {
            if (sql.includes('FROM artifacts')) return { id: 'art_1', name: 'Demo', slug: 'demo-slug' };
            if (sql.includes('MAX(version_no)')) return { max_version: 1 };
            return null;
          },
          run: vi.fn(async () => ({ success: true })),
        }),
        ARTIFACTS: makeR2Mock(),
        SLUGS: makeSlugsMock(),
      } as unknown as Env,
    });
    const req = new Request('http://x/publish', {
      method: 'POST',
      body: JSON.stringify({ html: '<html>x</html>' }),
    });
    const body = await jsonBody(await handlePublish(req, ctx));
    expect(body.url).toBe('https://acme.workers.dev/a/demo-slug/');
  });
});

describe('handlePublish', () => {
  it('publishes artifact, stores in R2, and clears draft', async () => {
    const r2 = makeR2Mock();
    const slugs = makeSlugsMock();
    const run = vi.fn(async () => ({ success: true }));

    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: (sql) => {
            if (sql.includes('FROM artifacts')) {
              return { id: 'art_1', name: 'Demo', slug: 'demo-slug' };
            }
            if (sql.includes('MAX(version_no)')) return { max_version: 2 };
            return null;
          },
          run,
        }),
        ARTIFACTS: r2,
        SLUGS: slugs,
      } as unknown as Env,
    });

    const req = new Request('http://x/publish', {
      method: 'POST',
      body: JSON.stringify({ html: '<html>Published</html>', commitMessage: 'Ship it' }),
    });
    const body = await jsonBody(await handlePublish(req, ctx));

    expect(body.success).toBe(true);
    expect(body.versionNo).toBe(3);
    expect(body.url).toContain('demo-slug');
    expect(r2.put).toHaveBeenCalled();
    expect(slugs.delete).toHaveBeenCalledWith('deploy:demo-slug');
  });

  it('returns 409 on a stale baseUpdatedAt and does not publish over the newer draft (F1)', async () => {
    const r2 = makeR2Mock();
    const run = vi.fn(async () => ({ success: true }));
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: (sql) => (String(sql).includes('SELECT updated_at') ? { updated_at: 'server-newer' } : null),
          run,
        }),
        ARTIFACTS: r2,
        SLUGS: makeSlugsMock(),
      } as unknown as Env,
    });

    const req = new Request('http://x/publish', {
      method: 'POST',
      body: JSON.stringify({ html: '<html>stale</html>', baseUpdatedAt: 'client-older' }),
    });
    const res = await handlePublish(req, ctx);
    const body = await jsonBody(res);

    expect(res.status).toBe(409);
    expect(body.code).toBe('DRAFT_CONFLICT');
    expect(body.currentUpdatedAt).toBe('server-newer');
    expect(r2.put).not.toHaveBeenCalled();
  });

  it('publishes when baseUpdatedAt matches the current draft (F1)', async () => {
    const r2 = makeR2Mock();
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          first: (sql) => {
            if (sql.includes('SELECT updated_at')) return { updated_at: 'ts-1' };
            if (sql.includes('FROM artifacts')) return { id: 'art_1', name: 'Demo', slug: 'demo-slug' };
            if (sql.includes('MAX(version_no)')) return { max_version: 0 };
            return null;
          },
        }),
        ARTIFACTS: r2,
        SLUGS: makeSlugsMock(),
      } as unknown as Env,
    });

    const req = new Request('http://x/publish', {
      method: 'POST',
      body: JSON.stringify({ html: '<html>ok</html>', baseUpdatedAt: 'ts-1' }),
    });
    const body = await jsonBody(await handlePublish(req, ctx));

    expect(body.success).toBe(true);
    expect(r2.put).toHaveBeenCalled();
  });

  it('BLOCK mode with a passing baseline stages a candidate, keeps the live cache, and defers the gate', async () => {
    const slugs = makeSlugsMock();
    const waitUntil = vi.fn();

    const ctx = baseCtx({
      waitUntil,
      env: {
        DB: makeDbMock({
          first: (sql) => {
            if (sql.includes('FROM artifacts')) {
              return { id: 'art_1', name: 'Demo', workspace_id: 'wsp_1', slug: 'demo-slug' };
            }
            if (sql.includes('FROM artifact_tests')) {
              return { artifact_id: 'art_1', enabled: 1, mode: 'block', spec: null, baseline_version_id: 'ver_good' };
            }
            if (sql.includes('MAX(version_no)')) return { max_version: 2 };
            return null;
          },
        }),
        ARTIFACTS: makeR2Mock(),
        SLUGS: slugs,
      } as unknown as Env,
    });

    const req = new Request('http://x/publish', {
      method: 'POST',
      body: JSON.stringify({ html: '<html>Candidate</html>' }),
    });
    const body = await jsonBody(await handlePublish(req, ctx));

    expect(body.success).toBe(true);
    expect(body.tests).toEqual({ mode: 'block', pending: true });
    // Production pointer is untouched when staging a candidate → its cache stays.
    expect(slugs.delete).not.toHaveBeenCalled();
    // Gate runs off the response, not inline.
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it('returns 404 when artifact missing', async () => {
    const ctx = baseCtx();
    const req = new Request('http://x/publish', {
      method: 'POST',
      body: JSON.stringify({ html: '<html></html>' }),
    });
    const res = await handlePublish(req, ctx);
    expect(res.status).toBe(404);
    expect((await jsonBody(res)).code).toBe('ARTIFACT_NOT_FOUND');
  });

  it('returns 400 when html missing', async () => {
    const ctx = baseCtx();
    const req = new Request('http://x/publish', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    const res = await handlePublish(req, ctx);
    expect(res.status).toBe(400);
  });
});

describe('handleHistory', () => {
  it('returns paginated version history', async () => {
    const ctx = baseCtx({
      env: {
        DB: makeDbMock({
          all: () => ({
            results: [{
              id: 'ver_1',
              version_no: 1,
              created_at: '2024-01-01',
              entrypoint: 'index.html',
            }],
          }),
          first: (sql) => {
            if (sql.includes('COUNT(*)')) return { count: 1 };
            return null;
          },
        }),
        ARTIFACTS: makeR2Mock(),
      } as unknown as Env,
    });

    const req = new Request('http://x/history?limit=5&offset=0');
    const body = await jsonBody(await handleHistory(req, ctx));

    expect(body.success).toBe(true);
    expect(body.total).toBe(1);
    expect(body.limit).toBe(5);
    expect((body.versions as unknown[]).length).toBe(1);
  });
});

describe('handleUpload', () => {
  it('uploads allowed image file to R2', async () => {
    const r2 = makeR2Mock();
    const ctx = baseCtx({ env: { DB: makeDbMock(), ARTIFACTS: r2 } as unknown as Env });

    const file = new File(['png-bytes'], 'photo.png', { type: 'image/png' });
    const form = new FormData();
    form.append('file', file);

    const body = await jsonBody(await handleUpload(new Request('http://x/upload', { method: 'POST', body: form }), ctx));

    expect(body.success).toBe(true);
    expect(body.mime).toBe('image/png');
    expect(body.url).toContain('art_1');
    expect(r2.put).toHaveBeenCalled();
  });

  it('rejects missing file', async () => {
    const res = await handleUpload(new Request('http://x/upload', { method: 'POST', body: new FormData() }), baseCtx());
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe('INVALID_REQUEST');
  });

  it('rejects disallowed mime type', async () => {
    const file = new File(['exe'], 'bad.exe', { type: 'application/x-msdownload' });
    const form = new FormData();
    form.append('file', file);

    const res = await handleUpload(new Request('http://x/upload', { method: 'POST', body: form }), baseCtx());
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe('INVALID_FILE_TYPE');
  });

  it('rejects files over 10MB', async () => {
    const big = new Uint8Array(10 * 1024 * 1024 + 1);
    const file = new File([big], 'big.png', { type: 'image/png' });
    const form = new FormData();
    form.append('file', file);

    const res = await handleUpload(new Request('http://x/upload', { method: 'POST', body: form }), baseCtx());
    expect(res.status).toBe(400);
    expect((await jsonBody(res)).code).toBe('FILE_TOO_LARGE');
  });
});
