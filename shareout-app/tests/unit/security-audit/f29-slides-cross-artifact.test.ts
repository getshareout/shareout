import { beforeAll, describe, expect, it } from 'vitest';
import { handleSlides } from '../../../src/data/slides/handler';
import type { DataContext } from '../../../src/data/middleware';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const A = 'art_f29_a';
const B = 'art_f29_b';
const PRES_B = 'pres_' + 'b'.repeat(24);
const PRES_A = 'pres_' + 'a'.repeat(24);
const u1 = { id: 'usr_f29_1', email: 'f29u1@x.test' };
const u2 = { id: 'usr_f29_2', email: 'f29u2@x.test' };

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-f29';
  const now = new Date().toISOString();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(u1.id, u1.email),
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(u2.id, u2.email),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, 'private')").bind(A, A, `s-${A}`, u1.id),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, 'public')").bind(B, B, `s-${B}`, u2.id),
    e.DB.prepare("INSERT INTO presentations (id, artifact_id, title, visibility) VALUES (?, ?, 'B deck', 'public')").bind(PRES_B, B),
    e.DB.prepare("INSERT INTO presentations (id, artifact_id, title, visibility) VALUES (?, ?, 'A deck', 'private')").bind(PRES_A, A),
    e.DB.prepare('INSERT INTO slides (id, presentation_id, position, content, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)')
      .bind('slide_' + '1'.repeat(24), PRES_B, 'secret B slide', now, now),
    e.DB.prepare('INSERT INTO slides (id, presentation_id, position, content, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)')
      .bind('slide_' + '2'.repeat(24), PRES_A, 'A slide', now, now),
  ]);
});

async function asU1(method: string, path: string, body?: unknown) {
  const token = await createSessionToken(u1.id, u1.email, e);
  const request = new Request(`https://so.test/v1/data/${A}/slides/${path}`, {
    method,
    headers: { Cookie: `shareout_session=${token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ctx = {
    artifactId: A,
    artifact: { id: A, name: A, visibility: 'private', auth_method: null, owner_id: u1.id },
    env: e,
    origin: 'https://so.test',
  } as unknown as DataContext;
  return handleSlides(request, ctx, `/${path}`);
}

describe('f29 slides bind presentations to the URL artifact', () => {
  it('blocks: the owner of A cannot replace, flip or read analytics of B\'s presentation', async () => {
    const replace = await asU1('POST', `${PRES_B}/slides`, { replace: true, slides: [{ content: 'pwned' }] });
    expect(replace.status).toBe(404);
    const vis = await asU1('PUT', `${PRES_B}/publish/visibility`, { visibility: 'private' });
    expect(vis.status).toBe(404);
    const unpub = await asU1('POST', `${PRES_B}/publish/unpublish`);
    expect(unpub.status).toBe(404);
    const analytics = await asU1('GET', `${PRES_B}/analytics`);
    expect(analytics.status).toBe(404);

    const rows = await e.DB.prepare('SELECT content FROM slides WHERE presentation_id = ?').bind(PRES_B).all<{ content: string }>();
    expect(rows.results.map((r) => r.content)).toEqual(['secret B slide']);
    const pres = await e.DB.prepare('SELECT visibility FROM presentations WHERE id = ?').bind(PRES_B).first<{ visibility: string }>();
    expect(pres?.visibility).toBe('public');
  });

  it('the owner of A can still use A\'s own presentation', async () => {
    const res = await asU1('POST', `${PRES_A}/slides`, { slides: [{ content: 'second' }] });
    expect(res.status).toBeLessThan(300);
    const vis = await asU1('PUT', `${PRES_A}/publish/visibility`, { visibility: 'public' });
    expect(vis.status).toBe(200);
  });
});
