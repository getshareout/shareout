import { beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/email/gateway', () => ({ dispatchLifecycleEmail: vi.fn(async () => ({ sent: true })) }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { getOrCreateAssetBucket } from '../../../src/assets/bucket';
import { createCollection, createShareLink } from '../../../src/assets/deliverables';
import { handleDownloadPage } from '../../../src/serve/download-page';

const U = 'usr_dlpage';
const WS = 'wsp_dlpage';
const NAME = '</title><script>x()</script>';
let token = '';

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'u@dlpage.test', 'u')").bind(U),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id) VALUES (?, 'W', 'dlpage-w', ?)").bind(WS, U),
    e.DB.prepare("INSERT INTO workspace_members (id, workspace_id, user_id, role, member_class) VALUES ('wm_dlpage', ?, ?, 'owner', 'internal')").bind(WS, U),
  ]);
  const bucket = (await getOrCreateAssetBucket(e, U, WS)).id;
  await e.DB.batch([
    e.DB.prepare("INSERT INTO asset_deliverables (id, bucket_artifact_id, workspace_id, owner_id, name, visibility) VALUES ('dlv_dlpage', ?, ?, ?, 'Brief', 'team')").bind(bucket, WS, U),
    e.DB.prepare("INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes, deliverable_id, version_no) VALUES ('blb_dlpage', ?, 'brief.txt', 'text/plain', 'k/dlpage', 1, 'dlv_dlpage', 1)").bind(bucket),
  ]);
  const col = await createCollection(e, bucket, WS, U, NAME, ['dlv_dlpage']);
  token = (await createShareLink(e, col.id, U, { gate: 'none' })).url.split('/d/')[1];
});

describe('delivery download page', () => {
  it('renders the collection name as text in the title and heading', async () => {
    const res = await handleDownloadPage(token, e, new Request(`https://shareout.test/d/${token}`));
    const html = await res.text();
    expect(html).toContain('<title>&lt;/title&gt;&lt;script&gt;x()&lt;/script&gt; — ShareOut</title>');
    expect(html).toContain('<h1 class="dl-title">&lt;/title&gt;&lt;script&gt;x()&lt;/script&gt;</h1>');
    expect(html).toContain('Brief');
    expect(html).not.toContain('<script>x()</script>');
  });
});
