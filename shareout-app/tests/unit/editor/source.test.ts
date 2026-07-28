import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  handleSourceEditor,
  isSourceEditable,
  serveSourceEditorPage,
  SOURCE_EDITABLE_TYPES,
} from '../../../src/editor/source/index';
import { generateSourceEditorPage } from '../../../src/editor/source/page';
import type { EditorContext } from '../../../src/editor/index';
import type { ArtifactType, Env } from '../../../src/types';

function makeDbMock(handlers: {
  first?: (sql: string, ...bindArgs: unknown[]) => unknown;
} = {}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...bindArgs: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, ...bindArgs) ?? null),
        all: vi.fn(async () => ({ results: [] })),
        run: vi.fn(async () => ({ success: true })),
      })),
    })),
    batch: vi.fn(async (stmts: unknown[]) =>
      Array.isArray(stmts) ? stmts.map(() => ({ success: true })) : [],
    ),
  } as unknown as Env['DB'];
}

function makeR2Mock(content = ''): Env['ARTIFACTS'] {
  return {
    get: vi.fn(async () => (content ? { text: async () => content } : null)),
    put: vi.fn(async () => undefined),
  } as unknown as Env['ARTIFACTS'];
}

function makeSlugsMock(): Env['SLUGS'] {
  return { delete: vi.fn(async () => undefined) } as unknown as Env['SLUGS'];
}

function publishEnv(type: ArtifactType, overrides: Partial<Env> = {}): Env {
  return {
    DB: makeDbMock({
      first: (sql) => {
        if (sql.includes('FROM artifacts WHERE id')) {
          return { id: 'art_1', name: 'Notes', slug: 'notes', artifact_type: type };
        }
        if (sql.includes('JOIN assets a')) return { r2_key: 'k', mime: 'text/markdown' };
        if (sql.includes('SELECT v.entrypoint')) return { entrypoint: 'notes.md', version_no: 1 };
        if (sql.includes('MAX(version_no)')) return { max_version: 1 };
        return null;
      },
    }),
    ARTIFACTS: makeR2Mock('# old'),
    SLUGS: makeSlugsMock(),
    SHAREOUT_BASE_URL: 'https://shareout.site',
    ...overrides,
  } as unknown as Env;
}

function ctxFor(env: Env): EditorContext {
  return { artifactId: 'art_1', userId: 'usr_1', userName: 'T', role: 'owner', env };
}

afterEach(() => vi.restoreAllMocks());

describe('isSourceEditable', () => {
  it('covers the non-HTML editable types', () => {
    expect([...SOURCE_EDITABLE_TYPES].sort()).toEqual(['csv', 'json', 'markdown', 'txt']);
    expect(isSourceEditable('markdown')).toBe(true);
    expect(isSourceEditable('txt')).toBe(true);
    expect(isSourceEditable('csv')).toBe(true);
    expect(isSourceEditable('json')).toBe(true);
    expect(isSourceEditable('html')).toBe(false);
    expect(isSourceEditable('pdf')).toBe(false);
    expect(isSourceEditable('image')).toBe(false);
  });
});

describe('generateSourceEditorPage', () => {
  const base = {
    artifactId: 'art_1', slug: 'notes', name: 'Notes',
    entrypoint: 'notes.md', baseUrl: 'https://shareout.site', versionNo: 3,
  };

  it('inlines content safely without breaking out of the script', () => {
    const html = generateSourceEditorPage({
      ...base, type: 'txt' as const,
      content: '</script><img src=x onerror=alert(1)>',
    });
    expect(html).not.toContain('</script><img src=x');
    expect(html).toContain('\\u003c/script>');
    expect(html).toContain('Publish');
  });

  it('renders a live-preview surface for markdown', () => {
    const html = generateSourceEditorPage({ ...base, type: 'markdown' as const, content: '# Hi' });
    expect(html).toContain('id="preview"');
    expect(html).toContain('md-split');
  });

  it('renders a spreadsheet grid for csv', () => {
    const html = generateSourceEditorPage({ ...base, type: 'csv' as const, content: 'a,b\n1,2' });
    expect(html).toContain('id="grid"');
    expect(html).toContain('addRow()');
    expect(html).toContain('addCol()');
  });

  it('renders a format/validate affordance for json', () => {
    const html = generateSourceEditorPage({ ...base, type: 'json' as const, content: '{}' });
    expect(html).toContain('formatJson()');
    expect(html).toContain('id="jsonError"');
  });
});

describe('serveSourceEditorPage', () => {
  it('loads current content from R2 and returns an HTML page', async () => {
    const env = publishEnv('markdown');
    const res = await serveSourceEditorPage(
      env,
      { id: 'art_1', slug: 'notes', name: 'Notes', artifact_type: 'markdown' },
      'markdown',
      'https://shareout.site',
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/html');
    const body = await res.text();
    expect(body).toContain('Notes');
  });
});

describe('handleSourceEditor publish', () => {
  it('publishes preserving entrypoint + mime and regenerating metadata', async () => {
    const env = publishEnv('markdown');
    const res = await handleSourceEditor(
      new Request('http://x/source/publish', {
        method: 'POST',
        body: JSON.stringify({ content: '# New title\n\nBody' }),
      }),
      ctxFor(env),
      'publish',
    );
    const body = await res.json() as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.versionNo).toBe(2);
    expect(body.url).toContain('/a/notes/');

    // R2 write uses the original entrypoint + mime, not index.html / text/html.
    const put = (env.ARTIFACTS.put as ReturnType<typeof vi.fn>);
    expect(put).toHaveBeenCalled();
    const [key, , opts] = put.mock.calls[0];
    expect(key).toContain('/notes.md');
    expect(opts.httpMetadata.contentType).toBe('text/markdown');

    // Cache invalidated.
    expect((env.SLUGS.delete as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('rejects content that is not a string', async () => {
    const env = publishEnv('markdown');
    const res = await handleSourceEditor(
      new Request('http://x/source/publish', { method: 'POST', body: JSON.stringify({}) }),
      ctxFor(env),
      'publish',
    );
    expect(res.status).toBe(400);
  });

  it('404s on an unknown sub-action', async () => {
    const env = publishEnv('markdown');
    const res = await handleSourceEditor(
      new Request('http://x/source/bogus', { method: 'POST', body: '{}' }),
      ctxFor(env),
      'bogus',
    );
    expect(res.status).toBe(404);
  });

  it('refuses to publish a non-source-editable artifact', async () => {
    const env = publishEnv('html');
    const res = await handleSourceEditor(
      new Request('http://x/source/publish', {
        method: 'POST',
        body: JSON.stringify({ content: '<h1>x</h1>' }),
      }),
      ctxFor(env),
      'publish',
    );
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, unknown>).code).toBe('UNSUPPORTED');
  });
});
