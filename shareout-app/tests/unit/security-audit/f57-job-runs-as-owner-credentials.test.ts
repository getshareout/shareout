// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';

const q = vi.hoisted(() => vi.fn(async () => [{ a: 1 }]));
vi.mock('../../../src/data/connections/warehouse-query', () => ({ queryConnectionAny: q }));
vi.mock('../../../src/data/sheets/artifact-tokens', () => ({ getArtifactAccessToken: async () => 'tok' }));
vi.mock('../../../src/data/sheets/sheet-api', () => ({ appendSheetValues: async () => {} }));

import { getDestination } from '../../../src/delivery/registry';

const env = { DB: { prepare: () => ({ bind: () => ({ first: async () => ({ owner_id: 'usr_owner' }) }) }) } } as never;
beforeEach(() => q.mockClear());

describe('f57 editor job credential principal', () => {
  it('blocks: sheets_append runs the warehouse query as the job creator, not the artifact owner', async () => {
    const dest = getDestination('sheets_append')!;
    await dest.deliver(env, { artifactId: 'art_1', createdBy: 'usr_editor', triggeredVia: 'cron' },
      { connection: 'bq', query: 'SELECT 1', spreadsheetId: 'sheet1' } as never);
    expect(q).toHaveBeenCalledTimes(1);
    expect(q.mock.calls[0][5]).toBe('usr_editor');
  });
});
