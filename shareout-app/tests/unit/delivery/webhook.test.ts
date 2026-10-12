// Webhook destination with includeArtifactData reads the per-artifact MiniDB DO
// (the D1 data_json table no longer exists).
import { env } from 'cloudflare:test';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { DeliveryContext } from '../../../src/delivery/types';
import { webhookDestination } from '../../../src/delivery/destinations/webhook';
import { createMiniDb } from '../../../src/data/minidb-client';

const e = { ...(env as unknown as Env), SHAREOUT_BASE_URL: 'https://shareout.site' } as Env;
const ctx: DeliveryContext = { artifactId: 'art_wh1', createdBy: 'usr', triggeredVia: 'manual' };

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS artifacts (id TEXT PRIMARY KEY, name TEXT, workspace_id TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS deployments (artifact_id TEXT, channel TEXT, slug TEXT)`);
  await e.DB.exec(`INSERT OR IGNORE INTO artifacts (id, name, workspace_id) VALUES ('art_wh1', 'Sales', 'ws_1')`);
  await e.DB.exec(`INSERT INTO deployments (artifact_id, channel, slug) VALUES ('art_wh1', 'production', 'sales')`);
  await createMiniDb(e, 'art_wh1', 'ws_1').prepare(
    'INSERT INTO artifact_json (id, artifact_id, key, value, size_bytes) VALUES (?, ?, ?, ?, ?)',
  ).bind('j1', 'art_wh1', 'metrics', JSON.stringify({ total: 100 }), 13).run();
});

afterEach(() => vi.unstubAllGlobals());

describe('webhook destination', () => {
  it('includes artifact json data from MiniDB when includeArtifactData is set', async () => {
    const fetchMock = vi.fn(async () => new Response('ok'));
    vi.stubGlobal('fetch', fetchMock);
    const res = await webhookDestination.deliver(e, ctx, { url: 'https://hook.test/x', includeArtifactData: true });
    expect(res).toEqual({ success: true });
    const body = JSON.parse((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string);
    expect(body.data).toEqual({ metrics: { total: 100 } });
    expect(body.artifact_url).toBe('https://shareout.site/a/sales/');
  });
});
