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

function publishEnv(type: ArtifactType, overrides: Partial<Env> = {}, typeMetadata: unknown = null, entrypoint = 'notes.md'): Env {
  return {
    DB: makeDbMock({
      first: (sql, ...args) => {
        if (sql.includes('FROM artifacts WHERE id')) {
          return { id: 'art_1', name: 'Notes', slug: 'notes', artifact_type: type, type_metadata: typeMetadata ? JSON.stringify(typeMetadata) : null };
        }
        if (sql.includes('FROM assets WHERE version_id = ? AND path = ?')) return { r2_key: `k/${String(args[1])}`, mime: type === 'csv' ? 'text/csv' : 'text/markdown' };
        if (sql.includes('v.entrypoint, v.version_no')) return { version_id: 'ver_1', entrypoint, version_no: 1 };
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

  it('rejects invalid JSON for a json artifact without writing a version', async () => {
    const env = publishEnv('json');
    const res = await handleSourceEditor(
      new Request('http://x/source/publish', { method: 'POST', body: JSON.stringify({ content: '{not json' }) }),
      ctxFor(env),
      'publish',
    );
    expect(res.status).toBe(400);
    expect((await res.json() as Record<string, unknown>).code).toBe('VALIDATION_ERROR');
    expect(env.ARTIFACTS.put).not.toHaveBeenCalled();
  });
});

describe('handleSourceEditor publish keeps the rest of the version', () => {
  const SOURCE = { original: 'original/book.xlsx', sheets: [{ name: 'Sales', path: 'sheets/01-Sales.csv' }, { name: 'Team', path: 'sheets/02-Team.csv' }] };
  const publish = (env: Env, body: unknown) => handleSourceEditor(new Request('http://x/source/publish', { method: 'POST', body: JSON.stringify(body) }), ctxFor(env), 'publish');
  const batchSql = (env: Env) => (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0]));
  const batchBinds = (env: Env, needle: string) => {
    const i = (env.DB.prepare as ReturnType<typeof vi.fn>).mock.calls.findIndex((c) => String(c[0]).includes(needle));
    return (env.DB.prepare as ReturnType<typeof vi.fn>).mock.results[i].value.bind.mock.calls[0];
  };

  it('carries every other file (images, original, other sheets) into the new version', async () => {
    const env = publishEnv('markdown', {}, { source: { original: 'original/Plan.docx' } }, 'Plan.md');
    expect((await publish(env, { content: '# Edited' })).status).toBe(200);
    expect(batchSql(env).some((q) => q.includes('SELECT \'ast_\' || lower(hex(randomblob(12)))'))).toBe(true);
    expect(batchBinds(env, 'randomblob')).toEqual([expect.stringMatching(/^ver_/), 'ver_1', 'Plan.md']);
    // The imported original survives a re-generated metadata blob.
    const meta = JSON.parse(batchBinds(env, 'UPDATE artifacts SET type_metadata')[0]);
    expect(meta.source).toEqual({ original: 'original/Plan.docx' });
    expect(meta.markdown).toBeTruthy();
  });

  it('publishes an edited workbook sheet back to that sheet, leaving the entry metadata', async () => {
    const env = publishEnv('csv', {}, { source: SOURCE, csv: { rowCount: 1 } }, 'sheets/01-Sales.csv');
    expect((await publish(env, { content: 'Name\nBea', path: 'sheets/02-Team.csv' })).status).toBe(200);
    const [key, , opts] = (env.ARTIFACTS.put as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(key).toMatch(/\/sheets\/02-Team\.csv$/);
    expect(opts.httpMetadata.contentType).toBe('text/csv');
    expect(batchBinds(env, 'randomblob')[2]).toBe('sheets/02-Team.csv');
    expect(JSON.parse(batchBinds(env, 'UPDATE artifacts SET type_metadata')[0])).toEqual({ source: SOURCE, csv: { rowCount: 1 } });
  });

  it('refuses a path that is not one of the sheets', async () => {
    const env = publishEnv('csv', {}, { source: SOURCE }, 'sheets/01-Sales.csv');
    const res = await publish(env, { content: 'x', path: '../index.html' });
    expect(res.status).toBe(400);
    expect(env.ARTIFACTS.put).not.toHaveBeenCalled();
  });

  it('opens the sheet the viewer shows (?sheet=2) in the grid editor', async () => {
    const env = publishEnv('csv', {}, { source: SOURCE }, 'sheets/01-Sales.csv');
    (env.DB.prepare as ReturnType<typeof vi.fn>).mockClear();
    const page = await (await serveSourceEditorPage(env, { id: 'art_1', slug: 'notes', name: 'Book', artifact_type: 'csv' }, 'csv', 'https://shareout.site', '2')).text();
    expect(page).toContain('path: "sheets/02-Team.csv"');
  });
});
