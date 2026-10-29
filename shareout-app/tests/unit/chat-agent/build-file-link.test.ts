// A confirmed build links its source file only when the file is in one of the caller's
// own buckets, and list_files only names linked pages the caller can see.
import { beforeAll, describe, expect, it, vi } from 'vitest';

let n = 0;
vi.mock('../../../src/data/agent/build-page', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateArtifactHtml: async () => '<!doctype html><html><body>generated page body</body></html>',
}));
vi.mock('../../../src/publish/publish-generated-html', () => ({
  publishGeneratedHtml: async (env: import('../../../src/types').Env, user: { id: string }) => {
    const id = `art_bfl_pub_${++n}`;
    await env.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility) VALUES (?, ?, 'Built', ?, 'private')").bind(id, user.id, `bfl-pub-${n}`).run();
    return { artifact: { id }, deployment: { url: 'https://x.test/a/x', slug: 'x', subdomain_url: null } };
  },
}));
vi.mock('../../../src/api-auth', async (orig) => ({
  ...(await orig<object>()),
  checkRateLimit: async () => ({ allowed: true }),
  incrementRateLimit: async () => {},
}));
vi.mock('../../../src/quota', () => ({ checkStorageQuota: async () => ({ allowed: true }) }));

import { applyMigrations, e } from '../helpers/migrated-db';
import { executeBuildArtifact } from '../../../src/chat-agent/actions';
import { getOrCreateAssetBucket } from '../../../src/assets/bucket';
import { listFilesTool } from '../../../src/chat-agent/tools/files';

const links = async (blobId: string) =>
  (await e.DB.prepare('SELECT artifact_id FROM blob_artifact_links WHERE blob_id = ?').bind(blobId).all()).results.length;

beforeAll(async () => {
  await applyMigrations();
  await e.DB.prepare("INSERT INTO users (id, email, name) VALUES ('usr_bfl_a', 'a@example.com', 'a'), ('usr_bfl_b', 'b@example.com', 'b')").run();
  const a = await getOrCreateAssetBucket(e, 'usr_bfl_a', null);
  const b = await getOrCreateAssetBucket(e, 'usr_bfl_b', null);
  await e.DB.batch([
    e.DB.prepare("INSERT INTO blobs (id, artifact_id, filename, mime_type, r2_key, size_bytes) VALUES ('blb_bfl_a', ?, 'a.csv', 'text/csv', 'k/a', 1), ('blb_bfl_b', ?, 'b.csv', 'text/csv', 'k/b', 1)")
      .bind(a.id, b.id),
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility) VALUES ('art_bfl_priv', 'usr_bfl_b', 'Hidden page', 'bfl-priv', 'private')"),
    e.DB.prepare("INSERT INTO blob_artifact_links (blob_id, artifact_id, created_at) VALUES ('blb_bfl_a', 'art_bfl_priv', '2026-01-01T00:00:00Z')"),
  ]);
});

describe('build_artifact source file', () => {
  it('links a file from the caller’s own bucket', async () => {
    const res = await executeBuildArtifact(e, 'usr_bfl_a', { kind: 'build_artifact', name: 'P', prompt: 'p', source_file_id: 'blb_bfl_a' });
    expect(res.artifactId).toBeTruthy();
    expect(await links('blb_bfl_a')).toBe(2);
  });

  it('does not link a file from another user’s bucket', async () => {
    const res = await executeBuildArtifact(e, 'usr_bfl_a', { kind: 'build_artifact', name: 'P', prompt: 'p', source_file_id: 'blb_bfl_b' });
    expect(res.artifactId).toBeTruthy();
    expect(await links('blb_bfl_b')).toBe(0);
  });
});

describe('list_files used-for', () => {
  it('does not name another user’s private page', async () => {
    const out = await listFilesTool.execute({ env: e, userId: 'usr_bfl_a', selectedWorkspaceId: null }, {}) as { files: Array<{ file_id: string; usedForArtifacts: string | null }> };
    const used = out.files.find((f) => f.file_id === 'blb_bfl_a')?.usedForArtifacts ?? '';
    expect(used).not.toContain('Hidden page');
    expect(used).toContain('Built');
  });
});
