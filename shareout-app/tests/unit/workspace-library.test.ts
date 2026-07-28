import { describe, expect, it, vi } from 'vitest';
import { generateTypeMetadata, detectArtifactType, validatePublishRequest } from '../../src/validation';
import { parseLibPath, handleServeLibModule, accountHasTeamsPlan, libModulePath, handleResolveLibrary, loadLibraryViewerMetrics, buildLibraryApiDoc } from '../../src/workspace-library';
import { renderLibraryViewer } from '../../src/viewers/library-viewer';
import { handleCreateLibraryModule } from '../../src/publish';
import type { AuthUser } from '../../src/api-auth';
import type { Env, FileEntry, PublishRequest } from '../../src/types';

describe('parseLibPath', () => {
  it('parses a workspace module path', () => {
    expect(parseLibPath('/lib/acme/charts@1.0.0.js')).toEqual({
      scope: 'workspace', namespace: 'acme', moduleName: 'charts', semver: '1.0.0',
    });
  });

  it('parses a personal module path', () => {
    expect(parseLibPath('/lib/@u/leonel/charts@2.3.1.js')).toEqual({
      scope: 'personal', namespace: 'leonel', moduleName: 'charts', semver: '2.3.1',
    });
  });

  it('handles a prerelease semver', () => {
    expect(parseLibPath('/lib/acme/ui@1.0.0-beta.1.js')?.semver).toBe('1.0.0-beta.1');
  });

  it('returns null for non-/lib, missing version, or wrong arity', () => {
    expect(parseLibPath('/sdk/shareout.js')).toBeNull();
    expect(parseLibPath('/lib/acme/charts.js')).toBeNull();
    expect(parseLibPath('/lib/@u/leonel/a/b@1.0.0.js')).toBeNull();
    expect(parseLibPath('/lib/acme')).toBeNull();
  });
});

describe('detectArtifactType(library)', () => {
  const readme: FileEntry = { path: 'README.md', content: '# charts', mime: 'text/markdown' };
  it('returns library only when explicitly requested', () => {
    expect(detectArtifactType([readme], 'README.md')).toBe('markdown');
    expect(detectArtifactType([readme], 'README.md', 'library')).toBe('library');
  });
});

describe('generateTypeMetadata(library)', () => {
  it('derives the markdown base from the README', () => {
    const meta = generateTypeMetadata('library', '# charts\n\n```js\nx\n```\n', 'text/markdown').library!;
    expect(meta.hasCodeBlocks).toBe(true);
    expect(meta.toc.some(t => t.text === 'charts')).toBe(true);
  });
});

describe('validatePublishRequest(library)', () => {
  const base = (over: Partial<PublishRequest>): PublishRequest => ({
    name: 'charts',
    entrypoint: 'README.md',
    files: [
      { path: 'README.md', content: '# charts', mime: 'text/markdown' },
      { path: 'index.js', content: 'export const bar = () => {}', mime: 'text/javascript' },
    ],
    artifact_type: 'library',
    ...over,
  });

  it('accepts a valid library publish', () => {
    expect(validatePublishRequest(base({ library: { version: '1.0.0' } }))).toBeNull();
  });

  it('rejects a missing or non-semver version', () => {
    expect(validatePublishRequest(base({ library: { version: '' } }))?.code).toBe('VALIDATION_ERROR');
    expect(validatePublishRequest(base({ library: { version: 'v1' } }))?.code).toBe('VALIDATION_ERROR');
  });

  it('rejects when the main JS file is absent', () => {
    const req = base({ library: { version: '1.0.0', main: 'missing.js' } });
    expect(validatePublishRequest(req)?.code).toBe('VALIDATION_ERROR');
  });
});

// Minimal D1 mock returning canned first() rows by SQL fragment.
function makeDb(rows: (sql: string, args: unknown[]) => unknown): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => rows(sql, args) ?? null),
        run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
      })),
    })),
  } as unknown as Env['DB'];
}

