// @vitest-environment node
// G16: a row PATCH must never store a literal `changes` field, and an empty row id must not 500.
import './mocks';
import './setup';
import { describe, expect, it } from 'vitest';
import { handleTables } from '../../../../src/data/tables';
import { createTablesDb, ctxFromDb, tablesRequest } from './shared';

async function seeded() {
  const db = createTablesDb({ tables: [{ id: 'tbl_t', artifact_id: 'art_1', name: 't', row_count: 0 }] });
  const ctx = ctxFromDb(db);
  const ins = await handleTables(tablesRequest('/t', { method: 'POST', body: JSON.stringify({ estado: 'nuevo' }) }), ctx, '/t');
  const id = (await ins.json()).data.inserted[0].id as string;
  const patch = (body: unknown, path = `/t/${id}`) =>
    handleTables(tablesRequest(path, { method: 'PATCH', body: JSON.stringify(body) }), ctx, path);
  return { id, patch };
}

describe('row PATCH body shape', () => {
  it('unwraps {changes:{...}} (the bulk wrapper agents reuse) and stores no `changes` key', async () => {
    const { patch } = await seeded();
    const res = await patch({ changes: { estado: 'pendiente' } });
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.estado).toBe('pendiente');
    expect('changes' in data).toBe(false);
  });

  it('rejects a `changes` key mixed with other fields, or that is not an object, with a clear 400', async () => {
    const { patch } = await seeded();
    for (const body of [{ changes: { a: 1 }, b: 2 }, { changes: null }, { changes: 'x' }, { changes: [1] }]) {
      const res = await patch(body);
      expect(res.status).toBe(400);
      expect(JSON.stringify(await res.json())).toContain('changes');
    }
  });

  it('flat bodies still work', async () => {
    const { patch } = await seeded();
    const res = await patch({ estado: 'cerrado' });
    expect(res.status).toBe(200);
    expect((await res.json()).data.estado).toBe('cerrado');
  });
});

describe('bulk PATCH without a filter (empty row id)', () => {
  it('answers 400 naming the problem instead of 500', async () => {
    const { patch } = await seeded();
    const res = await patch({ changes: { nota: 'x' } }, '/t/');
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).toMatch(/filter/);
  });

  it('still bulk-updates with an explicit filter', async () => {
    const { patch } = await seeded();
    const res = await patch({ filter: {}, changes: { nota: 'x' } }, '/t');
    expect(res.status).toBe(200);
  });
});
