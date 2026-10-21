import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleUpload } from '../../../src/editor/draft';
import type { EditorContext } from '../../../src/editor/index';

const OWNER = 'usr_h6up_o';
const ART = 'art_h6up';

const ctx: EditorContext = { artifactId: ART, userId: OWNER, userName: 'o', role: 'editor', env: e };
const upload = (size: number) => {
  const form = new FormData();
  form.set('file', new File([new Uint8Array(size)], 'a.png', { type: 'image/png' }));
  return new Request('https://so.test/x', { method: 'POST', body: form });
};

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(OWNER, 'h6up@x.test'),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, 'private')").bind(ART, ART, `s-${ART}`, OWNER),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES ('ver_h6up', ?, 1, 'index.html', '{}')").bind(ART),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES ('ast_h6up', 'ver_h6up', 'index.html', 'k', 'text/html', 900, 'h')"),
  ]);
});

describe('h6 editor upload honours the owner storage quota', () => {
  it('blocks: an upload that would exceed the quota is refused; one that fits still works', async () => {
    const env = { ...e, STORAGE_QUOTA_BYTES: '1000' } as typeof e;
    const over = await handleUpload(upload(500), { ...ctx, env });
    expect(over.status).toBe(413);
    const fits = await handleUpload(upload(50), { ...ctx, env });
    expect(fits.status).toBe(200);
    expect((await handleUpload(upload(500), ctx)).status).toBe(200);
  });
});
