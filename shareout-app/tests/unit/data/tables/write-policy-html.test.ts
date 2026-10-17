// Per-table write roles declared in the published page's shareout/manifest are enforced
// on the data API: viewers cannot write a restricted table, writers the author allowed
// still can, and an unreadable declaration fails closed.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../../helpers/migrated-db';
import { handleFetch } from '../../../../src/router/handle-fetch';
import { createSessionToken } from '../../../../src/token';
import { denyTableWrite, tableWriteRoleFromHtml } from '../../../../src/data/tables/write-policy';
import type { DataContext } from '../../../../src/data/middleware';

const OWNER = 'usr_twp_owner';
const ART = 'art_twp_public';
const BROKEN = 'art_twp_broken';
const MISSING = 'art_twp_missing';

const page = (manifest: string) => `<!doctype html><html><head><script type="shareout/manifest">${manifest}</script></head><body></body></html>`;
const MANIFEST = JSON.stringify({
  version: '2.0',
  sources: { tables: { approvals: { schema: [], write: 'owner' }, reviews: { schema: [], write: 'collaborator' }, notes: { schema: [] } } },
});

async function seedArtifact(id: string, html: string | null) {
  const ver = `ver_${id}`;
  await e.DB.batch([
    e.DB.prepare("INSERT INTO artifacts (id, owner_id, name, slug, visibility, allow_anon_write) VALUES (?, ?, 'T', ?, 'public', 1)").bind(id, OWNER, id),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json) VALUES (?, ?, 1, 'index.html', ?)")
      .bind(ver, id, JSON.stringify({ version: 2, entrypoint: 'index.html', assets: [] })),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug) VALUES (?, ?, ?, 'production', ?)").bind(`dep_${id}`, id, ver, id),
    e.DB.prepare("INSERT INTO assets (id, version_id, path, r2_key, mime, size_bytes, sha256) VALUES (?, ?, 'index.html', ?, 'text/html', 1, 'x')").bind(`ast_${id}`, ver, `${id}/v1/index.html`),
  ]);
  if (html !== null) await e.ARTIFACTS.put(`${id}/v1/index.html`, html);
}

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret';
  await e.DB.prepare("INSERT INTO users (id, email, name) VALUES (?, 'owner@example.com', 'o')").bind(OWNER).run();
  await seedArtifact(ART, page(MANIFEST));
  await seedArtifact(BROKEN, page('{ not json'));
  await seedArtifact(MISSING, null);
});

const post = (artifactId: string, table: string, cookie?: string) =>
  handleFetch(new Request(`https://shareout.test/v1/data/${artifactId}/tables/${table}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: `shareout_session=${cookie}` } : {}) },
    body: JSON.stringify({ rows: [{ text: 'x' }] }),
  }), e);

describe('tableWriteRoleFromHtml', () => {
  it('reads declared roles, defaults undeclared tables to any, fails closed on bad declarations', () => {
    expect(tableWriteRoleFromHtml(page(MANIFEST), 'approvals')).toBe('owner');
    expect(tableWriteRoleFromHtml(page(MANIFEST), 'reviews')).toBe('collaborator');
    expect(tableWriteRoleFromHtml(page(MANIFEST), 'notes')).toBe('any');
    expect(tableWriteRoleFromHtml('<html></html>', 'approvals')).toBe('any');
    expect(tableWriteRoleFromHtml(page('{ nope'), 'approvals')).toBe('owner');
    expect(tableWriteRoleFromHtml(page(JSON.stringify({ sources: { tables: { approvals: { write: 'admins' } } } })), 'approvals')).toBe('owner');
  });
});

describe('table writes through the data API', () => {
  it('refuses an anonymous viewer on a table restricted to the owner', async () => {
    const res = await post(ART, 'approvals');
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).toMatch(/TABLE_WRITE_FORBIDDEN/);
  });

  it('refuses an anonymous viewer on a collaborator-only table', async () => {
    expect((await post(ART, 'reviews')).status).toBe(403);
  });

  it('still lets an anonymous viewer write a table the author left open', async () => {
    const res = await post(ART, 'notes');
    expect(res.status).toBeLessThan(300);
  });

  it('lets the owner write the restricted table', async () => {
    const token = await createSessionToken(OWNER, 'owner@example.com', e);
    const res = await post(ART, 'approvals', token);
    expect(res.status).toBeLessThan(300);
  });

  it('fails closed when the declaration does not parse or the page cannot be read', async () => {
    expect((await post(BROKEN, 'approvals')).status).toBe(403);
    expect((await post(MISSING, 'notes')).status).toBe(403);
  });
});

describe('denyTableWrite', () => {
  const ctx = (artifactId: string, isOwner: boolean, isArtifactOwner: boolean) =>
    ({ env: e, artifactId, origin: null, isOwner, isArtifactOwner } as unknown as DataContext);

  it('lets an editor write a collaborator table but not an owner-only one', async () => {
    expect(await denyTableWrite(ctx(ART, true, false), 'reviews')).toBeNull();
    expect((await denyTableWrite(ctx(ART, true, false), 'approvals'))?.code).toBe('TABLE_WRITE_FORBIDDEN');
  });

  it('keeps the owner able to write when the page cannot be read', async () => {
    expect(await denyTableWrite(ctx(MISSING, true, true), 'notes')).toBeNull();
  });
});
