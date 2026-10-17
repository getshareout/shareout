// Files routes act only on files and collections of the caller's own bucket: another
// account's deliverable or collection id gets a 404 and nothing is written.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ userId: '' }));
vi.mock('../../../src/router/helpers/auth-guard', async (orig) => ({
  ...(await orig<object>()),
  requireTokenOrSession: async () => ({ id: h.userId, email: `${h.userId}@example.com`, username: null }),
}));

import { applyMigrations, e } from '../helpers/migrated-db';
import { routeAssetApi } from '../../../src/router/api/assets';
import { createFetchContext } from '../../../src/router/context';
import { getOrCreateAssetBucket } from '../../../src/assets/bucket';

const A = 'usr_bs_a';
const B = 'usr_bs_b';
let dlvB = '';
let colB = '';
let blobA = '';
let blobB = '';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'a@example.com', 'a'), (?, 'b@example.com', 'b')").bind(A, B).run();
  const bucketA = await getOrCreateAssetBucket(e, A, null);
  const bucketB = await getOrCreateAssetBucket(e, B, null);
  blobA = 'blb_bs_a';
  blobB = 'blb_bs_b';
  dlvB = 'dlv_bs_b';
  colB = 'col_bs_b';
  await e.DB.batch([
    e.DB.prepare("INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes) VALUES (?, ?, 'a.txt', 'text/plain', 'k/a', 1), (?, ?, 'b.txt', 'text/plain', 'k/b', 1)")
      .bind(blobA, bucketA.id, blobB, bucketB.id),
    e.DB.prepare("INSERT INTO asset_deliverables (id, bucket_artifact_id, owner_id, name) VALUES (?, ?, ?, 'Report')").bind(dlvB, bucketB.id, B),
    e.DB.prepare('UPDATE blobs SET deliverable_id = ?, version_no = 1 WHERE id = ?').bind(dlvB, blobB),
    e.DB.prepare("INSERT INTO asset_collections (id, bucket_artifact_id, owner_id, name) VALUES (?, ?, ?, 'Pack')").bind(colB, bucketB.id, B),
    e.DB.prepare('INSERT INTO asset_collection_items (collection_id, deliverable_id) VALUES (?, ?)').bind(colB, dlvB),
    e.DB.prepare('INSERT INTO file_artifact_usage (deliverable_id, artifact_id) VALUES (?, ?)').bind(dlvB, bucketB.id),
  ]);
});

function call(as: string, path: string, method = 'GET', body?: unknown) {
  h.userId = as;
  const req = new Request(`https://shareout.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return routeAssetApi(createFetchContext(req, e));
}

describe('Files bucket scoping', () => {
  it('refuses a new version on another account\'s file and leaves it untouched', async () => {
    const res = await call(A, `/v1/assets/deliverables/${dlvB}/version`, 'POST', { blobId: blobA });
    expect(res?.status).toBe(404);
    const row = await e.DB.prepare('SELECT deliverable_id FROM blobs WHERE id = ?').bind(blobA).first<{ deliverable_id: string | null }>();
    expect(row?.deliverable_id ?? null).toBeNull();
  });

  it('still versions the caller\'s own file', async () => {
    const res = await call(B, `/v1/assets/deliverables/${dlvB}/version`, 'POST', { blobId: blobB });
    expect(res?.status).toBe(200);
  });

  it('refuses share links and sends for another account\'s collection', async () => {
    expect((await call(A, `/v1/assets/collections/${colB}/share`, 'POST', {}))?.status).toBe(404);
    expect((await call(A, `/v1/assets/collections/${colB}/send`, 'POST', { to: 'x@example.com' }))?.status).toBe(404);
    const links = await e.DB.prepare('SELECT COUNT(*) AS n FROM asset_share_links WHERE collection_id = ?').bind(colB).first<{ n: number }>();
    expect(links?.n).toBe(0);
    expect((await call(B, `/v1/assets/collections/${colB}/share`, 'POST', {}))?.status).toBe(201);
  });

  it('lists usage only for the caller\'s own file', async () => {
    expect((await call(A, `/v1/assets/deliverables/${dlvB}/usage`))?.status).toBe(404);
    const own = await call(B, `/v1/assets/deliverables/${dlvB}/usage`);
    expect(own?.status).toBe(200);
    expect(((await own!.json()) as { usage: unknown[] }).usage.length).toBe(1);
  });
});