describe('handleServeLibModule', () => {
  const req = new Request('https://x.shareoutcdn.site/lib/acme/charts@1.0.0.js');

  function env(opts: { mod?: unknown; ver?: unknown; bytes?: string | null }): Env {
    return {
      DB: makeDb((sql) => {
        if (sql.includes('FROM workspace_library')) return opts.mod;
        if (sql.includes('FROM library_versions')) return opts.ver;
        return null;
      }),
      ARTIFACTS: {
        get: vi.fn(async () => (opts.bytes == null ? null : { body: opts.bytes })),
      },
    } as unknown as Env;
  }

  it('serves pinned bytes with an immutable, public JS response', async () => {
    const res = await handleServeLibModule(req, env({
      mod: { artifact_id: 'art_1', blocked: 0 },
      ver: { version_no: 3, main_path: 'index.js' },
      bytes: 'export const bar = 1;',
    }), '/lib/acme/charts@1.0.0.js');
    expect(res!.status).toBe(200);
    expect(res!.headers.get('Content-Type')).toContain('application/javascript');
    expect(res!.headers.get('Cache-Control')).toContain('immutable');
  });

  it('404s a blocked module', async () => {
    const res = await handleServeLibModule(req, env({ mod: { artifact_id: 'art_1', blocked: 1 } }), '/lib/acme/charts@1.0.0.js');
    expect(res!.status).toBe(404);
  });

  it('404s an unknown version', async () => {
    const res = await handleServeLibModule(req, env({ mod: { artifact_id: 'art_1', blocked: 0 }, ver: null }), '/lib/acme/charts@1.0.0.js');
    expect(res!.status).toBe(404);
  });

  it('returns null for a non-/lib path so the dispatcher falls through', async () => {
    const res = await handleServeLibModule(req, env({}), '/sdk/shareout.js');
    expect(res).toBeNull();
  });
});

describe('libModulePath', () => {
  it('builds workspace and personal paths', () => {
    expect(libModulePath('workspace', 'acme', 'charts', '1.0.0')).toBe('/lib/acme/charts@1.0.0.js');
    expect(libModulePath('personal', 'leonel', 'charts', '1.0.0')).toBe('/lib/@u/leonel/charts@1.0.0.js');
  });
});

describe('handleResolveLibrary', () => {
  function env(opts: { art?: unknown; wsMod?: unknown; personalMod?: unknown; pin?: unknown }): Env {
    return {
      DB: makeDb((sql) => {
        if (sql.includes('FROM artifacts WHERE id')) return opts.art;
        if (sql.includes('FROM workspace_library') && sql.includes("scope = 'workspace'")) return opts.wsMod;
        if (sql.includes('FROM workspace_library') && sql.includes("scope = 'personal'")) return opts.personalMod;
        if (sql.includes('FROM artifact_libraries')) return opts.pin;
        return null;
      }),
    } as unknown as Env;
  }

  const wsMod = { artifact_id: 'art_mod', scope: 'workspace', namespace: 'acme', module_name: 'charts', latest_version: '1.2.0', blocked: 0 };

  it('resolves a workspace module at its latest version', async () => {
    const res = await handleResolveLibrary(env({ art: { workspace_id: 'wsp_1', owner_id: 'usr_1' }, wsMod }), 'art_consumer', 'charts');
    const body = await res.json() as { url: string; version: string; pinned: boolean };
    expect(res.status).toBe(200);
    expect(body.url).toBe('/lib/acme/charts@1.2.0.js');
    expect(body.version).toBe('1.2.0');
    expect(body.pinned).toBe(false);
  });

  it('honors a pin over latest', async () => {
    const res = await handleResolveLibrary(env({ art: { workspace_id: 'wsp_1', owner_id: 'usr_1' }, wsMod, pin: { semver: '1.0.0' } }), 'art_consumer', 'charts');
    const body = await res.json() as { url: string; pinned: boolean };
    expect(body.url).toBe('/lib/acme/charts@1.0.0.js');
    expect(body.pinned).toBe(true);
  });

  it('falls back to the owner personal library when no workspace match', async () => {
    const personalMod = { artifact_id: 'art_p', scope: 'personal', namespace: 'leonel', module_name: 'charts', latest_version: '0.1.0', blocked: 0 };
    const res = await handleResolveLibrary(env({ art: { workspace_id: null, owner_id: 'usr_1' }, personalMod }), 'art_consumer', 'charts');
    const body = await res.json() as { url: string };
    expect(body.url).toBe('/lib/@u/leonel/charts@0.1.0.js');
  });

  it('404s an unknown artifact or module', async () => {
    expect((await handleResolveLibrary(env({ art: null }), 'art_x', 'charts')).status).toBe(404);
    expect((await handleResolveLibrary(env({ art: { workspace_id: 'wsp_1', owner_id: 'usr_1' } }), 'art_x', 'nope')).status).toBe(404);
  });
});

// Mock supporting both first() and all().
function makeDbFull(handlers: {
  first?: (sql: string, args: unknown[]) => unknown;
  all?: (sql: string, args: unknown[]) => unknown[];
}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, args) ?? null),
        all: vi.fn(async () => ({ results: handlers.all?.(sql, args) ?? [] })),
        run: vi.fn(async () => ({ success: true, meta: { changes: 1 } })),
      })),
    })),
  } as unknown as Env['DB'];
}

