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

const X = 'usr_f68_x';
const Y = 'usr_f68_y';
const O = 'usr_f68_o';
const A = 'usr_f68_a';
const B = 'usr_f68_b';
const WS = 'wsp_f68';
let bucketY = '';
let bucketWs = '';

const seedFile = (bucket: string, dlv: string, blob: string, owner: string, visibility: string) => e.DB.batch([
  e.DB.prepare("INSERT INTO asset_deliverables (id, bucket_artifact_id, owner_id, name, visibility) VALUES (?, ?, ?, 'F', ?)").bind(dlv, bucket, owner, visibility),
  e.DB.prepare("INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES (?, ?, 'f.txt', 'text/plain', ?, 1, ?, 1)").bind(blob, bucket, `k/${blob}`, dlv),
]);

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'x@example.com', 'x'), (?, 'y@example.com', 'y'), (?, 'o@example.com', 'o'), (?, 'a@example.com', 'a'), (?, 'b@example.com', 'b')").bind(X, Y, O, A, B),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'f68-w', ?)").bind(WS, O),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_f68_o', ?, ?, 'owner', 'internal'), ('wm_f68_a', ?, ?, 'member', 'internal'), ('wm_f68_b', ?, ?, 'member', 'internal')").bind(WS, O, WS, A, WS, B),
  ]);
  bucketY = (await getOrCreateAssetBucket(e, Y, null)).id;
  bucketWs = (await getOrCreateAssetBucket(e, O, WS)).id;
  await seedFile(bucketY, 'dlv_f68_y', 'blb_f68_y', Y, 'workspace');
  await e.DB.batch([
    e.DB.prepare("INSERT INTO asset_collections (id, bucket_artifact_id, owner_id, name) VALUES ('col_f68_y', ?, ?, 'Pack')").bind(bucketY, Y),
    e.DB.prepare("INSERT INTO asset_collection_items (collection_id, deliverable_id) VALUES ('col_f68_y', 'dlv_f68_y')"),
  ]);
  await seedFile(bucketWs, 'dlv_f68_priv', 'blb_f68_priv', A, 'private');
  await seedFile(bucketWs, 'dlv_f68_team', 'blb_f68_team', A, 'team');
  await seedFile(bucketWs, 'dlv_f68_priv2', 'blb_f68_priv2', A, 'private');
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
const wsa = `/v1/workspaces/${WS}/assets`;
const vis = async (id: string) => (await e.DB.prepare('SELECT visibility FROM asset_deliverables WHERE id = ?').bind(id).first<{ visibility: string }>())?.visibility;

describe('f06 delete deliverable', () => {
  it("blocks: personal-scope user cannot strip another tenant's file from its collections", async () => {
    const res = await call(X, '/v1/assets/deliverables/dlv_f68_y', 'DELETE');
    expect(res?.status).toBe(404);
    const row = await e.DB.prepare("SELECT 1 AS n FROM asset_collection_items WHERE deliverable_id = 'dlv_f68_y'").first();
    expect(row).not.toBeNull();
  });
  it('still deletes own file and its collection items', async () => {
    const res = await call(Y, '/v1/assets/deliverables/dlv_f68_y', 'DELETE');
    expect(res?.status).toBe(200);
    expect(await e.DB.prepare("SELECT 1 AS n FROM asset_collection_items WHERE deliverable_id = 'dlv_f68_y'").first()).toBeNull();
  });
});

describe('f07 private/team file mutation', () => {
  it("blocks: member cannot widen, version, inspect or bundle another member's private file", async () => {
    expect((await call(B, `${wsa}/deliverables/dlv_f68_priv`, 'PATCH', { visibility: 'workspace' }))?.status).toBe(404);
    expect(await vis('dlv_f68_priv')).toBe('private');
    await e.DB.prepare("INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes) VALUES ('blb_f68_new', ?, 'n.txt', 'text/plain', 'k/new', 1)").bind(bucketWs).run();
    expect((await call(B, `${wsa}/deliverables/dlv_f68_priv/version`, 'POST', { blobId: 'blb_f68_new' }))?.status).toBe(404);
    expect((await call(B, `${wsa}/deliverables/dlv_f68_priv/usage`))?.status).toBe(404);
    expect((await call(B, `${wsa}/collections`, 'POST', { name: 'x', deliverableIds: ['dlv_f68_priv'] }))?.status).toBe(400);
    expect((await call(O, `${wsa}/deliverables/dlv_f68_priv`, 'PATCH', { visibility: 'workspace' }))?.status).toBe(404);
  });
  it("blocks: member cannot change visibility of a peer's team file; owner and admin can", async () => {
    expect((await call(B, `${wsa}/deliverables/dlv_f68_team`, 'PATCH', { visibility: 'workspace' }))?.status).toBe(403);
    expect(await vis('dlv_f68_team')).toBe('team');
    expect((await call(A, `${wsa}/deliverables/dlv_f68_team`, 'PATCH', { visibility: 'workspace' }))?.status).toBe(200);
    expect((await call(O, `${wsa}/deliverables/dlv_f68_team`, 'PATCH', { visibility: 'team' }))?.status).toBe(200);
  });
  it("still lets a member bundle a peer's team file and the owner bundle their private one", async () => {
    expect((await call(B, `${wsa}/collections`, 'POST', { name: 'x', deliverableIds: ['dlv_f68_team'] }))?.status).toBe(201);
    expect((await call(A, `${wsa}/collections`, 'POST', { name: 'x', deliverableIds: ['dlv_f68_priv2'] }))?.status).toBe(201);
    expect((await call(A, `${wsa}/deliverables/dlv_f68_priv2`, 'PATCH', { visibility: 'team' }))?.status).toBe(200);
  });
});

describe('f08 private file versions and bytes', () => {
  it("blocks: member cannot list versions or reach blob metadata/download-url of another member's private file", async () => {
    expect((await call(B, `${wsa}/deliverables/dlv_f68_priv/versions`))?.status).toBe(404);
    expect((await call(B, `${wsa}/blb_f68_priv`))?.status).toBe(404);
    expect((await call(B, `${wsa}/blb_f68_priv/download-url`))?.status).toBe(404);
    expect((await call(B, `${wsa}/blb_f68_priv/content`))?.status).toBe(404);
  });
  it('still serves the owner and team files', async () => {
    const v = await call(A, `${wsa}/deliverables/dlv_f68_priv/versions`);
    expect(v?.status).toBe(200);
    expect(((await v!.json()) as { versions: unknown[] }).versions).toHaveLength(1);
    expect((await call(A, `${wsa}/blb_f68_priv`))?.status).toBe(200);
    expect((await call(A, `${wsa}/blb_f68_priv/download-url`))?.status).toBe(200);
    expect((await call(B, `${wsa}/blb_f68_team/download-url`))?.status).toBe(200);
  });
});
