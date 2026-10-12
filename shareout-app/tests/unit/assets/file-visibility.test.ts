// Recursos default (C9): a file uploaded into a workspace library is team-only unless the
// uploader explicitly picks a public link. Existing rows are never touched. Runs the real
// asset router against the migrated schema.
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const validateToken = vi.hoisted(() => vi.fn());
const getSessionUser = vi.hoisted(() => vi.fn());
vi.mock('../../../src/api-auth', async (orig) => ({ ...(await orig<object>()), validateToken }));
vi.mock('../../../src/auth/session', async (orig) => ({ ...(await orig<object>()), getSessionUser }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { routeAssetApi } from '../../../src/router/api/assets';
import { createFetchContext } from '../../../src/router/context';
import { getOrCreateAssetBucket } from '../../../src/assets/bucket';

const U = 'usr_vis';
const WS = 'wsp_vis';
let n = 0;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(U, 'vis@example.com', 'Vis'),
    e.DB.prepare('INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, ?, ?, ?)').bind(WS, 'Vis', 'vis-ws', U),
    e.DB.prepare("INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, 'member')").bind(WS, U),
  ]);
});

beforeEach(() => {
  validateToken.mockReset().mockResolvedValue(null);
  getSessionUser.mockReset().mockResolvedValue({ id: U, email: 'vis@example.com' });
});

async function blobIn(ws: string | null): Promise<string> {
  const bucket = await getOrCreateAssetBucket(e, U, ws);
  const id = `blob_vis_${++n}`;
  await e.DB.prepare('INSERT INTO blobs (id, artifact_id, filename, mime_type, size_bytes, r2_key) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, bucket.id, 'plano.pdf', 'application/pdf', 10, `k/${id}`).run();
  return id;
}

const call = (path: string, method: string, body?: unknown) =>
  routeAssetApi(createFetchContext(new Request(`https://shareout.site${path}`, {
    method, headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
  }), e));

const stored = async (id: string) =>
  (await e.DB.prepare('SELECT visibility FROM asset_deliverables WHERE id = ?').bind(id).first<{ visibility: string }>())?.visibility;

describe('new file visibility', () => {
  it('a workspace upload with no choice is team-only', async () => {
    const res = await call(`/v1/workspaces/${WS}/assets/deliverables`, 'POST', { blobId: await blobIn(WS), name: 'Plano' });
    expect(res?.status).toBe(201);
    const j = await res!.json() as { id: string; visibility: string };
    expect(j.visibility).toBe('team');
    expect(await stored(j.id)).toBe('team');
  });

  it('honours an explicit choice and rejects unknown values', async () => {
    for (const v of ['workspace', 'private', 'team']) {
      const res = await call(`/v1/workspaces/${WS}/assets/deliverables`, 'POST', { blobId: await blobIn(WS), name: v, visibility: v });
      expect(await stored(((await res!.json()) as { id: string }).id)).toBe(v);
    }
    const bad = await call(`/v1/workspaces/${WS}/assets/deliverables`, 'POST', { blobId: await blobIn(WS), visibility: 'public' });
    expect(bad?.status).toBe(400);
  });

  it('personal library keeps the link-shareable default', async () => {
    const res = await call('/v1/assets/deliverables', 'POST', { blobId: await blobIn(null), name: 'Mine' });
    expect(await stored(((await res!.json()) as { id: string }).id)).toBe('workspace');
  });

  it('PATCH can switch a file to team; existing rows keep their stored value', async () => {
    const res = await call(`/v1/workspaces/${WS}/assets/deliverables`, 'POST', { blobId: await blobIn(WS), name: 'Old', visibility: 'workspace' });
    const { id } = await res!.json() as { id: string };
    expect(await stored(id)).toBe('workspace');
    expect((await call(`/v1/workspaces/${WS}/assets/deliverables/${id}`, 'PATCH', { visibility: 'team' }))?.status).toBe(200);
    expect(await stored(id)).toBe('team');
    expect((await call(`/v1/workspaces/${WS}/assets/deliverables/${id}`, 'PATCH', { visibility: 'nope' }))?.status).toBe(400);
  });
});
