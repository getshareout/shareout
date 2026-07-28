// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildAdminContext,
  buildAdminSystemPrompt,
  buildVisitorContext,
  buildVisitorSystemPrompt,
} from '../../../../src/data/agent/context';
import type { AdminContext, AgentConfig, VisitorContext } from '../../../../src/data/agent/types';
import type { DataContext } from '../../../../src/data/middleware';
import type { MiniDb } from '../../../../src/data/minidb-client';
import type { Env } from '../../../../src/types';
import { ARTIFACT_ID, defaultAgentConfig, makeDbMock, makeEnv, makeR2Mock, type DbHandler } from './helpers';

afterEach(() => {
  vi.restoreAllMocks();
});

function makeMiniDb(handlers: DbHandler = {}): MiniDb {
  return makeDbMock(handlers) as unknown as MiniDb;
}

function makeContextCtx(env: Env, db: DbHandler = {}): DataContext {
  return {
    artifactId: ARTIFACT_ID,
    workspaceId: '',
    artifact: {
      id: ARTIFACT_ID,
      name: 'Test Artifact',
      visibility: 'public',
      auth_method: null,
      workspace_id: null,
    },
    db: makeMiniDb(db),
    env,
    origin: null,
  };
}

describe('buildVisitorContext', () => {
  it('returns empty context when all features disabled', async () => {
    const config: AgentConfig = {
      ...defaultAgentConfig,
      visitor_context_json: false,
      visitor_context_tables: null,
      visitor_context_blobs: false,
    };
    const ctx = await buildVisitorContext(makeContextCtx(makeEnv()), config);

    expect(ctx).toEqual({ json: {}, tables: {}, blobUrls: [] });
  });

  it('loads JSON store with parsed and raw values', async () => {
    const dataCtx = makeContextCtx(makeEnv(), {
      all: (sql) => {
        if (sql.includes('artifact_json')) {
          return {
            results: [
              { key: 'settings', value: '{"theme":"dark"}' },
              { key: 'note', value: 'plain text' },
            ],
          };
        }
        return { results: [] };
      },
    });

    const ctx = await buildVisitorContext(dataCtx, {
      ...defaultAgentConfig,
      visitor_context_tables: null,
      visitor_context_blobs: false,
    });

    expect(ctx.json).toEqual({ settings: { theme: 'dark' }, note: 'plain text' });
  });

  it('loads table samples from string config', async () => {
    const dataCtx = makeContextCtx(makeEnv(), {
      first: (sql, args) => {
        if (sql.includes('artifact_tables') && args.includes('items')) {
          return { id: 'tbl_1' };
        }
        return null;
      },
      all: (sql) => {
        if (sql.includes('artifact_rows')) {
          return { results: [{ data: '{"id":1}' }, { data: 'raw-row' }] };
        }
        return { results: [] };
      },
    });

    const ctx = await buildVisitorContext(dataCtx, {
      ...defaultAgentConfig,
      visitor_context_json: false,
      visitor_context_tables: JSON.stringify(['items']) as unknown as string[],
      visitor_context_blobs: false,
    });

    expect(ctx.tables.items).toEqual([{ id: 1 }, 'raw-row']);
  });

  it('returns empty array for missing table', async () => {
    const dataCtx = makeContextCtx(makeEnv(), { first: () => null });

    const ctx = await buildVisitorContext(dataCtx, {
      ...defaultAgentConfig,
      visitor_context_json: false,
      visitor_context_blobs: false,
    });

    expect(ctx.tables.items).toEqual([]);
  });

  it('loads blob URLs when enabled', async () => {
    const env = makeEnv({
      all: (sql) => {
        if (sql.includes('FROM blobs')) {
          return { results: [{ id: 'blob_1', filename: 'a.png' }] };
        }
        return { results: [] };
      },
    });

    const ctx = await buildVisitorContext(makeContextCtx(env), {
      ...defaultAgentConfig,
      visitor_context_json: false,
      visitor_context_tables: null,
    });

    expect(ctx.blobUrls).toEqual([`/v1/data/${ARTIFACT_ID}/blobs/blob_1`]);
  });
});

