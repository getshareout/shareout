// @vitest-environment node
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
import { createCollection, createShareLink } from '../../../src/assets/deliverables';
import { handleDeliveryFile } from '../../../src/serve/download-page';

const A = 'usr_f07b_a';
const B = 'usr_f07b_b';
const X = 'usr_f07b_x';
const WS = 'wsp_f07b';
const WS2 = 'wsp_f07b2';
let bucketWs = '';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'a@f07b.test', 'a'), (?, 'b@f07b.test', 'b'), (?, 'x@f07b.test', 'x')").bind(A, B, X),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f07b-w', ?), (?, 'W2', 'f07b-w2', ?)").bind(WS, A, WS2, X),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f07b_a', ?, ?, 'owner', 'internal'), ('wm_f07b_b', ?, ?, 'member', 'internal'), ('wm_f07b_x', ?, ?, 'owner', 'internal')").bind(WS, A, WS, B, WS2, X),
    e.DB.prepare("INSERT INTO folders (id, workspace_id, owner_id, name, slug) VALUES ('fld_f07b_own', ?, ?, 'Own', 'own'), ('fld_f07b_other', ?, ?, 'Other', 'other')").bind(WS, A, WS2, X),
  ]);
  bucketWs = (await getOrCreateAssetBucket(e, A, WS)).id;
  await e.DB.batch([
    e.DB.prepare("INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, visibility) VALUES ('dlv_f07b', ?, ?, ?, 'F', 'team')").bind(bucketWs, WS, A),
    e.DB.prepare("INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES ('blb_f07b', ?, 'f.txt', 'text/plain', 'k/f07b', 1, 'dlv_f07b', 1)").bind(bucketWs),
  ]);
  await e.ARTIFACTS.put('k/f07b', 'secret');
});

function call(as: string, path: string, method = 'GET', body?: unknown) {
  h.userId = as;
  const req = new Request(`https://shareout.test${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return routeAssetApi(createFetchContext(req, e));
}
const wsa = `/v1/workspaces/${WS}/assets`;
const folderOf = async () => (await e.DB.prepare("SELECT folder_id FROM asset_deliverables WHERE id = 'dlv_f07b'").first<{ folder_id: string | null }>())?.folder_id;

describe('f07b PATCH folderId is bound to the caller workspace', () => {
  it('blocks: a folder from another workspace is rejected', async () => {
    const res = await call(A, `${wsa}/deliverables/dlv_f07b`, 'PATCH', { folderId: 'fld_f07b_other' });
    expect(res?.status).toBe(400);
    expect(await folderOf()).toBeNull();
    expect((await call(A, `${wsa}/deliverables/dlv_f07b`, 'PATCH', { folderId: 'fld_missing' }))?.status).toBe(400);
  });
  it('still moves into an own-workspace folder and back to root', async () => {
    expect((await call(A, `${wsa}/deliverables/dlv_f07b`, 'PATCH', { folderId: 'fld_f07b_own' }))?.status).toBe(200);
    expect(await folderOf()).toBe('fld_f07b_own');
    expect((await call(A, `${wsa}/deliverables/dlv_f07b`, 'PATCH', { folderId: null }))?.status).toBe(200);
    expect(await folderOf()).toBeNull();
  });
});

describe('f07b private files do not leave through a stranger’s collection link', () => {
  it('blocks: file made private after a peer bundled it is not served by the peer’s link', async () => {
    const col = await createCollection(e, bucketWs, WS, B, 'Pack', ['dlv_f07b']);
    const link = await createShareLink(e, col.id, B, { expiresAt: null, gate: 'none', gateValue: null });
    const token = link.url.split('/d/')[1];
    const get = () => handleDeliveryFile(token, 'blb_f07b', e, new Request(`https://shareout.test/d/${token}/f/blb_f07b`));
    expect((await get()).status).toBe(200);
    expect((await call(A, `${wsa}/deliverables/dlv_f07b`, 'PATCH', { visibility: 'private' }))?.status).toBe(200);
    expect((await get()).status).toBe(404);
    await call(A, `${wsa}/deliverables/dlv_f07b`, 'PATCH', { visibility: 'team' });
    expect((await get()).status).toBe(200);
  });
  it('still serves a private file in its own owner’s collection', async () => {
    const col = await createCollection(e, bucketWs, WS, A, 'Mine', ['dlv_f07b']);
    const link = await createShareLink(e, col.id, A, { expiresAt: null, gate: 'none', gateValue: null });
    const token = link.url.split('/d/')[1];
    await call(A, `${wsa}/deliverables/dlv_f07b`, 'PATCH', { visibility: 'private' });
    expect((await handleDeliveryFile(token, 'blb_f07b', e, new Request(`https://shareout.test/d/${token}/f/blb_f07b`))).status).toBe(200);
  });
});
