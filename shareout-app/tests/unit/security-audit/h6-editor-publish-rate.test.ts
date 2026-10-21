import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { RATE_LIMIT_MAX } from '../../../src/api-auth';
import { handlePublish } from '../../../src/editor/draft';
import { handleSourceEditor } from '../../../src/editor/source/index';
import type { EditorContext } from '../../../src/editor/index';

const OWNER = 'usr_h6pr_o';
const HTML = 'art_h6pr_html';
const MD = 'art_h6pr_md';

const ctx = (artifactId: string): EditorContext => ({ artifactId, userId: OWNER, userName: 'o', role: 'editor', env: e });
const post = (body: unknown) => new Request('https://so.test/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const count = async () => (await e.DB.prepare("SELECT COALESCE(SUM(count),0) AS c FROM rate_limits WHERE principal_id = ? AND action = 'publish'")
  .bind(OWNER).first<{ c: number }>())?.c;

beforeAll(async () => {
  await applyMigrations();
  const seed = (id: string, type: string) => [
    e.DB.prepare('INSERT INTO artifacts (id, name, slug, owner_id, visibility, artifact_type) VALUES (?, ?, ?, ?, ?, ?)').bind(id, id, `s-${id}`, OWNER, 'private', type),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, ?, '{}')").bind(`ver_${id}`, id, type === 'markdown' ? 'index.md' : 'index.html'),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${id}`, id, `ver_${id}`, `s-${id}`),
  ];
  await e.DB.batch([e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(OWNER, 'h6pr@x.test'), ...seed(HTML, 'html'), ...seed(MD, 'markdown')]);
});

describe('h6 editor publish shares the publish rate limit', () => {
  it('counts editor publishes against the shared counter and blocks once the limit is reached', async () => {
    expect((await handlePublish(post({ html: '<p>1</p>' }), ctx(HTML))).status).toBe(200);
    expect((await handleSourceEditor(post({ content: '# 1' }), ctx(MD), 'publish')).status).toBe(200);
    expect(await count()).toBe(2);

    await e.DB.prepare("UPDATE rate_limits SET count = ? WHERE principal_id = ? AND action = 'publish'").bind(RATE_LIMIT_MAX, OWNER).run();
    const a = await handlePublish(post({ html: '<p>2</p>' }), ctx(HTML));
    expect(a.status).toBe(429);
    expect(await a.json()).toMatchObject({ code: 'RATE_LIMIT_EXCEEDED' });
    expect((await handleSourceEditor(post({ content: '# 2' }), ctx(MD), 'publish')).status).toBe(429);
    const v = await e.DB.prepare('SELECT COUNT(*) AS c FROM versions WHERE artifact_id IN (?, ?)').bind(HTML, MD).first<{ c: number }>();
    expect(v?.c).toBe(4);
  });
});
