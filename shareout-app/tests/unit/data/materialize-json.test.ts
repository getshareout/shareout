import { describe, it, expect, vi } from 'vitest';

// Shared fake artifact_json store standing in for the per-artifact MiniDB.
function fakeMiniDb() {
  const store = new Map<string, { id: string; value: string }>();
  return {
    store,
    prepare(sql: string) {
      return {
        bind: (...args: unknown[]) => ({
          async first() {
            if (sql.startsWith('SELECT value')) { const r = store.get(args[1] as string); return r ? { value: r.value } : null; }
            if (sql.startsWith('SELECT id')) { const r = store.get(args[1] as string); return r ? { id: r.id } : null; }
            return null;
          },
          async run() {
            if (sql.startsWith('INSERT')) { store.set(args[2] as string, { id: args[0] as string, value: args[3] as string }); }
            else if (sql.startsWith('UPDATE')) {
              const id = args[3] as string;
              for (const [k, v] of store) if (v.id === id) store.set(k, { id, value: args[0] as string });
            }
            return { meta: { changes: 1 } };
          },
        }),
      };
    },
  };
}

const mini = fakeMiniDb();
vi.mock('../../../src/data/minidb-client', () => ({ createMiniDb: () => mini }));

import { runMaterialize } from '../../../src/data/materialize';

const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ workspace_id: 'wsp_1' }) }) }) },
} as never;

describe('runMaterialize json target', () => {
  it('writes query rows into a json key', async () => {
    const queryFn = vi.fn().mockResolvedValue([{ a: 1 }, { a: 2 }]);
    const res = await runMaterialize(env, 'art_1',
      { source: { connection: 'bq', query: 'SELECT' }, target: { type: 'json', name: 'rows_key' } }, queryFn);

    expect(res).toMatchObject({ target: 'json', name: 'rows_key', rowCount: 2 });
    expect(JSON.parse(mini.store.get('rows_key')!.value)).toEqual([{ a: 1 }, { a: 2 }]);
  });

  it('merges rows at a path inside the key object (refreshing one dashboard field)', async () => {
    await runMaterialize(env, 'art_1',
      { source: { connection: 'bq', query: 'Q1' }, target: { type: 'json', name: 'snapshot', path: 'by_ad_type' } },
      vi.fn().mockResolvedValue([{ ad: 'Display' }]));
    await runMaterialize(env, 'art_1',
      { source: { connection: 'bq', query: 'Q2' }, target: { type: 'json', name: 'snapshot', path: 'by_platform' } },
      vi.fn().mockResolvedValue([{ p: 'Web' }]));

    expect(JSON.parse(mini.store.get('snapshot')!.value)).toEqual({
      by_ad_type: [{ ad: 'Display' }],
      by_platform: [{ p: 'Web' }],
    });
  });
});
