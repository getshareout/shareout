import { describe, it, expect, vi, beforeEach } from 'vitest';

const runMaterializeMock = vi.fn();
vi.mock('../../src/data/materialize', () => ({ runMaterialize: (...a: unknown[]) => runMaterializeMock(...a) }));
vi.mock('../../src/data/connections/warehouse-query', () => ({ queryConnectionAny: vi.fn() }));

import { getDestination } from '../../src/delivery/registry';
import type { DeliveryContext } from '../../src/delivery/types';

const dest = getDestination('query_snapshot')!;
const ctx: DeliveryContext = { artifactId: 'art_1', createdBy: 'usr_job', triggeredVia: 'cron' };
const env = {
  DB: { prepare: () => ({ bind: () => ({ first: async () => ({ owner_id: 'usr_owner' }) }) }) },
} as never;

const goodConfig = {
  connection: 'bigquery',
  params: { projectId: 'analytics-platform' },
  queries: [
    { query: 'SELECT 1', target: { type: 'json', name: 'snapshot', path: 'by_ad_type' } },
    { query: 'SELECT 2', target: { type: 'json', name: 'digest' } },
  ],
};

beforeEach(() => runMaterializeMock.mockReset().mockResolvedValue({ target: 'json', name: 'x', rowCount: 1 }));

describe('query_snapshot validate', () => {
  it('requires a connection and a non-empty queries[] with valid targets', async () => {
    expect(await dest.validate(env, ctx, {} as never)).toMatch(/connection/);
    expect(await dest.validate(env, ctx, { connection: 'bq' } as never)).toMatch(/queries/);
    expect(await dest.validate(env, ctx, { connection: 'bq', queries: [{ query: 'x' }] } as never)).toMatch(/target/);
    expect(await dest.validate(env, ctx, goodConfig as never)).toBeNull();
  });
});

describe('query_snapshot deliver', () => {
  it('runs every query through runMaterialize with the configured target', async () => {
    const res = await dest.deliver(env, ctx, goodConfig as never);
    expect(res.success).toBe(true);
    expect(res.steps).toHaveLength(2);
    expect(res.steps?.[0]).toMatchObject({ step: 'fetch', status: 'success', detail: { target: 'json:snapshot' } });
    expect(runMaterializeMock).toHaveBeenCalledTimes(2);

    const [, artifactId, params] = runMaterializeMock.mock.calls[0];
    expect(artifactId).toBe('art_1');
    expect(params.source).toEqual({ connection: 'bigquery', query: 'SELECT 1', options: { params: { projectId: 'analytics-platform' } } });
    expect(params.target).toEqual({ type: 'json', name: 'snapshot', path: 'by_ad_type' });
    expect(runMaterializeMock.mock.calls[1][2].target).toEqual({ type: 'json', name: 'digest' });
  });

  it('surfaces a query failure as a failed delivery', async () => {
    runMaterializeMock.mockRejectedValueOnce(new Error('BigQuery failed: bad SQL'));
    const res = await dest.deliver(env, ctx, goodConfig as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/bad SQL/);
  });
});
