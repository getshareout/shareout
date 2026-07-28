// Scheduled file delivery (work/042 P4). Real Miniflare D1: validate guards the collection
// to the job's own bucket; deliver mints a share link. Email dispatch is best-effort (mocked away).
import { env } from 'cloudflare:test';
import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest';
import type { Env } from '../../../src/types';
import type { DeliveryContext } from '../../../src/delivery/types';

vi.mock('../../../src/email/gateway', () => ({ dispatchLifecycleEmail: vi.fn(async () => ({ ok: true })) }));
const { assetDeliveryDestination } = await import('../../../src/delivery/destinations/asset-delivery');

const e = { ...(env as unknown as Env), SHAREOUT_BASE_URL: 'https://shareout.site' } as Env;
const ctx: DeliveryContext = { artifactId: 'bk', createdBy: 'usr', triggeredVia: 'cron' };

beforeAll(async () => {
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS asset_collections (id TEXT PRIMARY KEY, bucket_artifact_id TEXT, workspace_id TEXT, owner_id TEXT, name TEXT)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS asset_collection_items (collection_id TEXT, deliverable_id TEXT, position INTEGER)`);
  await e.DB.exec(`CREATE TABLE IF NOT EXISTS asset_share_links (id TEXT PRIMARY KEY, collection_id TEXT, expires_at TEXT, created_by TEXT, gate TEXT, gate_value TEXT, revoked INTEGER DEFAULT 0, view_count INTEGER DEFAULT 0, created_at TEXT DEFAULT (datetime('now')))`);
});

beforeEach(async () => {
  for (const t of ['asset_collections', 'asset_collection_items', 'asset_share_links']) await e.DB.exec(`DELETE FROM ${t}`);
  await e.DB.exec(`INSERT INTO asset_collections (id, bucket_artifact_id, name) VALUES ('col1','bk','Q3 pack'),('colOther','bk2','X')`);
  await e.DB.exec(`INSERT INTO asset_collection_items (collection_id, deliverable_id, position) VALUES ('col1','d1',0),('col1','d2',1)`);
});

describe('asset_delivery destination (work/042 P4)', () => {
  it('validate: accepts a collection in this bucket with valid recipients', async () => {
    expect(await assetDeliveryDestination.validate(e, ctx, { collectionId: 'col1', recipients: ['a@b.com'] })).toBeNull();
  });

  it('validate: rejects a collection in a DIFFERENT bucket', async () => {
    const err = await assetDeliveryDestination.validate(e, ctx, { collectionId: 'colOther', recipients: ['a@b.com'] });
    expect(err).toMatch(/not in this file library/i);
  });

  it('validate: rejects missing recipients and bad emails', async () => {
    expect(await assetDeliveryDestination.validate(e, ctx, { collectionId: 'col1', recipients: [] })).toMatch(/recipient/i);
    expect(await assetDeliveryDestination.validate(e, ctx, { collectionId: 'col1', recipients: ['nope'] })).toMatch(/invalid email/i);
  });

  it('deliver: mints a share link and succeeds', async () => {
    const res = await assetDeliveryDestination.deliver(e, ctx, { collectionId: 'col1', recipients: ['a@b.com', 'c@d.com'], expiresDays: 7 });
    expect(res.success).toBe(true);
    const link = await e.DB.prepare(`SELECT id, expires_at FROM asset_share_links WHERE collection_id='col1'`).first<{ id: string; expires_at: string | null }>();
    expect(link!.id).toMatch(/^dlk_/);
    expect(link!.expires_at).toBeTruthy(); // expiresDays honored
  });
});
