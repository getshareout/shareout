// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';

// B14: materializing a dataset from a connection auto-links connection → dataset →
// artifact in the catalog. Assert the wiring here; the lineage-write logic itself
// (idempotency, manual-edit preservation) is covered by catalog/seed-resources.test.ts.
const lineageMock = vi.fn(async () => undefined);
vi.mock('../../../src/catalog', () => ({
  recordDatasetLineage: (...args: unknown[]) => lineageMock(...args),
}));

import { runMaterialize } from '../../../src/data/materialize';

const ARTIFACT = 'art_test';

// Minimal stateful in-memory mock. Datasets live in D1 (env.DB); tables/rows live in
// the per-artifact MiniDB Durable Object (env.MINIDB) after migration 0039 — so the
// table statements are served by the MINIDB stub, never by D1. `workspaceId` controls
// what the artifact's workspace lookup (used by the B14 lineage hook) resolves to —
// undefined means no workspace, so lineage is a no-op in most existing tests.
function makeEnv(opts: { workspaceId?: string } = {}) {
  const datasets: Record<string, { id: string; version: number; r2_key: string; size_bytes: number; metadata: string }> = {};
  const tables: Record<string, { id: string; row_count: number }> = {};
  const rows: Array<{ id: string; table_id: string; data: string }> = [];
  const r2: Record<string, Uint8Array> = {};
  const d1Writes: string[] = []; // every INSERT/UPDATE/DELETE that reached D1
  let seq = 0;

  const exec = (sql: string, args: unknown[]) => {
    const s = sql.replace(/\s+/g, ' ').trim();
    return {
      first: async () => {
        if (s.startsWith('SELECT id, version, r2_key FROM datasets')) {
          return datasets[args[1] as string] ?? null;
        }
        if (s.startsWith('SELECT workspace_id FROM artifacts')) {
          return opts.workspaceId ? { workspace_id: opts.workspaceId } : null;
        }
        return null;
      },
      run: async () => {
        d1Writes.push(s);
        if (s.startsWith('INSERT INTO datasets')) {
          const [, , name, , r2_key, size] = args as string[];
          datasets[name as string] = { id: `dst_${++seq}`, version: 1, r2_key, size_bytes: Number(size), metadata: '' };
        } else if (s.startsWith('UPDATE datasets SET')) {
          // bind order: r2_key, format, size, sha, version, metadata, now, id
          const r2_key = args[0] as string;
          const version = args[4] as number;
          const id = args[7] as string;
          const entry = Object.values(datasets).find(d => d.id === id);
          if (entry) { entry.r2_key = r2_key; entry.version = version; }
        }
        return { success: true, meta: { changes: 1 } };
      },
      all: async () => ({ results: [] }),
    };
  };

  // Serves the artifact_tables/artifact_rows statements writeTableRows issues against MiniDB.
  const miniExec = (sqlRaw: string, args: unknown[], mode: string) => {
    const s = sqlRaw.replace(/\s+/g, ' ').trim();
    if (mode === 'first') {
      if (s.startsWith('SELECT id, row_count FROM artifact_tables')) return { result: tables[args[1] as string] ?? null };
      if (s.startsWith('SELECT COUNT(*) as count FROM artifact_tables')) return { result: { count: Object.keys(tables).length } };
      return { result: null };
    }
    if (s.startsWith('INSERT INTO artifact_tables')) {
      const [id, , name] = args as string[];
      tables[name] = { id, row_count: 0 };
    } else if (s.startsWith('DELETE FROM artifact_rows WHERE table_id = ?')) {
      const tid = args[0];
      for (let i = rows.length - 1; i >= 0; i--) if (rows[i].table_id === tid) rows.splice(i, 1);
    } else if (s.startsWith('INSERT INTO artifact_rows')) {
      const [id, table_id, data] = args as string[];
      rows.push({ id, table_id, data });
    } else if (s.startsWith('UPDATE artifact_tables SET row_count')) {
      const count = args[0] as number;
      const id = args[1] as string;
      const entry = Object.values(tables).find(t => t.id === id);
      if (entry) entry.row_count = count;
    }
    return { meta: { changes: 1 } };
  };

  const env = {
    DB: {
      prepare: (sql: string) => ({ bind: (...args: unknown[]) => exec(sql, args) }),
      batch: (stmts: Array<{ run: () => Promise<unknown> }>) => Promise.all(stmts.map((s) => s.run())),
    },
    MINIDB: {
      idFromName: (n: string) => n,
      get: () => ({
        fetch: async (_url: string, init: { body: string }) => {
          const body = JSON.parse(init.body) as { batch?: Array<{ sql: string; bindings?: unknown[]; mode?: string }>; sql?: string; bindings?: unknown[]; mode?: string };
          const payload = body.batch
            ? { results: body.batch.map((st) => miniExec(st.sql, st.bindings ?? [], st.mode ?? 'run')) }
            : miniExec(body.sql!, body.bindings ?? [], body.mode!);
          return { ok: true, json: async () => payload };
        },
      }),
    },
    ARTIFACTS: {
      put: async (key: string, body: ArrayBuffer | Uint8Array) => {
        r2[key] = body instanceof Uint8Array ? body : new Uint8Array(body);
      },
      get: async (key: string) => (r2[key] ? { text: async () => new TextDecoder().decode(r2[key]) } : null),
      head: async (key: string) => (r2[key] ? { size: r2[key].byteLength } : null),
      delete: async (key: string) => { delete r2[key]; },
    },
  } as unknown as Env;

  return { env, datasets, tables, rows, r2, d1Writes };
}

