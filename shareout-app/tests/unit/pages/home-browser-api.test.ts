import { describe, expect, it } from 'vitest';
import { handleHomeBrowserApi } from '../../../src/pages/home/api';
import type { Env } from '../../../src/types';

const user = { id: 'usr_1', email: 'owner@example.com' };

/** D1 stub routing by SQL shape — enough surface for handleHomeBrowserApi's full
 *  call graph (visibility scope, feature flags, artifact query, folder queries)
 *  without needing a real D1 binding. Unmatched queries get safe empty defaults. */
function mkEnv(): Env {
  const DB = {
    prepare: (sql: string) => ({
      bind: (..._args: unknown[]) => ({
        first: async () => {
          if (sql.includes('COUNT(DISTINCT a.id) as total')) return { total: 0 };
          return null;
        },
        all: async () => {
          if (sql.includes('WITH RECURSIVE')) {
            return { results: [{ id: 'fld_root', name: 'Root' }, { id: 'fld_x', name: 'Marketing' }] };
          }
          if (sql.includes('FROM folders f') && sql.includes('f.parent_id = ?')) {
            return { results: [{ id: 'fld_y', name: 'Q3', artifact_count: 2 }] };
          }
          return { results: [] };
        },
        run: async () => ({ success: true }),
      }),
    }),
  };
  return { DB } as unknown as Env;
}

function req(url: string): Request {
  return new Request(url, { headers: { host: 'shareout.site' } });
}

describe('work/026 — handleHomeBrowserApi renders nested folder navigation', () => {
  it('root (no folder param): returns root foldersHtml, no breadcrumb', async () => {
    const res = await handleHomeBrowserApi(req('https://shareout.site/v1/home/browser'), mkEnv(), user);
    const body = await res.json() as Record<string, unknown>;
    expect(body.folderPath).toEqual([]);
    expect(body.folderName).toBeNull();
  });

  it('?folder=<id> deep-link: returns the folder’s breadcrumb path and its subfolders as foldersHtml', async () => {
    const res = await handleHomeBrowserApi(req('https://shareout.site/v1/home/browser?folder=fld_x'), mkEnv(), user);
    const body = await res.json() as Record<string, unknown>;
    expect(body.folderPath).toEqual([{ id: 'fld_root', name: 'Root' }, { id: 'fld_x', name: 'Marketing' }]);
    expect(body.folderName).toBe('Marketing');
    expect(body.foldersHtml).toContain('Q3'); // subfolder card rendered
    // Nesting repeats root behaviour: personal folders stay manageable at any depth, so
    // subfolders keep their rename/delete actions and New folder is offered inside a folder.
    expect(body.foldersHtml).toContain('wsx-folder-card__actions');
    expect(body.canManageFolders).toBe(true);
  });

  it('empty folder (no subfolders, no artifacts): emptyHtml renders instead of a broken grid', async () => {
    const res = await handleHomeBrowserApi(req('https://shareout.site/v1/home/browser?folder=fld_empty'), mkEnv(), user);
    const body = await res.json() as Record<string, unknown>;
    expect(body.cardsHtml).toBe('');
    expect(typeof body.emptyHtml).toBe('string');
    expect((body.emptyHtml as string).length).toBeGreaterThan(0);
  });
});
