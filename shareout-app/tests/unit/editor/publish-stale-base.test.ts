// Publishing a draft started before someone else published must not silently revert
// their change: the editor sends the live page it started from (baseLiveAt) and the
// server answers 409 STALE_BASE, naming the version that went live, who and when.
import { beforeAll, describe, expect, it } from 'vitest';
import { applyMigrations, e } from '../helpers/migrated-db';
import { handleDraft, handlePublish, parseBaseLiveAt } from '../../../src/editor/draft';
import { handleEditor, type EditorContext } from '../../../src/editor/index';
import { handleSourceEditor } from '../../../src/editor/source/index';

const ME = 'usr_stale_me';
const ANA = 'usr_stale_ana';
const T0 = '2026-01-01T00:00:00.000Z';
const T1 = '2026-01-02T00:00:00.000Z';

const ctx = (artifactId: string, userId = ME): EditorContext => ({
  artifactId, userId, userName: 'me', role: 'editor', env: e,
});
const post = (body: unknown) => new Request('https://so.test/x', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const versions = async (id: string) =>
  (await e.DB.prepare('SELECT COUNT(*) AS n FROM versions WHERE artifact_id = ?').bind(id).first<{ n: number }>())!.n;
const draftRow = async (id: string) =>
  (await e.DB.prepare('SELECT created_at, base_live_at FROM artifact_drafts WHERE artifact_id = ? AND user_id = ?').bind(id, ME).first<{ created_at: string; base_live_at: string | null }>())!;
const load = async (id: string) =>
  ((await (await handleEditor(new Request('https://so.test/x'), ctx(id), '')).json()) as { editor: { baseLiveAt?: string } }).editor;

/** v1 live since T0, then Ana publishes v2 at T1 unless `ana` is false. */
async function seed(id: string, type = 'html', ana = true) {
  const entry = type === 'markdown' ? 'index.md' : 'index.html';
  await e.DB.batch([
    e.DB.prepare("INSERT INTO artifacts (id, name, slug, owner_id, visibility, artifact_type) VALUES (?, ?, ?, ?, 'private', ?)")
      .bind(id, id, `s-${id}`, ME, type),
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_at, created_by) VALUES (?, ?, 1, ?, '{}', ?, ?)")
      .bind(`ver1_${id}`, id, entry, T0, ME),
    e.DB.prepare("INSERT INTO deployments (id, artifact_id, version_id, channel, slug, updated_at) VALUES (?, ?, ?, 'production', ?, ?)")
      .bind(`dep_${id}`, id, `ver1_${id}`, `s-${id}`, T0),
  ]);
  if (!ana) return;
  await e.DB.batch([
    e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_at, created_by, source) VALUES (?, ?, 2, ?, '{}', ?, ?, 'api')")
      .bind(`ver2_${id}`, id, entry, T1, ANA),
    e.DB.prepare('UPDATE deployments SET version_id = ?, updated_at = ? WHERE artifact_id = ?').bind(`ver2_${id}`, T1, id),
  ]);
}

beforeAll(async () => {
  await applyMigrations();
  await e.DB.batch([
    e.DB.prepare('INSERT INTO users (id, email) VALUES (?, ?)').bind(ME, 'me@stale.test'),
    e.DB.prepare('INSERT INTO users (id, email, name) VALUES (?, ?, ?)').bind(ANA, 'ana@stale.test', 'Ana'),
  ]);
});

describe('editor publish refuses an out-of-date base', () => {
  it('409 STALE_BASE names the live version, who and when, and publishes nothing', async () => {
    await seed('art_stale_a');
    const res = await handlePublish(post({ html: '<p>mine</p>', baseLiveAt: T0 }), ctx('art_stale_a'));
    expect(res.status).toBe(409);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toMatchObject({
      success: false,
      code: 'STALE_BASE',
      live: { versionNo: 2, updatedAt: T1, by: 'Ana', byYou: false, source: 'api' },
      baseVersionNo: 1,
    });
    expect(await versions('art_stale_a')).toBe(2);
  });

  it('publishes when the base is current, and returns the new live timestamp', async () => {
    await seed('art_stale_b');
    const res = await handlePublish(post({ html: '<p>mine</p>', baseLiveAt: T1 }), ctx('art_stale_b'));
    expect(res.status).toBe(200);
    const body = await res.json() as { versionNo: number; liveUpdatedAt: string };
    expect(body.versionNo).toBe(3);
    expect(Date.parse(body.liveUpdatedAt)).toBeGreaterThan(Date.parse(T1));
  });

  it('"Publish anyway" omits the base and goes through', async () => {
    await seed('art_stale_c');
    const res = await handlePublish(post({ html: '<p>mine</p>' }), ctx('art_stale_c'));
    expect(res.status).toBe(200);
    expect(await versions('art_stale_c')).toBe(3);
  });

  it('the source (Markdown) publish applies the same check', async () => {
    await seed('art_stale_md', 'markdown');
    const res = await handleSourceEditor(post({ content: '# mine', baseLiveAt: T0 }), ctx('art_stale_md'), 'publish');
    expect(res.status).toBe(409);
    expect(((await res.json()) as { code: string }).code).toBe('STALE_BASE');
    expect(await versions('art_stale_md')).toBe(2);
  });
});

