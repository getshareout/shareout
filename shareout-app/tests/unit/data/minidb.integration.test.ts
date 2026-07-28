// Real-runtime smoke test for the per-artifact MiniDB Durable Object (ADR 28).
// No node pragma => runs in the workers pool against the actual workerd runtime,
// so this exercises real SQLite-in-DO via the env.MINIDB binding from wrangler.toml
// (not the mocked unit tests in json-store.test.ts / tables.test.ts).
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleJsonStore } from '../../../src/data/json-store';
import { handleTables } from '../../../src/data/tables';
import { createMiniDb } from '../../../src/data/minidb-client';
import type { DataContext } from '../../../src/data/middleware';

function ctxFor(artifactId: string, workspaceId = 'ws_1'): DataContext {
  return {
    artifactId,
    workspaceId,
    artifact: { id: artifactId, name: 'T', visibility: 'public', auth_method: null, workspace_id: workspaceId },
    db: createMiniDb(env as never, artifactId, workspaceId),
    env: env as never,
    origin: null,
  };
}

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`https://shareout.test${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe('MiniDB Durable Object — real runtime (ADR 28)', () => {
  it('round-trips the json store through real SQLite-in-DO', async () => {
    const ctx = ctxFor('art_json_rt');

    const put = await handleJsonStore(req('PUT', '/json/greeting', 'hello'), ctx, '/greeting');
    expect(put.status).toBe(201);
    expect(await put.json()).toMatchObject({ success: true, data: { created: true } });

    const get = await handleJsonStore(req('GET', '/json/greeting'), ctx, '/greeting');
    expect(get.status).toBe(200);
    expect(await get.json()).toMatchObject({ success: true, data: { value: 'hello' } });

    const list = await handleJsonStore(req('GET', '/json'), ctx, '');
    expect(await list.json()).toMatchObject({ success: true, data: { keys: ['greeting'], count: 1 } });

    const del = await handleJsonStore(req('DELETE', '/json/greeting'), ctx, '/greeting');
    expect(del.status).toBe(200);

    const gone = await handleJsonStore(req('GET', '/json/greeting'), ctx, '/greeting');
    expect(gone.status).toBe(404);
  });

  it('creates a table, inserts and queries rows through real SQLite-in-DO', async () => {
    const ctx = ctxFor('art_tbl_rt');

    const insert = await handleTables(req('POST', '/tables/leads', { name: 'Alice' }), ctx, 'leads');
    expect(insert.status).toBe(201);

    const list = await handleTables(req('GET', '/tables'), ctx, '');
    expect(await list.json()).toMatchObject({ success: true, data: { tables: [{ name: 'leads', rowCount: 1 }] } });

    const query = await handleTables(req('POST', '/tables/leads/query', {}), ctx, 'leads/query');
    expect(query.status).toBe(200);
    const queried = await query.json() as { data: { rows: Array<{ name: string }> } };
    expect(queried.data.rows[0]).toMatchObject({ name: 'Alice' });
  });

  it('runs a batch as one transaction: N statements -> N results, order preserved', async () => {
    const db = createMiniDb(env as never, 'art_batch_rt', 'ws_1');
    const results = await db.batch([
      { sql: "INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes) VALUES ('j1', 'art_batch_rt', 'a', '1', 1)", mode: 'run' },
      { sql: "INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes) VALUES ('j2', 'art_batch_rt', 'b', '2', 1)", mode: 'run' },
      { sql: "SELECT key FROM artifact_json WHERE artifact_id = 'art_batch_rt' ORDER BY key", mode: 'all' },
    ]);

    expect(results).toHaveLength(3);
    expect((results[0].meta as { changes: number }).changes).toBeGreaterThan(0);
    expect(results[2].results).toEqual([{ key: 'a' }, { key: 'b' }]);
  });

  it('rolls back the whole batch when any statement fails (atomicity)', async () => {
    const db = createMiniDb(env as never, 'art_rollback_rt', 'ws_1');

    await expect(db.batch([
      { sql: "INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes) VALUES ('k1', 'art_rollback_rt', 'x', '1', 1)", mode: 'run' },
      { sql: 'THIS IS NOT VALID SQL', mode: 'run' },
    ])).rejects.toThrow();

    const after = await db.batch([
      { sql: "SELECT COUNT(*) AS c FROM artifact_json WHERE artifact_id = 'art_rollback_rt'", mode: 'first' },
    ]);
    expect((after[0].result as { c: number }).c).toBe(0);
  });

  it('insertMany keeps row_count exact via a single batched transaction', async () => {
    const ctx = ctxFor('art_insertmany_rt');
    const rows = Array.from({ length: 100 }, (_, i) => ({ n: i }));

    const insert = await handleTables(req('POST', '/tables/bulk', { rows }), ctx, 'bulk');
    expect(insert.status).toBe(201);

    const list = await handleTables(req('GET', '/tables'), ctx, '');
    expect(await list.json()).toMatchObject({ success: true, data: { tables: [{ name: 'bulk', rowCount: 100 }] } });
  });

  it('enforces the workspace_id partition invariant (binds first, rejects mismatch)', async () => {
    const stub = env.MINIDB.get(env.MINIDB.idFromName('art_ws_rt'));
    const exec = (workspace: string) =>
      stub.fetch('https://minidb/exec', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspace },
        body: JSON.stringify({ sql: 'SELECT 1 AS one', mode: 'all' }),
      });

    expect((await exec('ws_1')).status).toBe(200);
    expect((await exec('ws_1')).status).toBe(200);
    expect((await exec('ws_2')).status).toBe(409);
  });
});
