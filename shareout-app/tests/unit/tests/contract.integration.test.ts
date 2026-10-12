import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { handleTables } from '../../../src/data/tables';
import { createMiniDb } from '../../../src/data/minidb-client';
import type { DataContext } from '../../../src/data/middleware';
import { runContract } from '../../../src/tests/contract';

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

const post = (body: unknown) => new Request('https://shareout.test/tables/orders', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

describe('runContract table columns (real MiniDB)', () => {
  it('passes for a single row that has the column', async () => {
    await handleTables(post({ total: 100 }), ctxFor('art_ct_1'), 'orders');
    const [r] = await runContract(env as never, 'art_ct_1', 'ws_1', [{ store: 'table:orders', expect: { columns: ['total'], minRows: 1 } }]);
    expect(r.message).toBe('table "orders" ok (1 rows)');
    expect(r.status).toBe('passed');
  });

  it('passes when an older row has a different shape', async () => {
    const ctx = ctxFor('art_ct_2');
    await handleTables(post({ note: 'x' }), ctx, 'orders');
    await handleTables(post({ total: 100 }), ctx, 'orders');
    const [r] = await runContract(env as never, 'art_ct_2', 'ws_1', [{ store: 'table:orders', expect: { columns: ['total'] } }]);
    expect(r.status).toBe('passed');
  });

  it('still fails when no row has the column', async () => {
    await handleTables(post({ note: 'x' }), ctxFor('art_ct_3'), 'orders');
    const [r] = await runContract(env as never, 'art_ct_3', 'ws_1', [{ store: 'table:orders', expect: { columns: ['total', 'note'] } }]);
    expect(r.status).toBe('failed');
    expect(r.message).toBe('missing columns: total');
  });
});