const SAMPLE = [
  { id: 1, region: 'NA', revenue: 100 },
  { id: 2, region: 'EU', revenue: 200 },
];

describe('runMaterialize', () => {
  it('materializes inline rows into a JSON dataset (R2 file + datasets row)', async () => {
    const { env, datasets, r2 } = makeEnv();
    const res = await runMaterialize(env, ARTIFACT, {
      rows: SAMPLE,
      target: { type: 'dataset', name: 'sales' },
      format: 'json',
    });

    expect(res).toMatchObject({ target: 'dataset', name: 'sales', rowCount: 2, version: 1 });
    expect(datasets.sales).toBeTruthy();
    const stored = JSON.parse(new TextDecoder().decode(r2[datasets.sales.r2_key]));
    expect(stored).toEqual(SAMPLE);
  });

  it('materializes inline rows into a CSV dataset', async () => {
    const { env, datasets, r2 } = makeEnv();
    await runMaterialize(env, ARTIFACT, {
      rows: SAMPLE,
      target: { type: 'dataset', name: 'sales_csv' },
      format: 'csv',
    });
    const csv = new TextDecoder().decode(r2[datasets.sales_csv.r2_key]);
    expect(csv.split('\n')[0]).toBe('id,region,revenue');
    expect(csv).toContain('1,NA,100');
  });

  it('materializes inline rows into a table (replace) via MiniDB, not D1', async () => {
    const { env, tables, rows, d1Writes } = makeEnv();
    const res = await runMaterialize(env, ARTIFACT, {
      rows: SAMPLE,
      target: { type: 'table', name: 'shipments' },
      mode: 'replace',
    });

    expect(res).toMatchObject({ target: 'table', name: 'shipments', rowCount: 2, mode: 'replace' });
    expect(tables.shipments.row_count).toBe(2);
    expect(rows).toHaveLength(2);
    expect(JSON.parse(rows[0].data)).toMatchObject({ region: 'NA', revenue: 100 });
    // Regression: artifact_tables/artifact_rows were dropped from D1 in migration 0039.
    // Writing them to env.DB throws "no such table" in prod — they must go to MiniDB.
    expect(d1Writes.some((s) => /artifact_tables|artifact_rows/.test(s))).toBe(false);
  });

  it('runs the injected query function when source is provided', async () => {
    const { env, datasets } = makeEnv();
    const queryFn = async () => ({ data: SAMPLE });
    const res = await runMaterialize(
      env,
      ARTIFACT,
      { source: { connection: 'wh', query: 'SELECT *' }, target: { type: 'dataset', name: 'q' } },
      queryFn
    );
    expect(res.rowCount).toBe(2);
    expect(datasets.q).toBeTruthy();
  });

  it('throws when neither source nor rows provided', async () => {
    const { env } = makeEnv();
    await expect(
      runMaterialize(env, ARTIFACT, { target: { type: 'dataset', name: 'x' } })
    ).rejects.toThrow(/source.*rows/i);
  });

  it('records catalog lineage when a dataset is materialized from a connection', async () => {
    lineageMock.mockClear();
    const { env } = makeEnv({ workspaceId: 'wsp_1' });
    const queryFn = async () => ({ data: SAMPLE });
    await runMaterialize(
      env,
      ARTIFACT,
      { source: { connection: 'wh', query: 'SELECT *' }, target: { type: 'dataset', name: 'q' } },
      queryFn
    );
    expect(lineageMock).toHaveBeenCalledWith(env, 'wsp_1', 'wh', 'q', ARTIFACT);
  });

  it('does not record lineage for inline rows (no connection) or an unresolved workspace', async () => {
    lineageMock.mockClear();
    const { env } = makeEnv(); // no workspaceId configured
    await runMaterialize(env, ARTIFACT, { rows: SAMPLE, target: { type: 'dataset', name: 'sales' } });
    expect(lineageMock).not.toHaveBeenCalled();
  });

  it('a lineage-write failure never fails the materialize', async () => {
    lineageMock.mockClear();
    lineageMock.mockRejectedValueOnce(new Error('boom'));
    const { env, datasets } = makeEnv({ workspaceId: 'wsp_1' });
    const queryFn = async () => ({ data: SAMPLE });
    const res = await runMaterialize(
      env, ARTIFACT,
      { source: { connection: 'wh', query: 'SELECT *' }, target: { type: 'dataset', name: 'q2' } },
      queryFn
    );
    expect(res.rowCount).toBe(2);
    expect(datasets.q2).toBeTruthy();
  });
});