describe('buildAdminContext', () => {
  it('throws when artifact is not found', async () => {
    const env = makeEnv({ first: () => null });

    await expect(buildAdminContext(makeContextCtx(env))).rejects.toThrow('Artifact not found');
  });

  it('builds full admin context with text files and metadata', async () => {
    const env = makeEnv({
      first: (sql) => {
        if (sql.includes('JOIN versions')) {
          return { id: ARTIFACT_ID, name: 'My App', visibility: 'public', version_no: 2 };
        }
        if (sql.includes('FROM versions')) {
          return { id: 'ver_2' };
        }
        return null;
      },
      all: (sql) => {
        if (sql.includes('FROM assets')) {
          return {
            results: [
              { path: 'index.html', r2_key: 'r2/index.html', mime: 'text/html' },
              { path: 'photo.png', r2_key: 'r2/photo.png', mime: 'image/png' },
            ],
          };
        }
        return { results: [] };
      },
    }, { ARTIFACTS: makeR2Mock({ getText: { 'r2/index.html': '<html></html>' } }) });

    const ctx = await buildAdminContext(makeContextCtx(env, {
      all: (sql) => {
        if (sql.includes('artifact_json')) {
          return { results: [{ key: 'config', value: '{"x":1}' }] };
        }
        if (sql.includes('artifact_tables')) {
          return { results: [{ name: 'users' }] };
        }
        return { results: [] };
      },
    }));

    expect(ctx.artifact).toEqual({
      id: ARTIFACT_ID,
      name: 'My App',
      visibility: 'public',
      currentVersion: 2,
    });
    expect(ctx.files).toEqual([{ path: 'index.html', content: '<html></html>', mime: 'text/html' }]);
    expect(ctx.json).toEqual({ config: { x: 1 } });
    expect(ctx.tables).toEqual(['users']);
    expect(ctx.skillDocs).toContain('ShareOut SDK Reference');
  });

  it('handles missing latest version gracefully', async () => {
    const env = makeEnv({
      first: (sql) => {
        if (sql.includes('JOIN versions')) {
          return { id: ARTIFACT_ID, name: 'App', visibility: 'private', version_no: 1 };
        }
        if (sql.includes('FROM versions')) return null;
        return null;
      },
      all: () => ({ results: [] }),
    });

    const ctx = await buildAdminContext(makeContextCtx(env));

    expect(ctx.files).toEqual([]);
  });

  it('includes json+xml mime variants as text', async () => {
    const env = makeEnv({
      first: (sql) => {
        if (sql.includes('JOIN versions')) {
          return { id: ARTIFACT_ID, name: 'App', visibility: 'public', version_no: 1 };
        }
        return { id: 'ver_1' };
      },
      all: (sql) => {
        if (sql.includes('FROM assets')) {
          return {
            results: [
              { path: 'data.json', r2_key: 'r2/data.json', mime: 'application/vnd.api+json' },
              { path: 'feed.xml', r2_key: 'r2/feed.xml', mime: 'application/atom+xml' },
            ],
          };
        }
        return { results: [] };
      },
    }, {
      ARTIFACTS: makeR2Mock({
        getText: { 'r2/data.json': '{}', 'r2/feed.xml': '<feed/>' },
      }),
    });

    const ctx = await buildAdminContext(makeContextCtx(env));

    expect(ctx.files.map((f) => f.path)).toEqual(['data.json', 'feed.xml']);
  });
});

describe('buildVisitorSystemPrompt', () => {
  it('uses default prompt when custom is null', () => {
    const prompt = buildVisitorSystemPrompt(null, { json: {}, tables: {}, blobUrls: [] });
    expect(prompt).toContain('helpful assistant');
  });

  it('appends json, tables, and blob sections', () => {
    const context: VisitorContext = {
      json: { count: 3 },
      tables: { items: [{ id: 1 }] },
      blobUrls: ['/v1/data/art/blobs/b1'],
    };

    const prompt = buildVisitorSystemPrompt('Custom', context);

    expect(prompt).toContain('Custom');
    expect(prompt).toContain('"count": 3');
    expect(prompt).toContain('### items (1 sample rows)');
    expect(prompt).toContain('/v1/data/art/blobs/b1');
  });
});

describe('buildAdminSystemPrompt', () => {
  it('includes files, skill docs, json, and tables', () => {
    const context: AdminContext = {
      files: [{ path: 'style.css', content: 'body{}', mime: 'text/css' }],
      skillDocs: '## SDK',
      artifact: { id: 'a1', name: 'Demo', visibility: 'public', currentVersion: 1 },
      json: { flag: true },
      tables: ['orders', 'users'],
    };

    const prompt = buildAdminSystemPrompt(context);

    expect(prompt).toContain('Demo');
    expect(prompt).toContain('style.css');
    expect(prompt).toContain('body{}');
    expect(prompt).toContain('## SDK');
    expect(prompt).toContain('"flag": true');
    expect(prompt).toContain('orders, users');
  });

  it('maps known mime types to language tags', () => {
    const context: AdminContext = {
      files: [
        { path: 'app.js', content: 'console.log(1)', mime: 'application/javascript' },
        { path: 'readme.md', content: '# Hi', mime: 'text/markdown' },
      ],
      skillDocs: '',
      artifact: { id: 'a1', name: 'X', visibility: 'public', currentVersion: 1 },
      json: {},
      tables: [],
    };

    const prompt = buildAdminSystemPrompt(context);

    expect(prompt).toContain('```javascript');
    expect(prompt).toContain('```markdown');
  });
});
