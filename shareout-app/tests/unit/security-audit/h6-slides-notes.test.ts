import { beforeAll, describe, expect, it } from 'vitest';
import { handleSlides } from '../../../src/data/slides/handler';
import type { DataContext } from '../../../src/data/middleware';
import { createSessionToken } from '../../../src/token';
import { applyMigrations, e } from '../helpers/migrated-db';

const A = 'art_h6_notes_a';
const B = 'art_h6_notes_b';
const PRES_A = 'pres_' + 'd'.repeat(24);
const PRES_B = 'pres_' + 'e'.repeat(24);
const SLIDE_A = 'slide_' + '3'.repeat(24);
const SLIDE_B = 'slide_' + '4'.repeat(24);
const owner = { id: 'usr_h6n_owner', email: 'h6nowner@x.test' };
const editor = { id: 'usr_h6n_editor', email: 'h6neditor@x.test' };
const viewer = { id: 'usr_h6n_viewer', email: 'h6nviewer@x.test' };

beforeAll(async () => {
  await applyMigrations();
  (e as { SESSION_SECRET?: string }).SESSION_SECRET ||= 'test-session-secret-h6n';
  const now = new Date().toISOString();
  await e.DB.batch([
    ...[owner, editor, viewer].map((u) => e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(u.id, u.email)),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, 'public')").bind(A, A, `s-${A}`, owner.id),
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility) VALUES (?, ?, ?, ?, 'public')").bind(B, B, `s-${B}`, owner.id),
    e.DB.prepare("INSERT INTO collaborators (id, artifact_id, email, role) VALUES ('col_h6n1', ?, ?, 'editor')").bind(A, editor.email),
    e.DB.prepare("INSERT INTO presentations (id, artifact_id, title, visibility) VALUES (?, ?, 'A', 'public')").bind(PRES_A, A),
    e.DB.prepare("INSERT INTO presentations (id, artifact_id, title, visibility) VALUES (?, ?, 'B', 'public')").bind(PRES_B, A),
    e.DB.prepare('INSERT INTO slides (id, presentation_id, position, content, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)').bind(SLIDE_A, PRES_A, 'a', now, now),
    e.DB.prepare('INSERT INTO slides (id, presentation_id, position, content, created_at, updated_at) VALUES (?, ?, 0, ?, ?, ?)').bind(SLIDE_B, PRES_B, 'b', now, now),
    e.DB.prepare("INSERT INTO slide_notes (id, slide_id, content) VALUES ('note_h6n1', ?, 'SECRET TALKING POINTS')").bind(SLIDE_A),
    e.DB.prepare("INSERT INTO slide_notes (id, slide_id, content) VALUES ('note_h6n2', ?, 'OTHER DECK NOTES')").bind(SLIDE_B),
    e.DB.prepare(`INSERT INTO presentation_versions (id, presentation_id, name, snapshot, slide_count, created_at)
      VALUES ('ver_aaaaaaaaaaaaaaaaaaaaaaaa', ?, 'v', ?, 1, ?)`).bind(PRES_A, JSON.stringify([{ id: SLIDE_A, content: 'a', notes: 'SECRET TALKING POINTS' }]), now),
  ]);
});

async function call(user: { id: string; email: string } | null, method: string, path: string, body?: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (user) headers.Cookie = `shareout_session=${await createSessionToken(user.id, user.email, e)}`;
  const request = new Request(`https://so.test/v1/data/${A}/slides/${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const ctx = {
    artifactId: A,
    artifact: { id: A, name: A, visibility: 'public', auth_method: null, owner_id: owner.id },
    env: e,
    origin: 'https://so.test',
  } as unknown as DataContext;
  return handleSlides(request, ctx, `/${path}`);
}

describe('h6 speaker notes are editor-only', () => {
  it('blocks: viewers and anonymous cannot read notes via the notes route, getSlide or version snapshots', async () => {
    for (const who of [null, viewer]) {
      expect((await call(who, 'GET', `${PRES_A}/slides/${SLIDE_A}/notes`)).status).toBe(403);
      const slide = await (await call(who, 'GET', `${PRES_A}/slides/${SLIDE_A}`)).text();
      expect(slide).not.toContain('SECRET TALKING POINTS');
      const list = await (await call(who, 'GET', `${PRES_A}/slides`)).text();
      expect(list).not.toContain('SECRET TALKING POINTS');
      const ver = await (await call(who, 'GET', `${PRES_A}/versions/ver_aaaaaaaaaaaaaaaaaaaaaaaa`)).text();
      expect(ver).not.toContain('SECRET TALKING POINTS');
      expect(ver).toContain('"content":"a"');
    }
  });

  it('owners and editors (the presenters) still get notes', async () => {
    for (const who of [owner, editor]) {
      const n = await call(who, 'GET', `${PRES_A}/slides/${SLIDE_A}/notes`);
      expect(n.status).toBe(200);
      expect(await n.json()).toMatchObject({ data: { notes: 'SECRET TALKING POINTS' } });
      expect(await (await call(who, 'GET', `${PRES_A}/slides/${SLIDE_A}`)).text()).toContain('SECRET TALKING POINTS');
      expect(await (await call(who, 'GET', `${PRES_A}/versions/ver_aaaaaaaaaaaaaaaaaaaaaaaa`)).text()).toContain('SECRET TALKING POINTS');
    }
  });

  it('blocks: a slide of another presentation cannot be addressed through this one (notes, lock, unlock, owner)', async () => {
    expect((await call(owner, 'GET', `${PRES_A}/slides/${SLIDE_B}/notes`)).status).toBe(404);
    expect((await call(owner, 'PUT', `${PRES_A}/slides/${SLIDE_B}/notes`, { content: 'x' })).status).toBe(404);
    expect((await call(owner, 'POST', `${PRES_A}/slides/${SLIDE_B}/lock`)).status).toBe(404);
    expect((await call(owner, 'POST', `${PRES_A}/slides/${SLIDE_B}/unlock`)).status).toBe(404);
    expect((await call(owner, 'PUT', `${PRES_A}/slides/${SLIDE_B}/owner`, { userId: owner.id })).status).toBe(404);
    const n = await e.DB.prepare('SELECT content FROM slide_notes WHERE slide_id = ?').bind(SLIDE_B).first<{ content: string }>();
    expect(n?.content).toBe('OTHER DECK NOTES');
  });
});
