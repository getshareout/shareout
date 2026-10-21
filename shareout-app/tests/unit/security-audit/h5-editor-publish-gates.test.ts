import { beforeAll, describe, expect, it, vi } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';

const check = vi.hoisted(() => vi.fn());
vi.mock('../../../src/moderation/check', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  runPublishSafetyCheck: check,
}));

import { handlePublish } from '../../../src/editor/draft';
import { handleSourceEditor } from '../../../src/editor/source/index';
import type { EditorContext } from '../../../src/editor/index';

const OWNER = 'usr_h5pg_o';
const WS = 'wsp_h5pg';
const PUB = 'art_h5pg_pub';
const GOV = 'art_h5pg_gov';
const MD = 'art_h5pg_md';

const ctx = (artifactId: string): EditorContext => ({
  artifactId, userId: OWNER, userName: 'o', role: 'editor', env: e,
});
const post = (body: unknown) => new Request('https://so.test/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const vis = async (id: string) =>
  (await e.DB.prepare('SELECT visibility FROM artifacts WHERE id = ?').bind(id).first<{ visibility: string }>())?.visibility;

beforeAll(async () => {
  await applyMigrations();
  const seedArt = (id: string, type: string, visibility: string, ws: string | null) => [
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, artifact_type, workspace_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, id, `s-${id}`, OWNER, visibility, type, ws),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, '{}')")
      .bind(`ver_${id}`, id, type === 'markdown' ? 'index.md' : 'index.html'),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)")
      .bind(`dep_${id}`, id, `ver_${id}`, `s-${id}`),
  ];
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(OWNER, 'h5pg@x.test'),
    e.DB.prepare("INSERT INTO workspaces (id, name, slug, owner_id, public_publish_policy) VALUES (?, 'W', 'w-h5pg', ?, 'require_approval')").bind(WS, OWNER),
    ...seedArt(PUB, 'html', 'public', null),
    ...seedArt(GOV, 'html', 'public', WS),
    ...seedArt(MD, 'markdown', 'public', null),
  ]);
});

describe('h5 editor publish keeps the publish gates', () => {
  it('blocks: a public artifact edited in the editor is moderated and held private', async () => {
    check.mockReset().mockResolvedValue({ verdict: 'malicious', status: 'blocked', reason: 'phish', contentHash: 'h' });
    const res = await handlePublish(post({ html: '<html>login to your bank</html>' }), ctx(PUB));
    expect(res.status).toBe(200);
    expect(check).toHaveBeenCalledTimes(1);
    expect(await vis(PUB)).toBe('private');
  });

  it('blocks: workspace require_approval is not bypassed by publishing new content from the editor', async () => {
    check.mockReset().mockResolvedValue({ verdict: 'clean', status: 'approved', reason: '', contentHash: 'h2' });
    const res = await handlePublish(post({ html: '<html>unapproved change</html>' }), ctx(GOV));
    expect(res.status).toBe(200);
    expect(await vis(GOV)).toBe('workspace');
  });

  it('blocks: the source editor moderates a public artifact too', async () => {
    check.mockReset().mockResolvedValue({ verdict: 'malicious', status: 'blocked', reason: 'phish', contentHash: 'h3' });
    const res = await handleSourceEditor(post({ content: '# hi' }), ctx(MD), 'publish');
    expect(res.status).toBe(200);
    expect(await vis(MD)).toBe('private');
  });

  it('a clean publish on a public artifact stays public', async () => {
    await e.DB.prepare("UPDATE artifacts SET visibility = 'public' WHERE id = ?").bind(PUB).run();
    check.mockReset().mockResolvedValue({ verdict: 'clean', status: 'approved', reason: '', contentHash: 'h4' });
    const res = await handlePublish(post({ html: '<html>fine</html>' }), ctx(PUB));
    expect(res.status).toBe(200);
    expect(await vis(PUB)).toBe('public');
  });
});