describe('the base an edit starts from', () => {
  it('with no draft, the editor load reports the live timestamp', async () => {
    await seed('art_base_a', 'html', false);
    expect((await load('art_base_a')).baseLiveAt).toBe(T0);
  });

  it('a new draft keeps the base it was opened on, so a later reload still catches the stale publish', async () => {
    await seed('art_base_b', 'html', false);
    // Opened at T0; Ana publishes before the first autosave lands.
    await e.DB.batch([
      e.DB.prepare("INSERT INTO versions (id, artifact_id, version_no, entrypoint, manifest_json, created_at, created_by) VALUES ('ver2_base_b', 'art_base_b', 2, 'index.html', '{}', ?, ?)").bind(T1, ANA),
      e.DB.prepare("UPDATE deployments SET version_id = 'ver2_base_b', updated_at = ? WHERE artifact_id = 'art_base_b'").bind(T1),
    ]);
    expect((await handleDraft(post({ html: '<p>a</p>', baseLiveAt: T0 }), ctx('art_base_b'), 'POST')).status).toBe(200);
    expect((await handleDraft(post({ html: '<p>b</p>', baseLiveAt: T1 }), ctx('art_base_b'), 'POST')).status).toBe(200);
    const row = await draftRow('art_base_b');
    expect(row.base_live_at).toBe(T0);
    expect(Date.parse(row.created_at)).toBeGreaterThan(Date.parse(T1)); // still the real creation time
    const base = (await load('art_base_b')).baseLiveAt!;
    expect(base).toBe(T0);
    const res = await handlePublish(post({ html: '<p>b</p>', baseLiveAt: base }), ctx('art_base_b'));
    expect(res.status).toBe(409);
  });

  it('"Keep mine" after a conflict replaces the stored base with the kept copy\'s', async () => {
    await seed('art_base_c');
    await handleDraft(post({ html: '<p>other tab</p>', baseLiveAt: T0 }), ctx('art_base_c'), 'POST');
    await handleDraft(post({ html: '<p>mine</p>', baseLiveAt: T1, resetBase: true }), ctx('art_base_c'), 'POST');
    expect((await draftRow('art_base_c')).base_live_at).toBe(T1);
    expect((await handlePublish(post({ html: '<p>mine</p>', baseLiveAt: T1 }), ctx('art_base_c'))).status).toBe(200);
  });

  it('a draft from before the column gets its base on the next save, and falls back to created_at until then', async () => {
    await seed('art_base_d', 'html', false);
    await e.DB.prepare("INSERT INTO artifact_drafts (id, artifact_id, user_id, html_content, created_at) VALUES ('draft_legacy', 'art_base_d', ?, '<p>old</p>', ?)").bind(ME, T1).run();
    expect((await load('art_base_d')).baseLiveAt).toBe(T1);
    await handleDraft(post({ html: '<p>new</p>', baseLiveAt: T0 }), ctx('art_base_d'), 'POST');
    expect((await draftRow('art_base_d')).base_live_at).toBe(T0);
  });

  it('the publish check uses the earlier of the stored base and the client\'s', async () => {
    await seed('art_base_e');
    await handleDraft(post({ html: '<p>a</p>', baseLiveAt: T0 }), ctx('art_base_e'), 'POST');
    const res = await handlePublish(post({ html: '<p>a</p>', baseLiveAt: T1 }), ctx('art_base_e'));
    expect(res.status).toBe(409);
    expect(((await res.json()) as { baseVersionNo: number }).baseVersionNo).toBe(1);
  });

  it('ignores a malformed or future base', () => {
    expect(parseBaseLiveAt(T0)).toBe(T0);
    expect(parseBaseLiveAt('yesterday')).toBeNull();
    expect(parseBaseLiveAt(42)).toBeNull();
    expect(parseBaseLiveAt('2999-01-01T00:00:00.000Z')).toBeNull();
  });
});
