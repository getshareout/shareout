import { describe, it, expect, vi, beforeEach } from 'vitest';

const queryConnectionAny = vi.fn();
const appendSheetValues = vi.fn();
const getArtifactAccessToken = vi.fn();

vi.mock('../../src/data/connections/warehouse-query', () => ({ queryConnectionAny: (...a: unknown[]) => queryConnectionAny(...a) }));
vi.mock('../../src/data/sheets/sheet-api', () => ({ appendSheetValues: (...a: unknown[]) => appendSheetValues(...a) }));
vi.mock('../../src/data/sheets/artifact-tokens', () => ({ getArtifactAccessToken: (...a: unknown[]) => getArtifactAccessToken(...a) }));
// resolveSpreadsheetId stays real so we exercise URL/id parsing.

import { getDestination } from '../../src/delivery/registry';
import type { DeliveryContext } from '../../src/delivery/types';

const dest = getDestination('sheets_append')!;
const ctx: DeliveryContext = { artifactId: 'art_1', createdBy: 'usr_job', triggeredVia: 'cron' };
const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ owner_id: 'usr_owner' }) }) }) },
} as never;

const SHEET_URL = 'https://docs.google.com/spreadsheets/d/1AbCdEfGhIjKlMnOpQrStUvWxYz/edit#gid=0';
const SHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz';

const goodConfig = {
  connection: 'bigquery',
  params: { projectId: 'analytics-platform' },
  query: 'SELECT date, revenue FROM t',
  spreadsheetUrl: SHEET_URL,
  range: 'Daily',
};

beforeEach(() => {
  queryConnectionAny.mockReset();
  appendSheetValues.mockReset().mockResolvedValue({ updatedRows: 1, updatedCells: 2 });
  getArtifactAccessToken.mockReset().mockResolvedValue('ya29.token');
});

describe('sheets_append validate', () => {
  it('requires connection, query, and a resolvable spreadsheet', async () => {
    expect(await dest.validate(env, ctx, {} as never)).toMatch(/connection/);
    expect(await dest.validate(env, ctx, { connection: 'bq' } as never)).toMatch(/query/);
    expect(await dest.validate(env, ctx, { connection: 'bq', query: 'x' } as never)).toMatch(/spreadsheet/);
    expect(await dest.validate(env, ctx, { connection: 'bq', query: 'x', spreadsheetUrl: 'not-a-sheet' } as never)).toMatch(/parse/);
    expect(await dest.validate(env, ctx, goodConfig as never)).toBeNull();
  });
});

describe('sheets_append deliver', () => {
  it('appends query rows, defaulting columns to the first row keys', async () => {
    queryConnectionAny.mockResolvedValue([
      { date: '2026-06-22', revenue: 419.64 },
      { date: '2026-06-22', revenue: 59.02 },
    ]);
    const res = await dest.deliver(env, ctx, goodConfig as never);
    expect(res).toEqual({ success: true });

    expect(queryConnectionAny).toHaveBeenCalledWith(
      env, 'art_1', 'bigquery', 'SELECT date, revenue FROM t', { projectId: 'analytics-platform' }, 'usr_owner'
    );
    const [token, spreadsheetId, range, values] = appendSheetValues.mock.calls[0];
    expect(token).toBe('ya29.token');
    expect(spreadsheetId).toBe(SHEET_ID);     // parsed from the URL
    expect(range).toBe('Daily');
    expect(values).toEqual([
      ['2026-06-22', 419.64],
      ['2026-06-22', 59.02],
    ]);
  });

  it('honors an explicit column order and coerces cells', async () => {
    queryConnectionAny.mockResolvedValue([{ a: 1, b: null, c: { x: 1 }, d: true }]);
    await dest.deliver(env, ctx, { ...goodConfig, columns: ['d', 'b', 'c', 'a'] } as never);
    expect(appendSheetValues.mock.calls[0][3]).toEqual([[true, '', '{"x":1}', 1]]);
  });

  it('defaults the range to Sheet1 when omitted', async () => {
    queryConnectionAny.mockResolvedValue([{ a: 1 }]);
    await dest.deliver(env, ctx, { connection: 'bq', query: 'x', spreadsheetId: SHEET_ID } as never);
    expect(appendSheetValues.mock.calls[0][2]).toBe('Sheet1');
  });

  it('no-ops on empty results by default, but fails when skipIfEmpty is false', async () => {
    queryConnectionAny.mockResolvedValue([]);
    expect(await dest.deliver(env, ctx, goodConfig as never)).toEqual({ success: true });
    expect(appendSheetValues).not.toHaveBeenCalled();

    expect((await dest.deliver(env, ctx, { ...goodConfig, skipIfEmpty: false } as never)).success).toBe(false);
  });

  it('fails clearly when Google Sheets is not connected', async () => {
    queryConnectionAny.mockResolvedValue([{ a: 1 }]);
    getArtifactAccessToken.mockResolvedValue(null);
    const res = await dest.deliver(env, ctx, goodConfig as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/not connected/i);
    expect(appendSheetValues).not.toHaveBeenCalled();
  });

  it('surfaces a query failure as a failed delivery', async () => {
    queryConnectionAny.mockRejectedValue(new Error('BigQuery failed: bad SQL'));
    const res = await dest.deliver(env, ctx, goodConfig as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/bad SQL/);
  });

  it('tolerates a {rows:[...]} envelope from REST connections', async () => {
    queryConnectionAny.mockResolvedValue({ rows: [{ a: 'x' }] });
    await dest.deliver(env, ctx, { connection: 'rest', query: '/path', spreadsheetId: SHEET_ID } as never);
    expect(appendSheetValues.mock.calls[0][3]).toEqual([['x']]);
  });
});
