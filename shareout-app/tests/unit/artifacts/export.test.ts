// @vitest-environment node
import './setup';
import { describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { handleExportArtifact, handleExportWorkspace } from '../../../src/artifacts/export';
import type { Env } from '../../../src/types';
import type { AuthUser } from '../../../src/api-auth';

const owner: AuthUser = { id: 'usr_1', email: 'owner@example.com', username: null };
const stranger: AuthUser = { id: 'usr_other', email: 'nope@example.com', username: null };

// Mock the workspace role lookup used for admin access.
vi.mock('../../../src/workspaces', () => ({
  getInternalWorkspaceRole: vi.fn(async () => null),
}));
import { getInternalWorkspaceRole } from '../../../src/workspaces';

function r2(map: Record<string, string>): Env['ARTIFACTS'] {
  return {
    get: vi.fn(async (key: string) =>
      key in map ? { arrayBuffer: async () => new TextEncoder().encode(map[key]).buffer } : null,
    ),
  } as unknown as Env['ARTIFACTS'];
}

// D1 mock: route first()/all() by matching the prepared SQL.
function db(handlers: {
  first?: (sql: string, args: unknown[]) => unknown;
  all?: (sql: string, args: unknown[]) => unknown;
}): Env['DB'] {
  return {
    prepare: vi.fn((sql: string) => ({
      bind: vi.fn((...args: unknown[]) => ({
        first: vi.fn(async () => handlers.first?.(sql, args) ?? null),
        all: vi.fn(async () => handlers.all?.(sql, args) ?? { results: [] }),
      })),
    })),
  } as unknown as Env['DB'];
}

// MiniDB DO namespace mock: answers artifact_json / artifact_tables / artifact_rows.
function minidb(data: {
  json?: Record<string, unknown>;
  tables?: { name: string; rows: Record<string, unknown>[] }[];
}): Env['MINIDB'] {
  const tables = data.tables ?? [];
  return {
    idFromName: (n: string) => n,
    get: () => ({
      fetch: async (_url: string, opts: { body: string }) => {
        const body = JSON.parse(opts.body) as { sql: string };
        const sql = body.sql;
        if (sql.includes('FROM artifact_json')) {
          return Response.json({
            results: Object.entries(data.json ?? {}).map(([key, value]) => ({ key, value: JSON.stringify(value) })),
          });
        }
        if (sql.includes('FROM artifact_tables')) {
          return Response.json({ results: tables.map((t, i) => ({ id: `tbl_${i}`, name: t.name })) });
        }
        if (sql.includes('FROM artifact_rows')) {
          const idx = Number(/tbl_(\d+)/.exec(JSON.stringify(body))?.[1] ?? -1);
          const t = tables.find((_, i) => i === idx);
          return Response.json({ results: (t?.rows ?? []).map((row) => ({ data: JSON.stringify(row) })) });
        }
        return Response.json({ results: [] });
      },
    }),
  } as unknown as Env['MINIDB'];
}

const artifactRow = { id: 'art_1', name: 'My Report', slug: 'my-report', owner_id: 'usr_1', workspace_id: null };

function baseArtifactEnv(): Env {
  return {
    ARTIFACTS: r2({ 'r2/index.html': '<h1>hi</h1>' }),
    DB: db({
      first: (sql) => {
        if (sql.includes('FROM artifacts WHERE id')) return artifactRow;
        if (sql.includes('FROM deployments')) return { version_id: 'ver_1' };
        if (sql.includes('FROM versions WHERE id')) return { version_no: 4 };
        return null;
      },
      all: (sql) => {
        if (sql.includes('FROM assets')) return { results: [{ path: 'index.html', r2_key: 'r2/index.html' }] };
        return { results: [] };
      },
    }),
    MINIDB: minidb({
      json: { config: { theme: 'dark' } },
      tables: [{ name: 'events', rows: [{ id: 1, note: 'a,b' }, { id: 2, note: 'plain' }] }],
    }),
  } as unknown as Env;
}

describe('handleExportArtifact', () => {
  it('owner gets a zip with source html, data, and manifest', async () => {
    vi.mocked(getInternalWorkspaceRole).mockResolvedValue(null);
    const res = await handleExportArtifact(baseArtifactEnv(), owner, 'art_1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/zip');
    expect(res.headers.get('Content-Disposition')).toContain('my-report.zip');

    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(strFromU8(files['source/index.html'])).toBe('<h1>hi</h1>');
    expect(strFromU8(files['data/json/config.json'])).toContain('dark');

    const csv = strFromU8(files['data/tables/events.csv']);
    expect(csv.split('\n')[0]).toBe('id,note');
    expect(csv).toContain('"a,b"'); // comma cell is quoted

    const manifest = JSON.parse(strFromU8(files['manifest.json']));
    expect(manifest).toMatchObject({ id: 'art_1', title: 'My Report', slug: 'my-report', version: 4 });
    expect(manifest.exported_at).toBeTruthy();
  });

  it('non-owner without workspace role gets 403', async () => {
    vi.mocked(getInternalWorkspaceRole).mockResolvedValue(null);
    const res = await handleExportArtifact(baseArtifactEnv(), stranger, 'art_1');
    expect(res.status).toBe(403);
  });

  it('404 when artifact is missing', async () => {
    const env = { ...baseArtifactEnv(), DB: db({ first: () => null }) } as Env;
    const res = await handleExportArtifact(env, owner, 'nope');
    expect(res.status).toBe(404);
  });
});

describe('handleExportWorkspace', () => {
  const wsArtifacts = [
    { id: 'art_1', name: 'One', slug: 'one', owner_id: 'usr_1', workspace_id: 'wsp_1' },
    { id: 'art_2', name: 'Two', slug: 'two', owner_id: 'usr_2', workspace_id: 'wsp_1' },
  ];

  function wsEnv(): Env {
    return {
      ARTIFACTS: r2({}),
      DB: db({
        first: (sql) => (sql.includes('FROM deployments') ? null : null),
        all: (sql) => {
          if (sql.includes('WHERE workspace_id')) return { results: wsArtifacts };
          return { results: [] };
        },
      }),
      MINIDB: minidb({}),
    } as unknown as Env;
  }

  it('admin exports all workspace artifacts, each in its own folder', async () => {
    vi.mocked(getInternalWorkspaceRole).mockResolvedValue('admin');
    const res = await handleExportWorkspace(wsEnv(), owner, 'wsp_1');
    expect(res.status).toBe(200);

    const files = unzipSync(new Uint8Array(await res.arrayBuffer()));
    expect(files['one/manifest.json']).toBeTruthy();
    expect(files['two/manifest.json']).toBeTruthy();
    expect(JSON.parse(strFromU8(files['one/manifest.json'])).title).toBe('One');
  });

  it('non-member gets 403', async () => {
    vi.mocked(getInternalWorkspaceRole).mockResolvedValue(null);
    const res = await handleExportWorkspace(wsEnv(), stranger, 'wsp_1');
    expect(res.status).toBe(403);
  });
});