describe('loadLibraryViewerMetrics', () => {
  it('returns module metrics with versions + import path', async () => {
    const env = { DB: makeDbFull({
      first: (sql) => sql.includes('FROM workspace_library')
        ? { scope: 'workspace', namespace: 'acme', module_name: 'charts', latest_version: '1.2.0' } : null,
      all: (sql) => sql.includes('FROM library_versions') ? [{ semver: '1.2.0' }, { semver: '1.0.0' }] : [],
    }) } as unknown as Env;
    const m = await loadLibraryViewerMetrics(env, 'art_1');
    expect(m?.importPath).toBe('/lib/acme/charts@1.2.0.js');
    expect(m?.versions).toEqual(['1.2.0', '1.0.0']);
  });

  it('returns null for a non-library artifact', async () => {
    const env = { DB: makeDbFull({ first: () => null }) } as unknown as Env;
    expect(await loadLibraryViewerMetrics(env, 'art_x')).toBeNull();
  });
});

describe('buildLibraryApiDoc', () => {
  it('emits an API catalog block with import path + exports', async () => {
    const env = { DB: makeDbFull({
      first: (sql) => sql.includes('owner_id FROM artifacts') ? { owner_id: 'usr_1' } : null,
      all: (sql) => sql.includes('FROM workspace_library') ? [{
        artifact_id: 'art_mod', scope: 'workspace', namespace: 'acme', module_name: 'charts',
        latest_version: '1.2.0', install_count: 0,
        type_metadata: JSON.stringify({ library: { exports: ['bar', 'foo'] } }),
        name: 'charts', slug: 'charts', display_slug: 'charts',
      }] : [],
    }) } as unknown as Env;
    const doc = await buildLibraryApiDoc(env, 'art_consumer', 'wsp_1');
    expect(doc).toContain('<library_module name="charts" version="1.2.0">');
    expect(doc).toContain('/lib/acme/charts@1.2.0.js');
    expect(doc).toContain('bar, foo');
    expect(doc).toContain('so.lib("charts")');
  });

  it('returns empty when no modules are available', async () => {
    const env = { DB: makeDbFull({ first: () => ({ owner_id: 'usr_1' }), all: () => [] }) } as unknown as Env;
    expect(await buildLibraryApiDoc(env, 'art_consumer', 'wsp_1')).toBe('');
  });
});

describe('handleCreateLibraryModule (session publish gate)', () => {
  const user: AuthUser = { id: 'usr_1', email: 'm@example.com', username: null };
  const req = (b: Record<string, unknown>) => new Request('http://x/v1/me/libraries', { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'application/json' } });
  const base = { name: 'charts', version: '1.0.0', js: 'export const bar=1', scope: 'personal' };

  it('400 on missing name / bad semver / empty js', async () => {
    const env = { DB: makeDbFull({ first: () => ({ tier: 'team' }) }) } as unknown as Env;
    expect((await handleCreateLibraryModule(env, user, req({ ...base, name: '' }))).status).toBe(400);
    expect((await handleCreateLibraryModule(env, user, req({ ...base, version: 'v1' }))).status).toBe(400);
    expect((await handleCreateLibraryModule(env, user, req({ ...base, js: '' }))).status).toBe(400);
  });

  it('409 when the semver was already published', async () => {
    const env = { DB: makeDbFull({ first: (sql) => {
      if (sql.includes('FROM users')) return { tier: 'team' };
      if (sql.includes('FROM artifacts WHERE display_slug')) return { id: 'art_prior' };
      if (sql.includes('FROM library_versions')) return { x: 1 };
      return null;
    } }) } as unknown as Env;
    expect((await handleCreateLibraryModule(env, user, req(base))).status).toBe(409);
  });
});

describe('renderLibraryViewer', () => {
  it('renders import snippets, version chip, and exports', () => {
    const html = renderLibraryViewer({
      slug: 'charts', artifactName: 'charts', artifactType: 'library',
      typeMetadata: { library: { toc: [], hasCodeBlocks: false, exports: ['bar'] } },
      baseUrl: 'https://shareout.site', content: '# charts\n\nReadme.', isAdmin: false,
      artifactId: 'art_1', loggedIn: false, isFavorite: false,
      libraryMetrics: { scope: 'workspace', namespace: 'acme', moduleName: 'charts', version: '1.2.0', versions: ['1.2.0'], importPath: '/lib/acme/charts@1.2.0.js' },
    });
    expect(html).toContain('https://shareout.site/lib/acme/charts@1.2.0.js');
    expect(html).toContain('so.lib("charts")');
    expect(html).toContain('v1.2.0');
  });
});
